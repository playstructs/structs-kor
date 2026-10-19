/* Proof-of-work on the GPU (WebGPU), for the same proofs sha.ts finds on the CPU, about a hundred
 * times faster on an ordinary laptop. One dispatch tries `count` nonces: the 13-digit nonce keeps its
 * first 4 digits fixed (written by the CPU) and the shader writes the last 9 from `lowBase + id`, so
 * no carry ever crosses into the fixed digits. Each invocation hashes the prefix's tail block(s) from
 * the precomputed midstate and offers (leading hex zeros << 24 | id) to an atomic max, so a dispatch
 * returns its best nonce in one word. Every proof it reports is re-checked with sha.ts before use. */
import { NONCE_WIDTH, makeJob, setNonce, tryNonce, digestHex, nonceString, type HashJob } from './sha';

/** Digits the shader writes per nonce (the rest stay fixed for a dispatch). */
export const GPU_DIGITS = 9;
const LOW_SPAN = 1e9;
/** Most nonces in one dispatch: ids must fit in 24 bits, and 256-wide workgroups in 65,535 groups. */
export const MAX_COUNT = 1 << 23;

/** A job as the shader reads it: midstate, tail words (zero where the low digits go), and where they go. */
export interface GpuJob { words: Uint32Array; blocks: number; digitAt: number }

/** Pack `job` for the shader, with `high` as the nonce's fixed leading digits. */
export function packJob(job: HashJob, high: number): GpuJob {
  setNonce(job, high * LOW_SPAN);                       // high digits in place, low ones '0'
  const tail = job.tail.slice();
  const digitAt = job.nonceAt + NONCE_WIDTH - GPU_DIGITS;
  tail.fill(0, digitAt, digitAt + GPU_DIGITS);           // the shader ORs its digits in
  const words = new Uint32Array(8 + 32 + 4);
  for (let i = 0; i < 8; i++) words[i] = job.mid[i] >>> 0;
  const dv = new DataView(tail.buffer);
  for (let i = 0; i < tail.length / 4; i++) words[8 + i] = dv.getUint32(i * 4);
  return { words, blocks: tail.length / 64, digitAt };
}

/** The nonce a dispatch's winner stands for, as the chain wants it (13 digits). */
export const nonceFor = (high: number, low: number) => String(high * LOW_SPAN + low).padStart(NONCE_WIDTH, '0');

/* WebGPU's flag values (the DOM typings here don't declare the GPUBufferUsage / GPUMapMode globals). */
const USE = { MAP_READ: 0x1, COPY_SRC: 0x4, COPY_DST: 0x8, STORAGE: 0x80 } as const;
const MAP_READ = 0x1;

export const SHADER = /* wgsl */ `
struct Job { mid: array<u32, 8>, tail: array<u32, 32>, blocks: u32, lowBase: u32, digitAt: u32, count: u32 }
@group(0) @binding(0) var<storage, read> job: Job;
@group(0) @binding(1) var<storage, read_write> best: atomic<u32>;

const K = array<u32, 64>(
  0x428a2f98u, 0x71374491u, 0xb5c0fbcfu, 0xe9b5dba5u, 0x3956c25bu, 0x59f111f1u, 0x923f82a4u, 0xab1c5ed5u,
  0xd807aa98u, 0x12835b01u, 0x243185beu, 0x550c7dc3u, 0x72be5d74u, 0x80deb1feu, 0x9bdc06a7u, 0xc19bf174u,
  0xe49b69c1u, 0xefbe4786u, 0x0fc19dc6u, 0x240ca1ccu, 0x2de92c6fu, 0x4a7484aau, 0x5cb0a9dcu, 0x76f988dau,
  0x983e5152u, 0xa831c66du, 0xb00327c8u, 0xbf597fc7u, 0xc6e00bf3u, 0xd5a79147u, 0x06ca6351u, 0x14292967u,
  0x27b70a85u, 0x2e1b2138u, 0x4d2c6dfcu, 0x53380d13u, 0x650a7354u, 0x766a0abbu, 0x81c2c92eu, 0x92722c85u,
  0xa2bfe8a1u, 0xa81a664bu, 0xc24b8b70u, 0xc76c51a3u, 0xd192e819u, 0xd6990624u, 0xf40e3585u, 0x106aa070u,
  0x19a4c116u, 0x1e376c08u, 0x2748774cu, 0x34b0bcb5u, 0x391c0cb3u, 0x4ed8aa4au, 0x5b9cca4fu, 0x682e6ff3u,
  0x748f82eeu, 0x78a5636fu, 0x84c87814u, 0x8cc70208u, 0x90befffau, 0xa4506cebu, 0xbef9a3f7u, 0xc67178f2u);

fn rotr(x: u32, n: u32) -> u32 { return (x >> n) | (x << (32u - n)); }

fn compress(st: ptr<function, array<u32, 8>>, t: ptr<function, array<u32, 32>>, off: u32) {
  var w: array<u32, 64>;
  for (var i = 0u; i < 16u; i++) { w[i] = (*t)[off + i]; }
  for (var i = 16u; i < 64u; i++) {
    let x = w[i - 15u]; let y = w[i - 2u];
    let s0 = rotr(x, 7u) ^ rotr(x, 18u) ^ (x >> 3u);
    let s1 = rotr(y, 17u) ^ rotr(y, 19u) ^ (y >> 10u);
    w[i] = w[i - 16u] + s0 + w[i - 7u] + s1;
  }
  var a = (*st)[0]; var b = (*st)[1]; var c = (*st)[2]; var d = (*st)[3];
  var e = (*st)[4]; var f = (*st)[5]; var g = (*st)[6]; var h = (*st)[7];
  for (var i = 0u; i < 64u; i++) {
    let t1 = h + (rotr(e, 6u) ^ rotr(e, 11u) ^ rotr(e, 25u)) + ((e & f) ^ (~e & g)) + K[i] + w[i];
    let t2 = (rotr(a, 2u) ^ rotr(a, 13u) ^ rotr(a, 22u)) + ((a & b) ^ (a & c) ^ (b & c));
    h = g; g = f; f = e; e = d + t1; d = c; c = b; b = a; a = t1 + t2;
  }
  (*st)[0] += a; (*st)[1] += b; (*st)[2] += c; (*st)[3] += d;
  (*st)[4] += e; (*st)[5] += f; (*st)[6] += g; (*st)[7] += h;
}

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let id = gid.x;
  if (id >= job.count) { return; }
  var t: array<u32, 32>;
  for (var i = 0u; i < 32u; i++) { t[i] = job.tail[i]; }
  // The low ${GPU_DIGITS} digits of this invocation's nonce, written into the message bytes.
  var n = job.lowBase + id;
  for (var k = 0u; k < ${GPU_DIGITS}u; k++) {
    let pos = job.digitAt + ${GPU_DIGITS - 1}u - k;
    t[pos / 4u] = t[pos / 4u] | ((48u + n % 10u) << ((3u - pos % 4u) * 8u));
    n = n / 10u;
  }
  var st: array<u32, 8>;
  for (var i = 0u; i < 8u; i++) { st[i] = job.mid[i]; }
  compress(&st, &t, 0u);
  if (job.blocks == 2u) { compress(&st, &t, 16u); }
  var z = 0u;
  for (var i = 0u; i < 8u; i++) {
    if (st[i] == 0u) { z += 8u; continue; }
    z += countLeadingZeros(st[i]) / 4u;
    break;
  }
  atomicMax(&best, (z << 24u) | id);
}`;

/** A GPU searcher for one prefix at a time. `create` resolves null when WebGPU isn't usable here. */
export class GpuHasher {
  private constructor(private dev: GPUDevice, private pipe: GPUComputePipeline) {}
  private jobBuf!: GPUBuffer; private bestBuf!: GPUBuffer; private readBuf!: GPUBuffer; private group!: GPUBindGroup;
  /** Nonces per dispatch, tuned to about 60 ms of work so stopping and switching stay quick. */
  count = 1 << 20;

  static async create(): Promise<GpuHasher | null> {
    try {
      const gpu = (navigator as Navigator & { gpu?: GPU }).gpu;
      if (!gpu) return null;
      const adapter = await gpu.requestAdapter({ powerPreference: 'high-performance' });
      if (!adapter) return null;
      const dev = await adapter.requestDevice();
      const module = dev.createShaderModule({ code: SHADER });
      const pipe = await dev.createComputePipelineAsync({ layout: 'auto', compute: { module, entryPoint: 'main' } });
      const h = new GpuHasher(dev, pipe);
      h.jobBuf = dev.createBuffer({ size: (8 + 32 + 4) * 4, usage: USE.STORAGE | USE.COPY_DST });
      h.bestBuf = dev.createBuffer({ size: 4, usage: USE.STORAGE | USE.COPY_SRC | USE.COPY_DST });
      h.readBuf = dev.createBuffer({ size: 4, usage: USE.MAP_READ | USE.COPY_DST });
      h.group = dev.createBindGroup({ layout: pipe.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: h.jobBuf } }, { binding: 1, resource: { buffer: h.bestBuf } }] });
      return h;
    } catch { return null; }
  }

  private job: { prefix: string; job: HashJob } | null = null;
  /** One dispatch over `count` nonces of `prefix`; resolves the best one, checked on the CPU. */
  async sweep(prefix: string): Promise<{ zeros: number; nonce: string; hash: string; tried: number }> {
    if (this.job?.prefix !== prefix) this.job = { prefix, job: makeJob(prefix) };
    const job = this.job.job;
    const count = Math.min(MAX_COUNT, this.count);
    const high = Math.floor(Math.random() * 10 ** (NONCE_WIDTH - GPU_DIGITS));
    const lowBase = Math.floor(Math.random() * (LOW_SPAN - count));
    const g = packJob(job, high);
    g.words[40] = g.blocks; g.words[41] = lowBase; g.words[42] = g.digitAt; g.words[43] = count;
    const t0 = performance.now();
    this.dev.queue.writeBuffer(this.jobBuf, 0, g.words);
    this.dev.queue.writeBuffer(this.bestBuf, 0, new Uint32Array([0]));
    const enc = this.dev.createCommandEncoder();
    const pass = enc.beginComputePass();
    pass.setPipeline(this.pipe); pass.setBindGroup(0, this.group); pass.dispatchWorkgroups(Math.ceil(count / 256));
    pass.end();
    enc.copyBufferToBuffer(this.bestBuf, 0, this.readBuf, 0, 4);
    this.dev.queue.submit([enc.finish()]);
    await this.readBuf.mapAsync(MAP_READ);
    const won = new Uint32Array(this.readBuf.getMappedRange().slice(0))[0];
    this.readBuf.unmap();
    // Aim each dispatch at ~60 ms.
    const ms = performance.now() - t0;
    if (ms > 0) this.count = Math.max(1 << 16, Math.min(MAX_COUNT, Math.round(this.count * Math.min(2, Math.max(0.5, 60 / ms)))));
    const nonce = nonceFor(high, lowBase + (won & 0xffffff));
    // Trust, but verify: the chain will check this hash, so the CPU checks it first.
    const check = makeJob(prefix);
    setNonce(check, Number(nonce));
    const out = new Int32Array(8);
    const zeros = tryNonce(check, out);
    if (zeros !== won >>> 24) throw new Error(`GPU proof did not verify (${won >>> 24} vs ${zeros})`);
    return { zeros, nonce: nonceString(check), hash: digestHex(out), tried: count };
  }

  destroy() { this.jobBuf?.destroy(); this.bestBuf?.destroy(); this.readBuf?.destroy(); this.dev.destroy(); }
}
