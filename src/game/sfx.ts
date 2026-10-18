/* Sound: every cue is synthesised with WebAudio (no files to fetch). Off until the first user
 * gesture (browsers require it); muted state survives reloads. */

export type Cue = 'click' | 'hover' | 'confirm' | 'coin' | 'alarm' | 'levelup' | 'hit' | 'boom' | 'error' | 'tick' | 'shot' | 'evade' | 'shield' | 'victory' | 'defeat' | 'build';
/** Every cue with its Korean name, for 소리 설정. */
export const CUE_NAMES: Record<Cue, string> = {
  click: '클릭', hover: '가리키기', confirm: '확인', coin: '알파 · 거래', alarm: '경보', levelup: '진급', hit: '피격', boom: '폭발', error: '오류', tick: '알림 · 메시지',
  shot: '발사', evade: '회피', shield: '방어막', victory: '승리', defeat: '패배', build: '건설',
};

/* Player settings: master volume, cues switched off, and their own files for any cue (IndexedDB). */
const SET = 'structs-kor.sfx';
interface SfxSettings { volume: number; off: Cue[] }
let settings: SfxSettings = (() => { try { return { volume: 1, off: [], ...JSON.parse(localStorage.getItem(SET) || '{}') }; } catch { return { volume: 1, off: [] }; } })();
const saveSettings = () => { try { localStorage.setItem(SET, JSON.stringify(settings)); } catch { /* fine */ } };
const custom = new Map<Cue, AudioBuffer>();
const db = (): Promise<IDBDatabase | null> => new Promise((res) => {
  try { const r = indexedDB.open('structs-kor-sfx', 1); r.onupgradeneeded = () => r.result.createObjectStore('cues'); r.onsuccess = () => res(r.result); r.onerror = () => res(null); } catch { res(null); }
});
async function idb<T>(mode: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest<T>): Promise<T | null> {
  const d = await db(); if (!d) return null;
  return new Promise((res) => { try { const q = f(d.transaction('cues', mode).objectStore('cues')); q.onsuccess = () => res(q.result); q.onerror = () => res(null); } catch { res(null); } });
}
let customLoaded = false;
async function loadCustom() {
  if (customLoaded) return; customLoaded = true;
  const c = ac(); if (!c) { customLoaded = false; return; }
  const keys = (await idb<IDBValidKey[]>('readonly', (s) => s.getAllKeys())) ?? [];
  for (const k of keys) { const buf = await idb<ArrayBuffer>('readonly', (s) => s.get(k)); if (buf) { try { custom.set(k as Cue, await c.decodeAudioData(buf.slice(0))); } catch { /* not audio */ } } }
}
function playBuffer(b: AudioBuffer) {
  const c = ac(); if (!c || !master) return;
  const src = c.createBufferSource(); src.buffer = b; src.connect(master); src.start();
}

const KEY = 'structs-kor.muted';
let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let muted = (() => { try { return localStorage.getItem(KEY) === '1'; } catch { return false; } })();
const fns = new Set<(m: boolean) => void>();

function ac(): AudioContext | null {
  if (muted) return null;
  if (!ctx) {
    const C = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!C) return null;
    ctx = new C();
    master = ctx.createGain();
    master.gain.value = 0.22 * settings.volume;
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

/** One oscillator note with a quick attack and exponential release. */
function tone(type: OscillatorType, f0: number, f1: number, dur: number, at = 0, vol = 1) {
  const c = ac();
  if (!c || !master) return;
  const t = c.currentTime + at;
  const o = c.createOscillator(), g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(master);
  o.start(t);
  o.stop(t + dur + 0.02);
}

/** Filtered white noise: explosions, impacts, static. */
function noise(dur: number, cutoff: number, at = 0, vol = 1) {
  const c = ac();
  if (!c || !master) return;
  const t = c.currentTime + at;
  const len = Math.max(1, Math.floor(c.sampleRate * dur));
  const buf = c.createBuffer(1, len, c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
  src.buffer = buf;
  f.type = 'lowpass';
  f.frequency.setValueAtTime(cutoff, t);
  f.frequency.exponentialRampToValueAtTime(80, t + dur);
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f).connect(g).connect(master);
  src.start(t);
}

const CUES: Record<Cue, () => void> = {
  click: () => tone('square', 660, 520, 0.05, 0, 0.35),
  hover: () => tone('sine', 1200, 1200, 0.025, 0, 0.08),
  tick: () => tone('sine', 1800, 1800, 0.03, 0, 0.12),
  confirm: () => { tone('square', 523, 523, 0.07, 0, 0.4); tone('square', 784, 784, 0.12, 0.07, 0.4); },
  coin: () => { tone('square', 988, 988, 0.06, 0, 0.3); tone('square', 1319, 1319, 0.18, 0.06, 0.3); },
  build: () => { tone('square', 220, 220, 0.06, 0, 0.4); tone('square', 330, 330, 0.06, 0.08, 0.4); tone('square', 440, 440, 0.14, 0.16, 0.4); },
  error: () => { tone('sawtooth', 180, 120, 0.18, 0, 0.35); },
  alarm: () => { for (let i = 0; i < 3; i++) { tone('sawtooth', 880, 440, 0.22, i * 0.28, 0.35); } },
  shot: () => { tone('square', 1400, 200, 0.12, 0, 0.25); noise(0.06, 4000, 0, 0.15); },
  hit: () => { noise(0.14, 2400, 0, 0.6); tone('square', 160, 60, 0.12, 0, 0.3); },
  boom: () => { noise(0.7, 1800, 0, 0.9); tone('sine', 110, 30, 0.6, 0, 0.6); },
  evade: () => tone('sine', 600, 1600, 0.16, 0, 0.25),
  shield: () => { tone('triangle', 300, 900, 0.2, 0, 0.35); tone('sine', 1200, 1200, 0.12, 0.05, 0.15); },
  levelup: () => { [523, 659, 784, 1047].forEach((f, i) => tone('square', f, f, 0.14, i * 0.09, 0.35)); tone('triangle', 1047, 1047, 0.5, 0.36, 0.3); },
  victory: () => { [392, 523, 659, 784, 659, 784, 1047].forEach((f, i) => tone('square', f, f, 0.16, i * 0.11, 0.35)); },
  defeat: () => { [392, 349, 311, 262].forEach((f, i) => tone('triangle', f, f * 0.98, 0.3, i * 0.22, 0.4)); },
};

export const sfx = {
  play(cue: Cue) {
    if (settings.off.includes(cue)) return;
    try { const b = custom.get(cue); if (b) playBuffer(b); else CUES[cue](); } catch { /* audio refused */ }
    if (!customLoaded && ctx) void loadCustom();
  },
  /** Play a cue regardless of its switch (the settings' test button). */
  test(cue: Cue) { try { const b = custom.get(cue); if (b) playBuffer(b); else CUES[cue](); } catch { /* audio refused */ } },
  get volume() { return settings.volume; },
  setVolume(v: number) { settings.volume = Math.max(0, Math.min(1.5, v)); saveSettings(); if (master) master.gain.value = 0.22 * settings.volume; },
  isOff(cue: Cue) { return settings.off.includes(cue); },
  setOff(cue: Cue, off: boolean) { settings.off = off ? [...new Set([...settings.off, cue])] : settings.off.filter((c) => c !== cue); saveSettings(); },
  hasCustom(cue: Cue) { return custom.has(cue); },
  /** Use the player's own file for a cue (null: back to the synthesised one). */
  async setCustom(cue: Cue, file: File | null): Promise<boolean> {
    if (!file) { custom.delete(cue); await idb('readwrite', (s) => s.delete(cue)); return true; }
    const c = ac(); if (!c) return false;
    const buf = await file.arrayBuffer();
    try { custom.set(cue, await c.decodeAudioData(buf.slice(0))); } catch { return false; }
    await idb('readwrite', (s) => s.put(buf, cue));
    return true;
  },
  async ready() { await loadCustom(); },
  get muted() { return muted; },
  toggle() {
    muted = !muted;
    try { localStorage.setItem(KEY, muted ? '1' : '0'); } catch { /* storage refused */ }
    if (!muted) sfx.play('confirm');
    for (const f of fns) f(muted);
  },
  onChange(f: (m: boolean) => void) { fns.add(f); return () => fns.delete(f); },
};

/* Every button and link clicks; the browser unlocks audio on this first gesture. */
document.addEventListener('pointerdown', (e) => {
  const t = (e.target as HTMLElement | null)?.closest('button, a, [data-act], input[type=range]');
  if (t && !t.hasAttribute('data-silent')) sfx.play('click');
}, true);
