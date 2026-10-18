/* 에너지 거래소. Providers sell a substation's spare power; an agreement pays capacity × rate ×
 * duration up front into escrow (structs-ai economy/energy-market.md). Rates are per mW per block
 * in the provider's denom; shown per kW·day. Korean market colours: ▲ red up, ▼ blue down. */
import type { Screen } from '../router';
import { html, mount, n, micro, toast, type Safe } from '../ui/dom';
import { needSession, errorCard, loading } from '../ui/gate';
import { guildApi, type AgreementRow, type BankRow, type ProviderRow } from '../api/guild';
import { marketStats, quote, quoteLocal, type MarketStat, type Quote } from '../api/planned';
import { actions } from '../api/actions';
import { KW, BLOCKS_PER_DAY, perKwDay as chainPerKwDay, chainRate, MIN_PER_KW_DAY } from '../api/rates';
import { wallet } from '../wallet/wallet';
import { DEMO_ID } from '../game/demo';
import { sfx } from '../game/sfx';
import { demoExchange } from './exchange-demo';

type Tab = 'buy' | 'mine' | 'sell' | 'bank';
const perKwDay = (p: ProviderRow) => chainPerKwDay(p.rate_amount);
const denomName = (d: string) => (d === 'ualpha' ? 'α' : d.startsWith('uguild.') ? d.replace('uguild.', '토큰 ') : d);
const POLICY: Record<string, string> = { openMarket: '공개', 'open-market': '공개', guildMarket: '길드 전용', 'guild-market': '길드 전용', closedMarket: '비공개', 'closed-market': '비공개' };

interface State { tab: Tab; providers: ProviderRow[]; stats: Map<string, MarketStat>; agreements: AgreementRow[]; bank: BankRow[]; sel: number; capKw: number; days: number; q: Quote | null; busy: boolean }

function buy(s: State): Safe {
  const p = s.providers[s.sel];
  return html`<div class="g2" style="grid-template-columns:minmax(0,1.6fr) minmax(0,1fr)">
    <section class="card flush game-panel">
      <div class="card-head" style="padding:16px"><h1 style="font-size:26px">전력 판매 목록</h1><span class="dim" style="font-size:13px">kW·일 기준 · 저렴한 순</span>
        <span class="end" style="font-size:12px"><span class="c-jeok">▲ 상승</span> · <span class="c-down">▼ 하락</span></span></div>
      <div class="scroll-x"><table class="t" style="min-width:640px"><thead><tr><th>공급자</th><th class="r">요율 / kW·일</th><th class="r">용량</th><th class="r">기간</th><th>접근</th><th class="r">24시간</th></tr></thead><tbody>
      ${s.providers.length ? s.providers.map((x, i) => {
        const st = s.stats.get(x.id);
        const ch = st?.rate_change_24h_pct;
        return html`<tr style="cursor:pointer;background:${i === s.sel ? 'var(--cheong-bg)' : 'transparent'}" data-act="pick" data-i="${i}">
          <td><button class="pill" style="border:0;background:transparent;padding:0;text-align:left;min-height:0" data-act="pick" data-i="${i}"><b class="c-white">${x.id}</b><br><span class="mono faint" style="font-size:11px">변전소 ${x.substation_id}${x.guild_id ? ' · ' + x.guild_id : ''}</span></button></td>
          <td class="r mono c-white">${micro(perKwDay(x), 4)} <span class="dim" style="font-size:11px">${denomName(x.rate_denom)}</span></td>
          <td class="r mono">${n(Number(x.capacity_minimum) / KW, 1)}–${n(Number(x.capacity_maximum) / KW, 1)} kW</td>
          <td class="r mono">${n(Number(x.duration_minimum) / BLOCKS_PER_DAY, 1)}–${n(Number(x.duration_maximum) / BLOCKS_PER_DAY, 1)}일</td>
          <td>${POLICY[x.access_policy] ?? x.access_policy}</td>
          <td class="r mono" style="color:${ch == null ? 'var(--text-faint)' : ch > 0 ? 'var(--jeok)' : ch < 0 ? 'var(--down)' : 'var(--text-dim)'}">${ch == null ? '—' : `${ch > 0 ? '▲' : ch < 0 ? '▼' : ''} ${n(Math.abs(ch), 1)}%`}</td></tr>`;
      }) : html`<tr><td colspan="6" class="empty">판매 중인 전력이 없습니다.</td></tr>`}
      </tbody></table></div>
    </section>
    <section class="card accent game-panel">
      <h2>계약 개설</h2>
      ${p ? html`
        <div><b class="c-cheong-hi" style="color:var(--cheong-hi)">${p.id}</b><br><span class="mono" style="font-size:12px">${micro(perKwDay(p), 4)} ${denomName(p.rate_denom)} / kW·일</span></div>
        <label class="field"><span>용량 (kW)</span><input class="input" type="number" min="0.001" step="0.1" value="${s.capKw}" data-act="cap"></label>
        <label class="field"><span>기간 (일)</span><input class="input" type="number" min="0.1" step="0.5" value="${s.days}" data-act="days"></label>
        <div style="padding:14px;background:var(--sunken);border:1px solid var(--line);display:flex;flex-direction:column;gap:6px">
          <span class="mono dim" style="font-size:13px">${s.capKw} kW × ${micro(perKwDay(p), 4)} × ${s.days}일</span>
          <span style="display:flex;justify-content:space-between;align-items:baseline"><span>선결제 총액</span><b class="mono c-hwang" style="font-size:24px">${s.q ? micro(s.q.total, 4) : '—'} <span style="font-size:13px">${denomName(p.rate_denom)}</span></b></span>
          ${s.q?.errors.map((e) => html`<span class="c-jeok" style="font-size:13px">${e}</span>`)}
        </div>
        <p class="note">총액은 개설 시 에스크로로 전액 결제되고, 공급자에게 블록마다 지급됩니다. 중도 해지 시 위약금 ${p.consumer_cancellation_penalty != null ? n(Number(p.consumer_cancellation_penalty) * 100, 1) + '%' : '[n]%'}.</p>
        <button class="btn primary lg" data-act="open" ${!s.q?.valid || s.busy || wallet.state !== 'unlocked' ? 'disabled' : ''}>계약 개설</button>
        ${wallet.state !== 'unlocked' ? html`<p class="note">서명하려면 지갑 잠금을 해제하세요.</p>` : ''}` : html`<p class="empty">공급자를 선택하세요.</p>`}
    </section></div>`;
}

function mine(s: State): Safe {
  return html`<section class="card flush game-panel"><div class="card-head" style="padding:16px"><h1 style="font-size:26px">내 계약</h1></div>
    <div class="scroll-x"><table class="t" style="min-width:760px"><thead><tr><th>계약</th><th>공급자</th><th class="r">용량</th><th>남은 기간</th><th class="r">에스크로</th><th class="r">작업</th></tr></thead><tbody>
    ${s.agreements.length ? s.agreements.map((a) => {
      const total = a.end_block - a.start_block;
      const left = a.blocks_remaining ?? 0;
      const pct = total > 0 ? Math.max(0, Math.min(100, (left / total) * 100)) : 0;
      return html`<tr><td class="mono c-cheong">${a.id}</td><td class="c-white">${a.provider_id}</td><td class="r mono">${n(Number(a.capacity) / KW, 1)} kW</td>
        <td><div style="display:flex;align-items:center;gap:8px"><div class="meter" style="flex:1 1 auto;min-width:80px"><i style="width:${pct}%;background:${pct < 15 ? 'var(--warn)' : 'var(--cheong)'}"></i></div><span class="mono" style="font-size:12px">${n(left / BLOCKS_PER_DAY, 1)} / ${n(total / BLOCKS_PER_DAY, 1)}일</span></div></td>
        <td class="r mono">${a.escrow_remaining != null ? micro(a.escrow_remaining, 2) : '—'}</td>
        <td class="r"><div style="display:inline-flex;gap:6px"><button class="btn ghost" data-act="extend" data-id="${a.id}" ${wallet.state !== 'unlocked' ? 'disabled' : ''}>1일 연장</button><button class="btn outline-danger" data-act="close" data-id="${a.id}" ${wallet.state !== 'unlocked' ? 'disabled' : ''}>해지</button></div></td></tr>`;
    }) : html`<tr><td colspan="6" class="empty">진행 중인 계약이 없습니다.</td></tr>`}
    </tbody></table></div></section>`;
}

function sell(): Safe {
  return html`<section class="card game-panel" style="max-width:820px">
    <h1 style="font-size:26px">전력 판매하기</h1>
    <p class="note">변전소의 남는 전력을 공급자로 등록해 판매합니다. 쓰지 않은 용량은 그 블록에서 사라집니다.</p>
    <form data-act="create" data-on="submit" style="display:flex;flex-direction:column;gap:14px">
      <div class="g2" style="gap:12px">
        <label class="field"><span>판매 변전소</span><input class="input" name="sub" placeholder="4-…" required></label>
        <label class="field"><span>통화 (체인 단위: ualpha = 알파)</span><input class="input" name="denom" value="ualpha" required></label>
        <label class="field"><span>요율 (알파 또는 토큰 / kW·일 · 체인 최소 ${n(MIN_PER_KW_DAY)})</span><input class="input" name="rate" type="number" step="any" min="${MIN_PER_KW_DAY}" required></label>
        <label class="field"><span>접근 정책</span><select class="input" name="policy"><option value="openMarket">공개</option><option value="guildMarket">길드 전용</option><option value="closedMarket">비공개</option></select></label>
        <label class="field"><span>최소 용량 (kW)</span><input class="input" name="cmin" type="number" step="any" value="1"></label>
        <label class="field"><span>최대 용량 (kW)</span><input class="input" name="cmax" type="number" step="any" value="20"></label>
        <label class="field"><span>최소 기간 (일)</span><input class="input" name="dmin" type="number" step="any" value="1"></label>
        <label class="field"><span>최대 기간 (일)</span><input class="input" name="dmax" type="number" step="any" value="14"></label>
        <label class="field"><span>구매자 해지 위약금 (0–1)</span><input class="input" name="pc" value="0.1"></label>
        <label class="field"><span>공급자 해지 위약금 (0–1)</span><input class="input" name="pp" value="0.1"></label>
      </div>
      <button class="btn primary lg" ${wallet.state !== 'unlocked' ? 'disabled' : ''}>공급자 등록</button>
    </form></section>`;
}

function bank(s: State): Safe {
  return html`<section class="card flush game-panel"><div class="card-head" style="padding:16px"><h1 style="font-size:26px">길드 중앙은행</h1><span class="dim" style="font-size:13px">알파 담보 토큰 · 담보율 = 담보 ÷ 발행량</span></div>
    <div class="scroll-x"><table class="t" style="min-width:560px"><thead><tr><th>길드</th><th>토큰</th><th class="r">담보 (알파)</th><th class="r">발행량</th><th class="r">담보율</th></tr></thead><tbody>
    ${s.bank.length ? s.bank.map((b) => html`<tr><td class="c-white">${b.guild_id}</td><td class="mono">${b.denom}</td><td class="r mono c-hwang">${micro(b.collateral)} g</td><td class="r mono">${micro(b.supply)}</td><td class="r mono c-cheong">${n(b.ratio, 4)}</td></tr>`) : html`<tr><td colspan="5" class="empty">은행 정보가 없습니다.</td></tr>`}
    </tbody></table></div></section>`;
}

const screen: Screen = {
  async render(root) {
    const pid = needSession(root, '알파 거래소', { demo: true });
    if (!pid) return;
    if (pid === DEMO_ID) return demoExchange(root);
    mount(root, loading());
    const s: State = { tab: 'buy', providers: [], stats: new Map(), agreements: [], bank: [], sel: 0, capKw: 10, days: 7, q: null, busy: false };
    const requote = () => {
      const p = s.providers[s.sel];
      if (!p) { s.q = null; return; }
      const cap = Math.round(s.capKw * KW), dur = Math.round(s.days * BLOCKS_PER_DAY);
      s.q = quoteLocal(p, cap, dur);
      void quote(p, cap, dur).then((q) => { s.q = q; paint(); }).catch(() => null);
    };
    const tabs = (): Safe => html`<div class="tabs" role="tablist">${([['buy', '구매'], ['mine', '내 계약'], ['sell', '판매'], ['bank', '길드 은행']] as [Tab, string][]).map(([t, l]) => html`<button class="tab ${s.tab === t ? 'on' : ''}" role="tab" aria-selected="${s.tab === t}" data-act="tab" data-t="${t}">${l}</button>`)}</div>`;
    const paint = () => { if (root.isConnected) mount(root, html`<div class="card-head"><h1 style="font-size:28px">알파 거래소</h1><span class="label c-cheong">ALPHA EXCHANGE</span></div>${tabs()}${s.tab === 'buy' ? buy(s) : s.tab === 'mine' ? mine(s) : s.tab === 'sell' ? sell() : bank(s)}`, handlers); };
    const sign = (p: Promise<string>) => { s.busy = true; paint(); p.then((h) => { sfx.play('coin'); toast(`전송됨 · ${h.slice(0, 10)}…`); }).catch((e) => toast('실패: ' + (e as Error).message, 5000)).finally(() => { s.busy = false; paint(); }); };
    const handlers = {
      tab: (el: HTMLElement) => { s.tab = el.dataset.t as Tab; paint(); },
      pick: (el: HTMLElement) => { s.sel = Number(el.dataset.i); requote(); paint(); },
      cap: (el: HTMLElement) => { s.capKw = Number((el as HTMLInputElement).value) || 0; requote(); paint(); },
      days: (el: HTMLElement) => { s.days = Number((el as HTMLInputElement).value) || 0; requote(); paint(); },
      open: () => { const p = s.providers[s.sel]; if (p) sign(actions.agreementOpen(p.id, Math.round(s.capKw * KW), Math.round(s.days * BLOCKS_PER_DAY))); },
      extend: (el: HTMLElement) => sign(actions.agreementExtend(el.dataset.id!, BLOCKS_PER_DAY)),
      close: (el: HTMLElement) => { if (confirm('계약을 해지하면 위약금이 적용될 수 있습니다. 해지할까요?')) sign(actions.agreementClose(el.dataset.id!)); },
      create: (el: HTMLElement) => {
        const f = new FormData(el as HTMLFormElement);
        const num = (k: string) => Number(f.get(k));
        // The chain takes whole µ per mW·block: say what the ask really lists at before signing.
        const rate = chainRate(num('rate'));
        if (rate.changed && !confirm(`체인 요율은 µ/mW·블록 정수라서 입력한 ${n(num('rate'), 2)}이(가) 아니라 ${n(rate.listed, 2)} / kW·일로 등록됩니다. 이대로 등록할까요?`)) return;
        sign(actions.providerCreate({
          substationId: String(f.get('sub')), rate: { denom: String(f.get('denom')), amount: rate.amount },
          accessPolicy: String(f.get('policy')) as 'openMarket', capacityMinimum: Math.round(num('cmin') * KW), capacityMaximum: Math.round(num('cmax') * KW),
          durationMinimum: Math.round(num('dmin') * BLOCKS_PER_DAY), durationMaximum: Math.round(num('dmax') * BLOCKS_PER_DAY),
          consumerCancellationPenalty: String(f.get('pc')), providerCancellationPenalty: String(f.get('pp')),
        }));
      },
    };
    try {
      const [providers, stats, agreements, bankRows] = await Promise.all([
        guildApi.providerMarket(), marketStats().catch(() => []), guildApi.agreementsOf(pid).catch(() => []), guildApi.bank().catch(() => []),
      ]);
      s.providers = [...providers].sort((a, b) => perKwDay(a) - perKwDay(b));
      s.stats = new Map(stats.map((x) => [x.provider_id, x]));
      s.agreements = agreements; s.bank = bankRows;
      requote();
      paint();
    } catch (e) { mount(root, errorCard(e)); }
  },
};
export default screen;
