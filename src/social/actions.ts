/* What object-card buttons do, wherever a card is drawn (chat, /o pages, share sheets, the bridge):
 * one delegated listener for every [data-ref] button. Also the rent sheet a provider card opens. */
import { denomLabel } from '../api/chain';
import { html, micro, n, toast, type Safe } from '../ui/dom';
import { go } from '../router';
import { openSheet } from '../ui/sheet';
import { resolveRef, cardFor, type RefCard } from './refs';
import { share } from './share';
import { openTransfer } from './transfer';
import { actions } from '../api/actions';
import { quoteLocal } from '../api/planned';
import { KW, BLOCKS_PER_DAY, perKwDay } from '../api/rates';
import type { ProviderRow } from '../api/guild';
import { wallet } from '../wallet/wallet';
import { sfx } from '../game/sfx';

/** Rent capacity from a provider: the whole price shown, the button names the exact amount. */
export function openRent(p: ProviderRow) {
  const min = Number(p.capacity_minimum) / KW, max = Number(p.capacity_maximum) / KW;
  let kw = Math.max(min, Math.min(max, 5)), days = Math.max(Number(p.duration_minimum) / BLOCKS_PER_DAY, Math.min(Number(p.duration_maximum) / BLOCKS_PER_DAY, 3)), busy = false;
  const den = p.rate_denom === 'ualpha' ? 'g' : denomLabel(p.rate_denom);
  const view = (): Safe => {
    const q = quoteLocal(p, Math.round(kw * KW), Math.round(days * BLOCKS_PER_DAY));
    return html`<p class="mono">${micro(perKwDay(p.rate_amount), 4)} ${den} / kW 하루 · ${p.id}</p>
      <label class="field"><span>용량 ${n(kw, 1)} kW (${n(min, 1)}–${n(max, 1)})</span><input type="range" name="kw" min="${min}" max="${max}" step="${Math.max(0.1, (max - min) / 100)}" value="${kw}" data-act="kw"></label>
      <label class="field"><span>기간 ${n(days, 1)}일</span><input type="range" name="days" min="${Number(p.duration_minimum) / BLOCKS_PER_DAY}" max="${Number(p.duration_maximum) / BLOCKS_PER_DAY}" step="0.5" value="${days}" data-act="days"></label>
      <div class="quote-box"><span>미리 내는 금액</span><b class="mono c-hwang">${micro(q.total, 4)} ${den}</b></div>
      ${q.errors.map((e) => html`<div class="notice err">${e}</div>`)}
      ${wallet.state !== 'unlocked' ? html`<div class="notice">계정 잠금을 해제하세요.</div>` : ''}
      <div class="sheet-actions"><button class="btn ghost" data-act="close">취소</button><button class="btn gold" data-act="rent" ${!q.valid || busy || wallet.state !== 'unlocked' ? 'disabled' : ''}>${busy ? '처리 중…' : `${micro(q.total, 2)} ${den} 결제하고 임대`}</button></div>`;
  };
  const handlers = {
    kw: (el: HTMLElement) => { kw = Number((el as HTMLInputElement).value); s.paint(view()); },
    days: (el: HTMLElement) => { days = Number((el as HTMLInputElement).value); s.paint(view()); },
    close: () => s.close(),
    rent: () => {
      busy = true; s.paint(view());
      actions.agreementOpen(p.id, Math.round(kw * KW), Math.round(days * BLOCKS_PER_DAY))
        .then((h) => { sfx.play('coin'); toast(`계약 개설 · ${h.slice(0, 10)}…`); s.close(); })
        .catch((e) => { busy = false; toast('임대 실패: ' + (e as Error).message, 5000); s.paint(view()); });
    },
  };
  const s = openSheet({ kicker: '전력 임대', title: `공급자 ${p.id}`, tone: 'hwang' }, view(), handlers);
}

/* ── Watchlist: objects this commander keeps an eye on (the /o pages and the palette). ── */
const WATCH = 'structs-kor.watch';
export const watchlist = (): string[] => { try { return JSON.parse(localStorage.getItem(WATCH) || '[]'); } catch { return []; } };
let watchFns: (() => void)[] = [];
export const onWatch = (f: () => void) => { watchFns.push(f); return () => { watchFns = watchFns.filter((x) => x !== f); }; };
export function toggleWatch(id: string): boolean {
  const w = watchlist(), on = !w.includes(id);
  try { localStorage.setItem(WATCH, JSON.stringify(on ? [id, ...w].slice(0, 40) : w.filter((x) => x !== id))); } catch { /* fine */ }
  for (const f of watchFns) f();
  return on;
}

async function run(act: string, id: string) {
  const c: RefCard | null = cardFor(id) ?? await resolveRef(id);
  switch (act) {
    case 'share': share({ kind: 'object', id }); return;
    case 'copy': void navigator.clipboard?.writeText(id).then(() => toast(`${id} 복사됨`)); return;
    case 'pay': void openTransfer({ to: c?.owner ?? id }); return;
    case 'message': go(`/chat?dm=${encodeURIComponent(c?.owner ?? id)}`); return;
    case 'planet': if (c?.planetId) go(`/o/${c.planetId}`); return;
    case 'fleet': if (c?.fleetId) go(`/o/${c.fleetId}`); return;
    case 'rent': if (c?.provider) openRent(c.provider); return;
    case 'guild': go(`/guild?id=${encodeURIComponent(c?.guildId ?? id)}`); return;
    case 'join': go(`/guild?id=${encodeURIComponent(c?.guildId ?? id)}&join=1`); return;
    case 'sim': go(`/sim${c?.owner ? `?vs=${encodeURIComponent(c.owner)}` : ''}`); return;
    case 'raid': go(c?.planetId ? `/o/${c.planetId}` : '/console'); return;
    case 'watch': toast(toggleWatch(id) ? `${id} 감시 목록에 추가` : `${id} 감시 해제`); return;
  }
}

let installed = false;
export function installRefActions() {
  if (installed || typeof document === 'undefined') return;
  installed = true;
  document.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement | null)?.closest<HTMLElement>('[data-ref]');
    if (!b?.dataset.id) return;
    e.preventDefault(); e.stopPropagation();
    void run(b.dataset.ref!, b.dataset.id);
  }, true);
}
