/* Rendering: screens return HTML strings built with `html`, which escapes every interpolated value
 * unless it is wrapped in `raw()` (or is the result of another `html`). Clicks and inputs are
 * delegated: an element with data-act="name" calls the screen's handler of that name. */

const SAFE = Symbol('safe');
export interface Safe { [SAFE]: true; s: string }
export const raw = (s: string): Safe => ({ [SAFE]: true, s });
const isSafe = (v: unknown): v is Safe => typeof v === 'object' && v !== null && (v as Safe)[SAFE] === true;

export function esc(v: unknown): string {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

type Val = unknown;
function part(v: Val): string {
  if (v == null || v === false) return '';
  if (Array.isArray(v)) return v.map(part).join('');
  if (isSafe(v)) return v.s;
  return esc(v);
}

export function html(strings: TemplateStringsArray, ...vals: Val[]): Safe {
  let out = strings[0];
  for (let i = 0; i < vals.length; i++) out += part(vals[i]) + strings[i + 1];
  return raw(out);
}

export const when = (c: unknown, a: () => Safe, b?: () => Safe): Safe => (c ? a() : b ? b() : raw(''));

export type Handler = (el: HTMLElement, ev: Event) => void;
export type Handlers = Record<string, Handler>;

/* One delegated binding per root: screens repaint often, and a listener added per paint would run
 * every handler once per paint ever made (a single click sending the same transaction N times). */
const bound = new WeakMap<HTMLElement, () => void>();

/** Mount an HTML string into `root`, routing data-act events to `handlers`. Returns an unbind. */
export function mount(root: HTMLElement, view: Safe, handlers: Handlers = {}): () => void {
  bound.get(root)?.();
  root.innerHTML = view.s;
  const on = (ev: Event) => {
    const t = (ev.target as HTMLElement | null)?.closest<HTMLElement>('[data-act]');
    if (!t || !root.contains(t)) return;
    const want = t.dataset.on || (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement ? 'input' : 'click');
    if (ev.type !== want && !(ev.type === 'submit' && want === 'submit')) return;
    const h = handlers[t.dataset.act!];
    if (!h) return;
    if (ev.type === 'submit') ev.preventDefault();
    h(t, ev);
  };
  for (const type of ['click', 'input', 'change', 'submit']) root.addEventListener(type, on);
  const unbind = () => { for (const type of ['click', 'input', 'change', 'submit']) root.removeEventListener(type, on); if (bound.get(root) === unbind) bound.delete(root); };
  bound.set(root, unbind);
  return unbind;
}

export function toast(msg: string, ms = 2600) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.setAttribute('role', 'status');
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), ms);
}

/* ── Number formatting (ko-KR) ── */
export const n = (v: unknown, digits = 0) => {
  const x = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(x) ? x.toLocaleString('ko-KR', { maximumFractionDigits: digits }) : '—';
};
/** milliwatts → "48.0 kW" style. The chain stores power in mW. */
export function watts(mw: unknown): string {
  const x = Number(mw);
  if (!Number.isFinite(x)) return '—';
  const w = x / 1000;
  if (Math.abs(w) >= 1e6) return n(w / 1e6, 1) + ' MW';
  if (Math.abs(w) >= 1e3) return n(w / 1e3, 1) + ' kW';
  return n(w, 0) + ' W';
}
/** micro-denom → whole units ("ualpha" 1e6 → 1 alpha gram). */
export const micro = (v: unknown, digits = 2) => n(Number(v) / 1e6, digits);
