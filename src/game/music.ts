/* The soundtrack, generated live with WebAudio: a slow minor pad with a pentatonic arpeggio in
 * peacetime, a driving pulse when a fight is on. Starts after the first gesture; J or the HUD
 * button turns it off, and M (all sound) silences it too. */
import { sfx } from './sfx';

type Mode = 'calm' | 'battle';
const KEY = 'structs-kor.music';
let enabled = (() => { try { return localStorage.getItem(KEY) !== '0'; } catch { return true; } })();
let ctx: AudioContext | null = null, out: GainNode | null = null, filter: BiquadFilterNode | null = null;
let mode: Mode = 'calm', timer: ReturnType<typeof setInterval> | null = null;
let nextBeat = 0, beat = 0, arpIx = 4;
/** How mighty the empire is (0–4, the hegemony titles): peacetime music grows with it. */
let power = 0;
const fns = new Set<(on: boolean) => void>();

const A = 220;
const hz = (semi: number) => A * Math.pow(2, semi / 12);
// A minor: Am – F – C – G, voiced low.
const CHORDS = [[0, 3, 7], [-4, 0, 3], [3, 7, 10], [-2, 2, 5]];
const PENTA = [0, 3, 5, 7, 10, 12, 15, 17, 19, 22, 24];

function ensure() {
  if (ctx) return ctx;
  const C = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!C) return null;
  ctx = new C();
  out = ctx.createGain(); out.gain.value = 0;
  filter = ctx.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = 1400; filter.Q.value = 0.7;
  filter.connect(out).connect(ctx.destination);
  return ctx;
}

function note(type: OscillatorType, f: number, at: number, dur: number, vol: number, attack = 0.02) {
  if (!ctx || !filter) return;
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type; o.frequency.value = f;
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(vol, at + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  o.connect(g).connect(filter);
  o.start(at); o.stop(at + dur + 0.05);
}
function kick(at: number) {
  if (!ctx || !filter) return;
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.frequency.setValueAtTime(110, at); o.frequency.exponentialRampToValueAtTime(40, at + 0.18);
  g.gain.setValueAtTime(0.5, at); g.gain.exponentialRampToValueAtTime(0.0001, at + 0.25);
  o.connect(g).connect(filter); o.start(at); o.stop(at + 0.3);
}

/* Lookahead scheduler: every 100 ms, schedule any beat due in the next 300 ms. */
function tick() {
  if (!ctx) return;
  const step = mode === 'battle' ? 0.2 : 0.42;
  while (nextBeat < ctx.currentTime + 0.3) {
    const at = Math.max(nextBeat, ctx.currentTime + 0.01);
    const bar = Math.floor(beat / 16) % CHORDS.length;
    const chord = CHORDS[bar];
    if (beat % 16 === 0) for (const s of chord) { note('triangle', hz(s - 12), at, step * 16, 0.05, 1.2); note('sine', hz(s), at, step * 16, 0.035, 1.6); }
    // A pentatonic walk, sparse in peace, insistent in battle.
    if (mode === 'battle' || beat % 2 === 0) {
      arpIx = Math.max(0, Math.min(PENTA.length - 1, arpIx + [-2, -1, 1, 2][Math.floor(Math.random() * 4)]));
      if (Math.random() < (mode === 'battle' ? 0.85 : 0.55)) note('square', hz(PENTA[arpIx] + 12), at, step * 1.6, mode === 'battle' ? 0.022 : 0.014);
    }
    // The empire's weight in peacetime: a slow heartbeat, then a bass pulse, then a high answering line.
    if (mode === 'calm') {
      if (power >= 1 && beat % 8 === 0) kick(at);
      if (power >= 2 && beat % 4 === 2) note('triangle', hz(chord[0] - 24), at, step * 2, 0.045, 0.02);
      if (power >= 3 && beat % 4 === 0 && Math.random() < 0.6) note('sine', hz(PENTA[(arpIx + 3) % PENTA.length] + 24), at, step * 2.4, 0.012, 0.05);
    }
    if (mode === 'battle') { if (beat % 4 === 0) kick(at); if (beat % 8 === 4) note('sawtooth', hz(chord[0] - 24), at, step * 3, 0.06, 0.01); }
    nextBeat += step; beat++;
  }
}

function fade(to: number, secs = 1.5) {
  if (!ctx || !out) return;
  out.gain.cancelScheduledValues(ctx.currentTime);
  out.gain.setTargetAtTime(to, ctx.currentTime, secs / 3);
}

function start() {
  if (!enabled || sfx.muted) return;
  const c = ensure();
  if (!c) return;
  if (c.state === 'suspended') void c.resume();
  if (!timer) { nextBeat = c.currentTime + 0.1; timer = setInterval(tick, 100); }
  fade(mode === 'battle' ? 0.9 : 0.7);
}
function stop() { fade(0, 0.8); setTimeout(() => { if (!enabled || sfx.muted) { if (timer) clearInterval(timer); timer = null; } }, 1200); }

export const music = {
  get on() { return enabled; },
  toggle() {
    enabled = !enabled;
    try { localStorage.setItem(KEY, enabled ? '1' : '0'); } catch { /* fine */ }
    if (enabled) start(); else stop();
    for (const f of fns) f(enabled);
  },
  onChange(f: (on: boolean) => void) { fns.add(f); return () => fns.delete(f); },
  /** The empire's might (0–4): peacetime gains a heartbeat, a bass line and a brighter top. */
  setPower(p: number) {
    p = Math.max(0, Math.min(4, Math.floor(p)));
    if (p === power) return;
    power = p;
    if (filter && ctx && mode === 'calm') filter.frequency.setTargetAtTime(1400 + 300 * power, ctx.currentTime, 1);
  },
  /** Peace or war: the pulse comes in when a fight starts and leaves when it ends. */
  setMode(m: Mode) {
    if (m === mode) return;
    mode = m;
    if (filter && ctx) filter.frequency.setTargetAtTime(m === 'battle' ? 2600 : 1400 + 300 * power, ctx.currentTime, 0.5);
    if (timer) fade(m === 'battle' ? 0.9 : 0.7);
  },
};

sfx.onChange((muted) => (muted ? stop() : start()));
// Browsers allow audio only after a gesture: the first one starts the music.
const first = () => { start(); removeEventListener('pointerdown', first); removeEventListener('keydown', first); };
addEventListener('pointerdown', first);
addEventListener('keydown', first);
document.addEventListener('visibilitychange', () => { if (document.hidden) fade(0, 0.5); else if (enabled && !sfx.muted && timer) fade(mode === 'battle' ? 0.9 : 0.7); });
