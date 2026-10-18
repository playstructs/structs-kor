/* Juice: rolling counters, floating numbers, screen shake, flashes and the big banner. Everything
 * here is decoration and respects prefers-reduced-motion. */
import { sfx } from './sfx';

export const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

const last = new WeakMap<Element, number>();
/** Roll the number in `el` to `to`, keeping `fmt`'s formatting. Ticks up green, down red. */
export function roll(el: HTMLElement | null, to: number, fmt: (v: number) => string, ms = 700) {
  if (!el) return;
  const from = last.get(el) ?? to;
  last.set(el, to);
  if (from === to || reduced()) { el.textContent = fmt(to); return; }
  el.classList.remove('up', 'down');
  void el.offsetWidth;
  el.classList.add(to > from ? 'up' : 'down');
  const t0 = performance.now();
  const step = (t: number) => {
    const k = Math.min(1, (t - t0) / ms), e = 1 - Math.pow(1 - k, 3);
    el.textContent = fmt(from + (to - from) * e);
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

/** A number that floats up from an element and fades (+120, −2 HP, 회피). */
export function float(from: Element | { x: number; y: number }, text: string, color = 'var(--cheong-hi)', big = false) {
  const r = from instanceof Element ? from.getBoundingClientRect() : { left: from.x, top: from.y, width: 0, height: 0 };
  const el = document.createElement('div');
  el.className = 'fx-float' + (big ? ' big' : '');
  el.textContent = text;
  el.style.left = `${r.left + r.width / 2}px`;
  el.style.top = `${r.top + r.height / 3}px`;
  el.style.color = color;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 1300);
}

export function shake(strength: 'sm' | 'lg' = 'sm') {
  if (reduced()) return;
  const app = document.querySelector<HTMLElement>('.app');
  if (!app) return;
  app.classList.remove('fx-shake', 'fx-shake-lg');
  void app.offsetWidth;
  app.classList.add(strength === 'lg' ? 'fx-shake-lg' : 'fx-shake');
  setTimeout(() => app.classList.remove('fx-shake', 'fx-shake-lg'), 500);
}

export function flash(color = 'rgba(230,77,64,.35)') {
  if (reduced()) return;
  const el = document.createElement('div');
  el.className = 'fx-flash';
  el.style.background = color;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 450);
}

/** Full-screen banner: rank-ups, victories, raid alarms. Click or Esc dismisses. */
type BannerOpts = { kicker: string; title: string; sub?: string; tone?: 'gold' | 'cheong' | 'jeok'; ms?: number };
const bannerQueue: BannerOpts[] = [];
let bannerUp = false;
/** Banners take turns: one that arrives while another is up waits for it (at most 3 wait). */
export function banner(o: BannerOpts) {
  if (bannerUp) { if (bannerQueue.length < 3) bannerQueue.push(o); return; }
  bannerUp = true;
  const el = document.createElement('div');
  el.className = `fx-banner ${o.tone ?? 'gold'}`;
  el.setAttribute('role', 'status');
  el.innerHTML = `<div class="fx-banner-in"><span class="kicker"></span><strong></strong>${o.sub ? '<span class="sub"></span>' : ''}</div>`;
  el.querySelector('.kicker')!.textContent = o.kicker;
  el.querySelector('strong')!.textContent = o.title;
  if (o.sub) el.querySelector('.sub')!.textContent = o.sub;
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    el.classList.add('out');
    document.removeEventListener('keydown', esc);
    setTimeout(() => { el.remove(); bannerUp = false; const next = bannerQueue.shift(); if (next) banner(next); }, 300);
  };
  const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
  el.addEventListener('click', close);
  document.addEventListener('keydown', esc);
  document.body.appendChild(el);
  setTimeout(close, o.ms ?? 2600);
}

/* Every corner notification is also kept, newest first, for the HUD's 알림 기록. */
export interface Note { title: string; body: string; tone: 'cheong' | 'jeok' | 'hwang'; at: number }
const log: Note[] = [];
let unread = 0;
const logFns = new Set<() => void>();
export const notes = {
  get list() { return log; },
  get unread() { return unread; },
  seen() { unread = 0; for (const f of logFns) f(); },
  onChange(f: () => void) { logFns.add(f); return () => logFns.delete(f); },
};

/** A stacked notification in the corner, game-style. */
export function notify(title: string, body = '', tone: 'cheong' | 'jeok' | 'hwang' = 'cheong', cue: Parameters<typeof sfx.play>[0] | null = 'tick') {
  log.unshift({ title, body, tone, at: Date.now() });
  log.length = Math.min(log.length, 40);
  unread++;
  for (const f of logFns) f();
  let stack = document.getElementById('fx-notes');
  if (!stack) { stack = document.createElement('div'); stack.id = 'fx-notes'; stack.setAttribute('aria-live', 'polite'); document.body.appendChild(stack); }
  const el = document.createElement('div');
  el.className = `fx-note ${tone}`;
  el.innerHTML = '<b></b><span></span>';
  el.querySelector('b')!.textContent = title;
  el.querySelector('span')!.textContent = body;
  stack.prepend(el);
  while (stack.children.length > 4) stack.lastElementChild!.remove();
  if (cue) sfx.play(cue);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 300); }, 4200);
}

/** A quick shout across the middle of the screen (streaks, criticals). Never queues, never blocks. */
export function callout(text: string, tone: 'gold' | 'jeok' | 'cheong' = 'gold') {
  document.querySelector('.fx-callout')?.remove();
  const el = document.createElement('div');
  el.className = `fx-callout ${tone}`;
  el.textContent = text;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), reduced() ? 900 : 1300);
}
