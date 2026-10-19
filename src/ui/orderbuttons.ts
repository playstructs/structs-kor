/* The button that gave an order shows it on its way, on every screen: disabled with a spinner while the
 * order is sending or waiting for a block, then a moment of ✓ or ✕. The order store (api/pending.ts)
 * says when an order begins; the button is the one pressed just before (a click or a form submit).
 * A screen that repaints puts its own fresh button back, and the HUD's 명령 count still tells. */
import { pending, type Order } from '../api/pending';

const PRESS_MS = 1500, AFTER_MS = 1600;
let pressed: { el: HTMLButtonElement; at: number } | null = null;
const held = new Map<number, { el: HTMLButtonElement }>();
const seen = new Set<number>();

const remember = (el: Element | null) => {
  const b = el?.closest?.('button');
  if (b instanceof HTMLButtonElement) pressed = { el: b, at: Date.now() };
};
document.addEventListener('click', (e) => remember(e.target as Element), true);
document.addEventListener('submit', (e) => remember((e as SubmitEvent).submitter ?? (e.target as HTMLFormElement).querySelector('button[type="submit"], button:not([type])')), true);

function release(id: number, mark: 'ok' | 'bad') {
  const h = held.get(id);
  held.delete(id);
  if (!h || !h.el.isConnected) return;
  h.el.classList.remove('order-busy');
  h.el.removeAttribute('aria-busy');
  h.el.classList.add(mark === 'ok' ? 'order-ok' : 'order-bad');
  setTimeout(() => { h.el.classList.remove('order-ok', 'order-bad'); h.el.disabled = false; }, AFTER_MS);
}

pending.onChange(() => {
  for (const o of pending.list() as Order[]) {
    if (!seen.has(o.id)) {
      seen.add(o.id);
      const p = pressed;
      if (p && Date.now() - p.at < PRESS_MS && p.el.isConnected && !held.has(o.id) && ![...held.values()].some((h) => h.el === p.el)) {
        held.set(o.id, { el: p.el });
        p.el.classList.add('order-busy');
        p.el.setAttribute('aria-busy', 'true');
        p.el.disabled = true;
        pressed = null;
      }
    }
    if (held.has(o.id) && (o.phase === 'done' || o.phase === 'failed')) release(o.id, o.phase === 'done' ? 'ok' : 'bad');
  }
  if (seen.size > 500) { const keep = new Set((pending.list() as Order[]).map((o) => o.id)); for (const id of seen) if (!keep.has(id)) seen.delete(id); }
});
