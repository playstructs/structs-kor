/* The GPU hashing thread: the same messages as hash.worker.ts (start/stop in; found/progress out),
 * with the search done by WebGPU (gpu.ts). Says `gpu-failed` if WebGPU isn't usable here, and the
 * engine falls back to the CPU workers. */
import { GpuHasher } from './gpu';

type In = { type: 'start'; taskId: string; prefix: string; start: number; floor: number } | { type: 'stop' };
const post = (m: unknown) => (self as unknown as Worker).postMessage(m);

let token = 0;
const ready = GpuHasher.create().then((h) => { if (!h) post({ type: 'gpu-failed', why: 'WebGPU를 쓸 수 없습니다' }); return h; });

self.onmessage = (e: MessageEvent<In>) => {
  const m = e.data;
  const my = ++token;
  if (m.type === 'stop') return;
  void ready.then((h) => { if (h) void run(h, my, m.taskId, m.prefix, m.floor); });
};

async function run(h: GpuHasher, my: number, taskId: string, prefix: string, floor: number) {
  let best = floor, count = 0, last = performance.now();
  while (my === token) {
    try {
      const r = await h.sweep(prefix);
      if (my !== token) return;
      count += r.tried;
      if (r.zeros > best) { best = r.zeros; post({ type: 'found', taskId, zeros: r.zeros, nonce: r.nonce, hash: r.hash }); }
    } catch (err) { post({ type: 'gpu-failed', why: String((err as Error)?.message ?? err) }); return; }
    const now = performance.now();
    if (now - last > 250) { post({ type: 'progress', taskId, hashes: count, ms: now - last }); count = 0; last = now; }
  }
}
