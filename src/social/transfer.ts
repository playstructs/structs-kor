/* 송금: send alpha or a guild token to another commander. The recipient is a player (their address
 * comes from the chain, never typed in) or a raw structs1… address; the sender is the commander or
 * any replicant of this wallet. Review shows both faces and the exact amount before anything is
 * signed. After structs-universe transfer.html. */
import { html, raw, n, micro, toast, type Safe } from '../ui/dom';
import { openSheet } from '../ui/sheet';
import { guildApi, type PlayerRow, type BankRow } from '../api/guild';
import { actions } from '../api/actions';
import { wallet } from '../wallet/wallet';
import { session } from '../api/session';
import { portraitHtml, seededPfp } from '../game/portrait';
import { sfx } from '../game/sfx';
import { float } from '../game/fx';

const RECENT = 'structs-kor.pay.recent';
const recent = (): { id: string; name: string }[] => { try { return JSON.parse(localStorage.getItem(RECENT) || '[]'); } catch { return []; } };
const remember = (p: { id: string; name: string }) => { try { localStorage.setItem(RECENT, JSON.stringify([p, ...recent().filter((x) => x.id !== p.id)].slice(0, 6))); } catch { /* fine */ } };

import { parseGrams } from '../core/units';
export { parseGrams };

export interface PayOpts { to?: string; amount?: number; denom?: string; from?: number; memo?: string }

export async function openTransfer(o: PayOpts = {}) {
  const me = session.playerId;
  let step: 'form' | 'review' | 'sent' = 'form', busy = false, err = '', hash = '';
  let toQuery = o.to ?? '', to: PlayerRow | null = null, toAddr = '', amountText = o.amount ? String(o.amount) : '', denom = o.denom ?? 'ualpha', from = o.from ?? 0;
  let tokens: BankRow[] = [], fromRow: PlayerRow | null = null, matches: { id: string; username: string; guild_id: string }[] = [];
  const accounts = wallet.accounts.length ? wallet.accounts : [{ index: 0, address: '', label: '사령관', playerId: me ?? undefined }];
  const selfAddr = () => accounts.find((a) => a.index === from)?.address ?? '';

  const lookup = async () => {
    err = ''; to = null; toAddr = '';
    const q = toQuery.trim();
    if (!q) return;
    if (/^structs1[0-9a-z]{20,80}$/.test(q)) { toAddr = q; return; }
    let id = /^\d+$/.test(q) ? '1-' + q : q;
    if (!/^1-\d+$/.test(id)) {
      // A name: ask the guild who matches.
      matches = await guildApi.playerSearch(q).catch(() => []);
      if (matches.length === 1) id = matches[0].id;
      else { err = matches.length ? '' : `"${q}"와(과) 맞는 사령관이 없습니다.`; return; }
    }
    matches = [];
    try { to = await guildApi.player(id); toAddr = to?.primary_address ?? ''; if (!to) err = `${id} 플레이어가 없습니다.`; } catch { err = '받는 사람을 찾지 못했습니다.'; }
  };
  const loadFrom = async () => {
    const acc = accounts.find((a) => a.index === from);
    fromRow = acc?.playerId ? await guildApi.player(acc.playerId).catch(() => null) : null;
  };
  const grams = () => parseGrams(amountText);
  const unit = () => (denom === 'ualpha' ? 'g' : '토큰');
  const balance = () => (denom === 'ualpha' ? Number(fromRow?.alpha ?? NaN) / 1e6 : NaN);
  const valid = () => !!toAddr && !!grams() && (!Number.isFinite(balance()) || grams()! <= balance() + 1e-9) && toAddr !== selfAddr();

  const face = (p: PlayerRow | null, addr: string, label: string) => html`<div class="pay-party">${raw(portraitHtml(p?.pfp || seededPfp(p?.id || addr), 44))}<div><b>${p?.username || p?.id || '주소'}</b><small class="mono">${p ? `PID #${p.id}` : ''} ${addr ? addr.slice(0, 14) + '…' + addr.slice(-6) : ''}</small></div><span class="label">${label}</span></div>`;

  const view = (): Safe => {
    if (step === 'sent') return html`<div class="pay-done"><i class="si icon-success"></i><h3>보냈습니다</h3><p class="mono">${n(grams() ?? 0, 6)} ${unit()} → ${to?.username || toAddr.slice(0, 16)}</p><p class="mono faint">tx ${hash.slice(0, 16)}…</p><div class="sheet-actions"><button class="btn ghost" data-act="again">한 번 더</button><button class="btn primary" data-act="close" autofocus>닫기</button></div></div>`;
    if (step === 'review') return html`
      ${face(fromRow, selfAddr(), '보내는 사람')}
      <div class="pay-arrow">▼ <b class="mono c-hwang">${n(grams() ?? 0, 6)} ${denom === 'ualpha' ? 'g 알파' : denom}</b></div>
      ${face(to, toAddr, '받는 사람')}
      ${o.memo ? html`<p class="note">${o.memo}</p>` : ''}
      <p class="note">체인 거래는 되돌릴 수 없습니다. 받는 사람을 다시 확인하세요.</p>
      <div class="sheet-actions"><button class="btn ghost" data-act="back">수정</button><button class="btn gold" data-act="sign" ${busy ? 'disabled' : ''} autofocus>${busy ? '서명 중…' : `${n(grams() ?? 0, 4)} ${unit()} 보내기`}</button></div>`;
    const bal = balance();
    return html`
      <label class="field"><span>보내는 계정</span><select class="input" name="from" data-act="from" data-on="change">${accounts.map((a) => html`<option value="${a.index}" ${a.index === from ? 'selected' : ''}>${a.index === 0 ? '사령관' : `레플리칸트 #${a.index}`} · ${a.playerId ?? a.address.slice(0, 12) + '…'}</option>`)}</select></label>
      <label class="field"><span>받는 사람 (이름, 플레이어 ID 또는 주소)</span><input class="input mono" name="to" value="${toQuery}" placeholder="은하수 · 1-42" data-act="to" data-on="change" autocomplete="off"></label>
      ${matches.length > 1 ? html`<div class="pay-recent">${matches.slice(0, 8).map((m) => html`<button class="pill" data-act="pick" data-id="${m.id}">${m.username || m.id} <small class="mono faint">${m.id}</small></button>`)}</div>` : ''}
      ${recent().length ? html`<div class="pay-recent">${recent().filter((r) => r.id !== me).map((r) => html`<button class="pill" data-act="pick" data-id="${r.id}">${r.name}</button>`)}</div>` : ''}
      ${to || toAddr ? face(to, toAddr, '받는 사람') : ''}
      <div class="g2" style="gap:10px">
        <label class="field"><span>자산</span><select class="input" name="denom" data-act="denom" data-on="change"><option value="ualpha">알파 매터</option>${tokens.map((t) => html`<option value="${t.denom}" ${t.denom === denom ? 'selected' : ''}>${t.denom.replace('uguild.', '길드 토큰 ')}</option>`)}</select></label>
        <label class="field"><span>수량 (${unit()}${denom === 'ualpha' ? ' · 1.5k = 1500 g' : ''})</span><input class="input mono" name="amount" value="${amountText}" inputmode="decimal" placeholder="0" data-act="amount"></label>
      </div>
      ${Number.isFinite(bal) ? html`<p class="note">보유 ${n(bal, 4)} g · <button class="linkish" data-act="all">전부 보내기</button></p>` : ''}
      ${err ? html`<div class="notice err">${err}</div>` : ''}
      ${toAddr && toAddr === selfAddr() ? html`<div class="notice err">자기 자신에게는 보낼 수 없습니다.</div>` : ''}
      ${wallet.state !== 'unlocked' ? html`<div class="notice">서명하려면 지갑 잠금을 해제하세요.</div>` : ''}
      <div class="sheet-actions"><button class="btn ghost" data-act="close">취소</button><button class="btn primary" data-act="review" ${!valid() || wallet.state !== 'unlocked' ? 'disabled' : ''}>검토</button></div>`;
  };
  const repaint = () => sheet.paint(view());
  const handlers = {
    from: async (el: HTMLElement) => { from = Number((el as HTMLSelectElement).value); await loadFrom(); repaint(); },
    to: async (el: HTMLElement) => { toQuery = (el as HTMLInputElement).value; await lookup(); repaint(); },
    pick: async (el: HTMLElement) => { toQuery = el.dataset.id!; await lookup(); repaint(); },
    denom: (el: HTMLElement) => { denom = (el as HTMLSelectElement).value; repaint(); },
    amount: (el: HTMLElement) => { amountText = (el as HTMLInputElement).value; const b = sheet.el.querySelector<HTMLButtonElement>('[data-act=review]'); if (b) b.disabled = !valid() || wallet.state !== 'unlocked'; },
    all: () => { const b = balance(); if (Number.isFinite(b)) { amountText = String(Math.floor(b * 1e6) / 1e6); repaint(); } },
    review: () => { if (valid()) { step = 'review'; repaint(); } },
    back: () => { step = 'form'; repaint(); },
    again: () => { step = 'form'; amountText = ''; repaint(); },
    close: () => sheet.close(),
    sign: async (el: HTMLElement) => {
      const g = grams(); if (!g) return;
      busy = true; repaint();
      try {
        hash = await actions.playerSend(toAddr, { denom, amount: String(Math.round(g * 1e6)) }, from);
        if (to) remember({ id: to.id, name: to.username || to.id });
        sfx.play('coin'); float(el, `−${n(g, 2)} ${unit()}`, 'var(--hwang)', true);
        step = 'sent';
      } catch (e) { toast('송금 실패: ' + (e as Error).message, 5000); }
      busy = false; repaint();
    },
  };
  const sheet = openSheet({ kicker: '송금 · SEND', title: denom === 'ualpha' ? '알파 보내기' : '토큰 보내기', tone: 'hwang' }, view(), handlers);
  await Promise.all([loadFrom(), lookup(), guildApi.bank().then((b) => { tokens = b; }).catch(() => null)]);
  repaint();
}

export { micro };
