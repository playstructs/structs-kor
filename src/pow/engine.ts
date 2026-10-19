/* 작업 증명 (proof of work) in the browser. The guild lists the work a commander owes
 * (work/player/:id: BUILD, MINE, REFINE, RAID with their start block and difficulty range); this
 * hashes each one on Web Workers (sha.ts / hash.worker.ts, from structs-xyz src/pow) and submits
 * the proof the moment the chain will accept it. The bar falls with age —
 * CalculateDifficulty(age, range) leading hex zeros — so the best proof found so far is kept and
 * sent as soon as the next block's bar drops to meet it. */
import { difficultyAt } from './sha';
import { prefixOf, blocksUntil } from './work';
import { act, isSequenceError } from '../api/actions';
import { wallet } from '../wallet/wallet';
import { guildApi, type WorkRow } from '../api/guild';

export type PowKind = 'BUILD' | 'MINE' | 'REFINE' | 'RAID';
export type PowStatus = 'waiting' | 'hashing' | 'ready' | 'submitting' | 'sent' | 'failed';
export interface PowTask {
  id: string; kind: PowKind; objectId: string; planetId: string; blockStart: number; range: number; prefix: string;
  best: { zeros: number; nonce: string; hash: string } | null; hashes: number; rate: number; status: PowStatus; error?: string; tx?: string; holdUntil?: number; tries?: number;
}

const MAX_TRIES = 3;
const MSG: Record<PowKind, string> = { BUILD: 'MsgStructBuildComplete', MINE: 'MsgStructOreMinerComplete', REFINE: 'MsgStructOreRefineryComplete', RAID: 'MsgPlanetRaidComplete' };
export { prefixOf, blocksUntil } from './work';

class Engine {
  tasks = new Map<string, PowTask>();
  height = 0;
  running = false;
  autoSubmit = true;
  rate = 0;
  private workers: { w: Worker; task: string | null }[] = [];
  private fns = new Set<() => void>();
  private poll: ReturnType<typeof setInterval> | null = null;
  private emitT: ReturnType<typeof setTimeout> | null = null;
  readonly threads = Math.max(1, Math.min(4, Math.floor((navigator.hardwareConcurrency || 4) / 2)));

  onChange(f: () => void) { this.fns.add(f); return () => this.fns.delete(f); }
  private emit() { if (!this.emitT) this.emitT = setTimeout(() => { this.emitT = null; for (const f of this.fns) f(); }, 200); }

  /** The bar a proof must meet if sent now (lands in the next block). */
  required(t: PowTask) { return difficultyAt(this.height + 1 - t.blockStart, t.range); }

  /** Bring the task list in line with the guild's work rows (finished work drops off). */
  sync(rows: WorkRow[], height: number | null) {
    if (height) this.height = height;
    const live = new Set<string>();
    for (const w of rows) {
      const id = `${w.category}:${w.object_id}:${w.block_start}`;
      live.add(id);
      if (!this.tasks.has(id)) this.tasks.set(id, { id, kind: w.category, objectId: w.object_id, planetId: w.target_id, blockStart: w.block_start, range: w.difficulty_target, prefix: prefixOf(w), best: null, hashes: 0, rate: 0, status: 'waiting' });
    }
    for (const id of [...this.tasks.keys()]) if (!live.has(id) && this.tasks.get(id)!.status !== 'submitting') this.tasks.delete(id);
    this.schedule();
    this.check();
    this.emit();
  }

  start() {
    if (this.running) return;
    this.running = true;
    for (let i = 0; i < this.threads; i++) {
      const w = new Worker(new URL('./hash.worker.ts', import.meta.url), { type: 'module' });
      const slot = { w, task: null as string | null };
      w.onmessage = (e: MessageEvent) => this.onWorker(e.data);
      this.workers.push(slot);
    }
    // Follow the chain while hashing, so proofs go out the block they become valid.
    this.poll = setInterval(() => { void guildApi.block().then((b) => { if (b.height > this.height) { this.height = b.height; this.check(); this.emit(); } }).catch(() => null); }, 6000);
    this.schedule();
    this.emit();
  }
  stop() {
    this.running = false;
    for (const x of this.workers) x.w.terminate();
    this.workers = [];
    if (this.poll) clearInterval(this.poll);
    this.poll = null;
    for (const t of this.tasks.values()) if (t.status === 'hashing') t.status = 'waiting';
    this.rate = 0;
    this.emit();
  }

  /** Spread workers over tasks still owed, the ones closest to done first. */
  private schedule() {
    if (!this.running) return;
    // Tasks out of automatic retries stop taking workers; the player resends them by hand.
    const open = [...this.tasks.values()].filter((t) => (t.status === 'waiting' || t.status === 'hashing' || t.status === 'failed') && (t.tries ?? 0) < MAX_TRIES)
      .sort((a, b) => blocksUntil(a, a.best?.zeros ?? 0, this.height) - blocksUntil(b, b.best?.zeros ?? 0, this.height));
    this.workers.forEach((x, i) => {
      const t = open.length ? open[i % open.length] : null;
      if (x.task === (t?.id ?? null)) return;
      x.task = t?.id ?? null;
      if (!t) { x.w.postMessage({ type: 'stop' }); return; }
      t.status = 'hashing';
      x.w.postMessage({ type: 'start', taskId: t.id, prefix: t.prefix, start: Math.floor(Math.random() * 9e12), floor: t.best?.zeros ?? 0 });
    });
  }

  private onWorker(m: { type: 'found'; taskId: string; zeros: number; nonce: string; hash: string } | { type: 'progress'; taskId: string; hashes: number; ms: number }) {
    const t = this.tasks.get(m.taskId);
    if (!t) return;
    if (m.type === 'found') { if (!t.best || m.zeros > t.best.zeros) t.best = { zeros: m.zeros, nonce: m.nonce, hash: m.hash }; this.check(); }
    else {
      t.hashes += m.hashes;
      t.rate = t.rate * 0.7 + (m.hashes / (m.ms / 1000)) * 0.3;
      this.rate = [...this.tasks.values()].reduce((a, x) => a + (x.status === 'hashing' ? x.rate : 0), 0);
    }
    this.emit();
  }

  /** Any proof good enough for the next block goes out now (or waits for a manual send). */
  private check() {
    let changed = false;
    for (const t of this.tasks.values()) {
      if (!t.best || t.status === 'submitting' || t.status === 'sent') continue;
      if (t.holdUntil && this.height < t.holdUntil) continue;
      // Three refusals in a row is not timing: stop re-signing it and leave it to the player.
      if ((t.tries ?? 0) >= MAX_TRIES) continue;
      if (t.best.zeros >= this.required(t)) {
        if (t.status !== 'ready') changed = true;
        t.status = 'ready';
        if (this.autoSubmit && wallet.state === 'unlocked') void this.submit(t.id);
      }
    }
    // A qualifying proof is enough: free its workers for the others.
    if (changed) this.schedule();
  }

  async submit(id: string) {
    const t = this.tasks.get(id);
    // Only a ready proof, or a failed one being resent, goes out (never twice at once).
    if (!t?.best || (t.status !== 'ready' && t.status !== 'failed')) return;
    t.status = 'submitting'; t.error = undefined;
    this.schedule(); this.emit();
    const target = t.kind === 'RAID' ? { fleetId: t.objectId } : { structId: t.objectId };
    try {
      t.tx = await act(MSG[t.kind], { ...target, proof: t.best.hash, nonce: t.best.nonce });
      t.status = 'sent';
    } catch (e) {
      // Usually a block early: keep the proof, try again next block (up to MAX_TRIES). A sequence
      // clash is ours, not the proof's, so it doesn't count.
      if (!isSequenceError(e)) t.tries = (t.tries ?? 0) + 1;
      t.status = 'failed'; t.error = (e as Error).message + ((t.tries ?? 0) >= MAX_TRIES ? ' · 자동 재시도 중단' : ''); t.holdUntil = this.height + 1;
    }
    this.schedule(); this.emit();
  }
}

export const pow = new Engine();
