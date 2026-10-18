/* Sheets: an in-game dialog over whatever screen is open (send alpha, share, rent, guild invites).
 * One at a time; Esc or the backdrop closes it; focus goes in and comes back. The body is an `html`
 * view painted with mount(), so handlers work exactly as they do on a screen. */
import { html, mount, type Handlers, type Safe } from './dom';
import { sfx } from '../game/sfx';

export interface SheetOpts { kicker?: string; title: string; wide?: boolean; tone?: 'cheong' | 'hwang' | 'jeok'; onClose?: () => void }
export interface Sheet { el: HTMLElement; paint(body: Safe, handlers?: Handlers): void; close(): void; readonly open: boolean }

let current: Sheet | null = null;

export function openSheet(o: SheetOpts, body: Safe, handlers: Handlers = {}): Sheet {
  current?.close();
  const back = document.createElement('div');
  back.className = 'sheet-back';
  const box = document.createElement('section');
  box.className = `sheet game-panel ${o.wide ? 'wide' : ''} ${o.tone ?? 'cheong'}`;
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-modal', 'true');
  box.setAttribute('aria-label', o.title);
  box.innerHTML = `<header class="sheet-head">${o.kicker ? `<span class="label sheet-kicker"></span>` : ''}<h2></h2><button class="hud-btn sheet-x" type="button" aria-label="닫기"><i class="si icon-close"></i></button></header><div class="sheet-body"></div>`;
  if (o.kicker) box.querySelector('.sheet-kicker')!.textContent = o.kicker;
  box.querySelector('h2')!.textContent = o.title;
  back.appendChild(box);
  document.body.appendChild(back);
  const was = document.activeElement as HTMLElement | null;
  const inner = box.querySelector<HTMLElement>('.sheet-body')!;
  let isOpen = true;
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') { e.stopImmediatePropagation(); e.preventDefault(); sheet.close(); }
  };
  const sheet: Sheet = {
    el: inner,
    get open() { return isOpen; },
    paint(b, h = handlers) {
      if (!isOpen) return;
      const focusName = (document.activeElement as HTMLInputElement | null)?.name;
      mount(inner, b, h);
      if (focusName) inner.querySelector<HTMLElement>(`[name="${focusName}"]`)?.focus();
    },
    close() {
      if (!isOpen) return;
      isOpen = false;
      removeEventListener('keydown', onKey, true);
      back.classList.add('out');
      setTimeout(() => back.remove(), 140);
      if (current === sheet) current = null;
      was?.focus?.();
      o.onClose?.();
    },
  };
  back.addEventListener('click', (e) => { if (e.target === back) sheet.close(); });
  box.querySelector('.sheet-x')!.addEventListener('click', () => sheet.close());
  addEventListener('keydown', onKey, true);
  sheet.paint(body, handlers);
  sfx.play('click');
  requestAnimationFrame(() => (inner.querySelector<HTMLElement>('[autofocus], input, select, textarea, button') ?? box).focus());
  current = sheet;
  return sheet;
}

export const closeSheet = () => current?.close();

/** A yes/no in the game's own frame, instead of the browser's confirm(). */
export function ask(title: string, body: string, yes = '확인', tone: 'cheong' | 'jeok' | 'hwang' = 'cheong'): Promise<boolean> {
  return new Promise((resolve) => {
    let done = false;
    const s = openSheet({ title, tone, onClose: () => { if (!done) resolve(false); } }, html`<p class="note" style="white-space:pre-line">${body}</p>
      <div class="sheet-actions"><button class="btn ghost" data-act="no">취소</button><button class="btn ${tone === 'jeok' ? 'danger' : tone === 'hwang' ? 'gold' : 'primary'}" data-act="yes" autofocus>${yes}</button></div>`, {
      yes: () => { done = true; resolve(true); s.close(); },
      no: () => { done = true; resolve(false); s.close(); },
    });
  });
}
