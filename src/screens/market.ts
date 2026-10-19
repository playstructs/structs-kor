/* 시장: the power market, your contracts, your providers, the guild banks and your wallet.
 * Providers sell a substation's spare power; an agreement pays capacity × rate × duration up front
 * into escrow (structs-ai economy/energy-market.md). Rates are per mW per block in the provider's
 * denom; shown per kW·day, and every offer also in comparable alpha (guild tokens at their bank's
 * collateral ratio). Korean market colours: ▲ red up, ▼ blue down. Every offer can be shared. */
import type { Screen } from '../router';
import { href } from '../router';
import { html, mount, n, micro, toast, raw, esc, type Safe } from '../ui/dom';
import { needSession, errorCard, loading } from '../ui/gate';
import { guildApi, type AgreementRow, type BankRow, type ProviderRow, type PlayerRow, type BucketVolume } from '../api/guild';
import { marketStats, quote, quoteLocal, type MarketStat, type Quote } from '../api/planned';
import { actions } from '../api/actions';
import { balances, denomLabel, type Coin } from '../api/chain';
import { call } from '../api/http';
import { nameOf, onNames } from '../api/names';
import { KW, BLOCKS_PER_DAY, perKwDay as chainPerKwDay, chainRate, MIN_PER_KW_DAY } from '../api/rates';
import { wallet } from '../wallet/wallet';
import { sfx } from '../game/sfx';
import { share } from '../social/share';
import { offerSituation } from '../social/situations';
import { openTransfer, parseGrams } from '../social/transfer';
import { setTiles } from '../ui/shell';

type Tab = 'buy' | 'mine' | 'sell' | 'bank' | 'wallet';
const TABS: [Tab, string][] = [['buy', '구매'], ['mine', '내 계약'], ['sell', '판매 · 내 공급자'], ['bank', '길드 은행'], ['wallet', '보유품']];
const perKwDay = (p: ProviderRow) => chainPerKwDay(p.rate_amount);
const denomName = (d: string) => (d === 'ualpha' ? 'g' : denomLabel(d));
const POLICY: Record<string, string> = { openMarket: '공개', 'open-market': '공개', guildMarket: '길드 전용', 'guild-market': '길드 전용', closedMarket: '비공개', 'closed-market': '비공개' };

interface State {
  tab: Tab; me: PlayerRow | null; providers: ProviderRow[]; mineProv: ProviderRow[]; stats: Map<string, MarketStat>; agreements: AgreementRow[]; bank: BankRow[];
  coins: Coin[]; sel: number; capKw: number; days: number; q: Quote | null; busy: boolean; sort: 'price' | 'cap' | 'alpha'; policy: '' | 'open' | 'guild';
  bankGuild: string; bankAmount: string; hist: Map<string, BucketVolume[] | null>; ledger: Record<string, unknown>[] | null | undefined;
}
/** An offer in comparable alpha per kW·day: guild tokens at their bank's collateral ratio. */
function alphaEq(s: State, p: ProviderRow): number | null {
  if (p.rate_denom === 'ualpha') return perKwDay(p);
  const b = s.bank.find((x) => x.denom === p.rate_denom);
  return b ? perKwDay(p) * Number(b.ratio) : null;
}
const unlocked = () => wallet.state === 'unlocked';

function buy(s: State): Safe {
  const list = s.providers.filter((p) => !s.policy || (s.policy === 'open' ? /^open/i.test(p.access_policy) : /^guild/i.test(p.access_policy)));
  const p = s.providers[s.sel];
  return html`<div class="g2" style="grid-template-columns:minmax(0,1.6fr) minmax(0,1fr)">
    <section class="card flush game-panel">
      <div class="card-head" style="padding:16px"><h1 style="font-size:26px">전력 판매 목록</h1><span class="dim" style="font-size:13px">kW 하루 기준</span>
        <span class="end mkt-filters">
          <select class="input" data-act="sort" data-on="change" aria-label="정렬"><option value="price" ${s.sort === 'price' ? 'selected' : ''}>저렴한 순 (알파 기준)</option><option value="cap" ${s.sort === 'cap' ? 'selected' : ''}>용량 큰 순</option></select>
          <select class="input" data-act="policy" data-on="change" aria-label="접근"><option value="">모든 제안</option><option value="open" ${s.policy === 'open' ? 'selected' : ''}>공개 시장</option><option value="guild" ${s.policy === 'guild' ? 'selected' : ''}>길드 전용</option></select>
        </span></div>
      <div class="scroll-x"><table class="t" style="min-width:700px"><thead><tr><th>판매자</th><th class="r">요율 / kW 하루</th><th class="r">알파로 치면</th><th class="r">용량</th><th class="r">기간</th><th>접근</th>${s.stats.size ? html`<th class="r">24시간</th>` : ''}</tr></thead><tbody>
      ${list.length ? list.map((x) => {
        const i = s.providers.indexOf(x), st = s.stats.get(x.id), ch = st?.rate_change_24h_pct, eq = alphaEq(s, x);
        return html`<tr class="${i === s.sel ? 'sel' : ''}" style="cursor:pointer;background:${i === s.sel ? 'var(--cheong-bg)' : 'transparent'}" data-act="pick" data-i="${i}">
          <td><a class="c-white" href="${href(`/o/${x.owner}`)}"><b>${nameOf(x.owner)}</b></a><br><span class="faint" style="font-size:11px">변전소 ${x.substation_id}</span></td>
          <td class="r mono c-white">${micro(perKwDay(x), 4)} <span class="dim" style="font-size:11px">${denomName(x.rate_denom)}</span></td>
          <td class="r mono c-hwang">${eq == null ? '—' : micro(eq, 3) + ' g'}</td>
          <td class="r mono">${n(Number(x.capacity_minimum) / KW, 1)}–${n(Number(x.capacity_maximum) / KW, 1)} kW</td>
          <td class="r mono">${n(Number(x.duration_minimum) / BLOCKS_PER_DAY, 1)}–${n(Number(x.duration_maximum) / BLOCKS_PER_DAY, 1)}일</td>
          <td>${POLICY[x.access_policy] ?? x.access_policy}</td>
          ${s.stats.size ? html`<td class="r mono" style="color:${ch == null ? 'var(--text-faint)' : ch > 0 ? 'var(--jeok)' : ch < 0 ? 'var(--down)' : 'var(--text-dim)'}">${ch == null ? '—' : `${ch > 0 ? '▲' : ch < 0 ? '▼' : ''} ${n(Math.abs(ch), 1)}%`}</td>` : ''}</tr>`;
      }) : html`<tr><td colspan="7" class="empty">판매 중인 전력이 없습니다.</td></tr>`}
      </tbody></table></div>
    </section>
    <section class="card accent game-panel">
      <h2>계약 개설</h2>
      ${p ? html`
        <div><b style="color:var(--cheong-hi)">${nameOf(p.owner)}의 전력</b><br><span class="mono" style="font-size:12px">${micro(perKwDay(p), 4)} ${denomName(p.rate_denom)} / kW 하루 · 변전소 ${p.substation_id}</span></div>
        <label class="field"><span>용량 (kW)</span><input class="input" type="number" min="0.001" step="0.1" value="${s.capKw}" data-act="cap"></label>
        <label class="field"><span>기간 (일)</span><input class="input" type="number" min="0.1" step="0.5" value="${s.days}" data-act="days"></label>
        <div class="quote-box" style="flex-direction:column;align-items:stretch;gap:6px">
          <span class="mono dim" style="font-size:13px">${s.capKw} kW × ${micro(perKwDay(p), 4)} × ${s.days}일</span>
          <span style="display:flex;justify-content:space-between;align-items:baseline"><span>선결제 총액</span><b class="mono c-hwang">${s.q ? micro(s.q.total, 4) : '—'} <span style="font-size:13px">${denomName(p.rate_denom)}</span></b></span>
          ${s.q?.errors.map((e) => html`<span class="c-jeok" style="font-size:13px">${e}</span>`)}
        </div>
        <p class="note">계약할 때 총액을 미리 내고, 공급자는 전력을 보내는 만큼 나눠 받습니다. 중간에 끊으면 남은 금액의 ${p.consumer_cancellation_penalty != null ? n(Number(p.consumer_cancellation_penalty) * 100, 1) + '%' : '일부'}를 잃습니다.</p>
        ${(() => {
          // Can't pay: say so on the button instead of letting the chain refuse it.
          const have = Number(s.coins.find((c) => c.denom === p.rate_denom)?.amount ?? 0), short = !!s.q && have < Number(s.q.total);
          return html`<button class="btn primary lg" data-act="open" ${!s.q?.valid || short || s.busy || !unlocked() ? 'disabled' : ''}>${short ? `${denomLabel(p.rate_denom)} 부족 · 보유 ${micro(have, 2)}${p.rate_denom === 'ualpha' ? ' g' : ''}` : s.q ? `${micro(s.q.total, 2)} ${denomName(p.rate_denom)} 내고 계약` : '계약하기'}</button>`;
        })()}
        ${unlocked() ? '' : html`<p class="note">계정 잠금을 해제하세요.</p>`}` : html`<p class="empty">공급자를 선택하세요.</p>`}
    </section></div>`;
}

function mine(s: State): Safe {
  return html`<section class="card flush game-panel"><div class="card-head" style="padding:16px"><h1 style="font-size:26px">내 계약</h1><span class="end dim" style="font-size:13px">산 전력 · 만료까지</span></div>
    <div class="scroll-x"><table class="t" style="min-width:860px"><thead><tr><th>계약</th><th>공급자</th><th class="r">용량</th><th>남은 기간</th><th class="r">남은 선결제</th><th class="r">작업</th></tr></thead><tbody>
    ${s.agreements.length ? s.agreements.map((a) => {
      const total = a.end_block - a.start_block, left = a.blocks_remaining ?? 0, pct = total > 0 ? Math.max(0, Math.min(100, (left / total) * 100)) : 0;
      return html`<tr><td class="mono c-cheong">${a.id}</td><td><a href="${href(`/o/${a.provider_id}`)}">${a.provider_id}</a></td><td class="r mono">${n(Number(a.capacity) / KW, 1)} kW</td>
        <td><div style="display:flex;align-items:center;gap:8px"><div class="meter" style="flex:1 1 auto;min-width:80px"><i style="width:${pct}%;background:${pct < 15 ? 'var(--warn)' : 'var(--cheong)'}"></i></div><span class="mono" style="font-size:12px">${n(left / BLOCKS_PER_DAY, 1)} / ${n(total / BLOCKS_PER_DAY, 1)}일</span></div></td>
        <td class="r mono">${a.escrow_remaining != null ? micro(a.escrow_remaining, 2) : '—'}</td>
        <td class="r"><div style="display:inline-flex;gap:4px;flex-wrap:wrap;justify-content:flex-end">
          <button class="btn ghost sm" data-act="capUp" data-id="${a.id}" ${unlocked() ? '' : 'disabled'} title="용량 +1 kW">+1 kW</button>
          <button class="btn ghost sm" data-act="capDown" data-id="${a.id}" ${unlocked() && Number(a.capacity) > KW ? '' : 'disabled'} title="용량 −1 kW">−1 kW</button>
          <button class="btn ghost sm" data-act="extend" data-id="${a.id}" ${unlocked() ? '' : 'disabled'}>1일 연장</button>
          <button class="btn outline-danger sm" data-act="close" data-id="${a.id}" ${unlocked() ? '' : 'disabled'}>해지</button></div></td></tr>`;
    }) : html`<tr><td colspan="6" class="empty">진행 중인 계약이 없습니다. <button class="linkish" data-act="tab" data-t="buy">전력 사러 가기</button></td></tr>`}
    </tbody></table></div></section>`;
}

function sell(s: State): Safe {
  return html`<div class="g2" style="align-items:start">
  <section class="card game-panel">
    <h1 style="font-size:26px">전력 판매하기</h1>
    <p class="note">변전소의 남는 전력을 공급자로 등록해 판매합니다. 쓰지 않은 용량은 바로 사라집니다.</p>
    <form data-act="create" data-on="submit" style="display:flex;flex-direction:column;gap:14px">
      <div class="g2" style="gap:12px">
        <label class="field"><span>판매 변전소</span><input class="input" name="sub" placeholder="4-…" value="${s.me?.substation_id ?? ''}" required></label>
        <label class="field"><span>받을 통화</span><select class="input" name="denom"><option value="ualpha">알파</option>${s.coins.filter((c) => c.denom.startsWith('uguild.')).map((c) => html`<option value="${c.denom}">${denomLabel(c.denom)}</option>`)}</select></label>
        <label class="field"><span>요율 (/ kW 하루 · 최소 ${n(MIN_PER_KW_DAY)})</span><input class="input" name="rate" type="number" step="any" min="${MIN_PER_KW_DAY}" required></label>
        <label class="field"><span>접근 정책</span><select class="input" name="policy"><option value="openMarket">공개</option><option value="guildMarket">길드 전용</option><option value="closedMarket">비공개</option></select></label>
        <label class="field"><span>최소 용량 (kW)</span><input class="input" name="cmin" type="number" step="any" value="1"></label>
        <label class="field"><span>최대 용량 (kW)</span><input class="input" name="cmax" type="number" step="any" value="20"></label>
        <label class="field"><span>최소 기간 (일)</span><input class="input" name="dmin" type="number" step="any" value="1"></label>
        <label class="field"><span>최대 기간 (일)</span><input class="input" name="dmax" type="number" step="any" value="14"></label>
        <label class="field"><span>구매자가 끊을 때 손실 (0–1)</span><input class="input" name="pc" value="0.1"></label>
        <label class="field"><span>판매자가 끊을 때 손실 (0–1)</span><input class="input" name="pp" value="0.1"></label>
      </div>
      <button class="btn primary lg" ${unlocked() ? '' : 'disabled'}>공급자 등록</button>
    </form></section>
  <section class="card game-panel"><div class="card-head"><h2>내 공급자</h2><span class="end mono dim">${n(s.mineProv.length)}</span></div>
    ${s.mineProv.length ? html`<div class="prov-list">${s.mineProv.map((p) => html`<article class="prov">
      <div class="prov-top"><a href="${href(`/o/${p.id}`)}"><b class="c-white">${p.id}</b></a><span class="mono">${micro(perKwDay(p), 4)} ${denomName(p.rate_denom)}/kW 하루</span><span class="chip ${/^open/i.test(p.access_policy) ? 'cheong' : 'hwang'}">${POLICY[p.access_policy] ?? p.access_policy}</span></div>
      <span class="mono dim" style="font-size:12px">${n(Number(p.capacity_minimum) / KW, 1)}–${n(Number(p.capacity_maximum) / KW, 1)} kW · 판매 중 ${p.committed_capacity != null ? n(Number(p.committed_capacity) / KW, 1) + ' kW' : '—'}</span>
      <div class="prov-acts">
        <select class="input" data-act="access" data-on="change" data-id="${p.id}" aria-label="접근 정책" ${unlocked() ? '' : 'disabled'}>${['openMarket', 'guildMarket', 'closedMarket'].map((k) => html`<option value="${k}" ${p.access_policy === k ? 'selected' : ''}>${POLICY[k]}</option>`)}</select>
        <button class="btn gold sm" data-act="withdraw" data-id="${p.id}" ${unlocked() ? '' : 'disabled'}>수익 인출</button>
        <button class="btn ghost sm" data-act="shareProv" data-id="${p.id}">공유</button>
        <button class="btn outline-danger sm" data-act="delete" data-id="${p.id}" ${unlocked() ? '' : 'disabled'}>삭제</button>
      </div></article>`)}</div>` : html`<p class="empty">아직 등록한 공급자가 없습니다.</p>`}
  </section></div>`;
}

const ACTION_KO: Record<string, string> = { mint: '만들기', redeem: '되돌림', convert: '교환', burn: '없앰', confiscate: '몰수' };
/** Daily token volume for one guild bank: one bar per day, the per-action split in each bar's tooltip. */
function bankChart(rows: BucketVolume[] | null | undefined): Safe {
  if (rows === undefined) return html`<p class="note">거래량 불러오는 중…</p>`;
  if (!rows || !rows.length) return html`<p class="note">이 은행의 교환 기록이 아직 없습니다.</p>`;
  const by = new Map<string, Map<string, number>>();
  for (const r of rows) { const b = by.get(r.bucket) ?? new Map(); b.set(r.action, (b.get(r.action) ?? 0) + Number(r.volume) / 1e6); by.set(r.bucket, b); }
  const days = [...by.keys()].sort().slice(-14);
  const total = (d: string) => [...by.get(d)!.values()].reduce((a, b) => a + b, 0);
  const max = Math.max(1, ...days.map(total));
  const W = 560, H = 140, gap = 2, bw = (W - gap * (days.length - 1)) / days.length;
  const label = (d: string) => new Date(d).toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' });
  return html`<figure class="bank-chart"><svg viewBox="0 0 ${W} ${H + 22}" role="img" aria-label="최근 ${days.length}일 화폐 교환량">
    <line x1="0" x2="${W}" y1="${H}" y2="${H}" class="bc-axis"/>
    ${days.map((d, i) => { const v = total(d), h = Math.max(2, (v / max) * (H - 8)), x = i * (bw + gap);
      return raw(`<g class="bc-bar"><rect x="${x}" y="0" width="${bw}" height="${H}" class="bc-hit"/><rect x="${x}" y="${H - h}" width="${bw}" height="${h}" rx="2" class="bc-fill"/><title>${label(d)} · ${n(v, 2)}
${[...by.get(d)!].map(([a, x2]) => `${esc(ACTION_KO[a] ?? a)} ${n(x2, 2)}`).join('\n')}</title>${i % Math.ceil(days.length / 7) === 0 ? `<text x="${x + bw / 2}" y="${H + 18}" class="bc-x">${label(d)}</text>` : ''}</g>`); })}
  </svg><figcaption class="note">최근 ${days.length}일 · 일별 화폐 교환량 (최대 ${n(max, 1)}) · 막대에 마우스를 올리면 만들기·되돌림 내역</figcaption>
  <table class="sr"><caption>일별 화폐 교환량</caption><thead><tr><th>날짜</th><th>거래량</th></tr></thead><tbody>${days.map((d) => html`<tr><td>${label(d)}</td><td>${n(total(d), 2)}</td></tr>`)}</tbody></table></figure>`;
}

function bank(s: State): Safe {
  const mineCoin = (d: string) => s.coins.find((c) => c.denom === d);
  const g = s.bank.find((b) => b.guild_id === s.bankGuild) ?? s.bank[0];
  const held = g ? Number(mineCoin(g.denom)?.amount ?? 0) / 1e6 : 0;
  const alpha = Number(mineCoin('ualpha')?.amount ?? s.me?.alpha ?? 0) / 1e6;
  const amt = parseGrams(s.bankAmount) ?? 0;
  const ratio = g ? Number(g.ratio) : 0;
  return html`<div class="g2" style="grid-template-columns:minmax(0,1.4fr) minmax(0,1fr);align-items:start">
    <section class="card flush game-panel"><div class="card-head" style="padding:16px"><h1 style="font-size:26px">길드 중앙은행</h1><span class="dim" style="font-size:13px">알파로 뒷받침되는 길드 화폐 · 교환 비율 = 맡긴 알파 ÷ 유통량</span></div>
    <div class="scroll-x"><table class="t" style="min-width:640px"><thead><tr><th>길드</th><th>화폐</th><th class="r">맡긴 알파</th><th class="r">유통량</th><th class="r">교환 비율</th><th class="r">내 보유</th></tr></thead><tbody>
    ${s.bank.length ? s.bank.map((b) => html`<tr style="cursor:pointer;background:${b === g ? 'var(--cheong-bg)' : 'transparent'}" data-act="bankPick" data-g="${b.guild_id}"><td><a class="c-white" href="${href(`/o/${b.guild_id}`)}">${b.guild_id}</a></td><td class="mono">${b.denom}</td><td class="r mono c-hwang">${micro(b.collateral)} g</td><td class="r mono">${micro(b.supply)}</td>
      <td class="r mono" style="color:${Number(b.ratio) >= 1 ? 'var(--cheong)' : 'var(--jeok)'}">${n(b.ratio, 4)}</td><td class="r mono">${micro(mineCoin(b.denom)?.amount ?? 0, 2)}</td></tr>`) : html`<tr><td colspan="6" class="empty">은행 정보가 없습니다.</td></tr>`}
    </tbody></table></div>
    <div style="padding:14px 16px">${g ? html`<h3 class="sub-h">${g.guild_id} 거래량</h3>${bankChart(s.hist.get(g.guild_id))}` : ''}</div></section>
    <section class="card accent game-panel"><h2>화폐 교환</h2>
      ${g ? html`<p class="mono" style="margin:0">${denomLabel(g.denom)} · 교환 비율 ${n(ratio, 4)} · 길드 화폐 1 ≈ ${n(ratio, 4)} g</p>
        <label class="field"><span>수량 (알파 g / 화폐)</span><input class="input mono" name="bankAmount" value="${s.bankAmount}" data-act="bankAmount" placeholder="0" inputmode="decimal"></label>
        <div class="quote-box"><span>알파 → 길드 화폐</span><b class="mono">${amt && ratio ? n(amt / ratio, 4) : '—'} 길드 화폐</b></div>
        <div class="quote-box"><span>길드 화폐 → 알파</span><b class="mono c-hwang">${amt && ratio ? n(amt * ratio, 4) : '—'} g</b></div>
        <p class="note">보유: 알파 ${n(alpha, 3)} g · 길드 화폐 ${n(held, 3)}. 교환은 길드 은행이 교환 비율로 처리하며, 예상보다 1% 넘게 불리하면 취소됩니다.</p>
        <div style="display:flex;gap:6px;flex-wrap:wrap">
          <button class="btn primary" data-act="convert" ${!amt || amt > alpha || !unlocked() || s.busy ? 'disabled' : ''}>알파로 길드 화폐 받기</button>
          <button class="btn gold" data-act="redeem" ${!amt || amt > held || !unlocked() || s.busy ? 'disabled' : ''}>길드 화폐로 알파 받기</button>
          ${s.me?.guild_id === g.guild_id ? html`<button class="btn ghost" data-act="mint" ${!amt || !unlocked() || s.busy ? 'disabled' : ''} title="길드 운영진: 알파를 맡기고 길드 화폐를 만듭니다">화폐 만들기 (운영진)</button>` : ''}
        </div>` : html`<p class="empty">은행을 고르세요.</p>`}
    </section></div>`;
}

const LEDGER_KO: Record<string, string> = { mined: '채굴', refined: '정제', seized: '약탈', forfeited: '빼앗김', sent: '보냄', received: '받음', infused: '주입', defused: '회수', minted: '만들기', burned: '없앰', redeemed: '되돌림', converted: '교환', diverted: '전환' };
function ledgerList(rows: Record<string, unknown>[] | null | undefined): Safe {
  if (rows === undefined) return html`<p class="note">내역 불러오는 중…</p>`;
  if (!rows || !rows.length) return html`<p class="note">거래 내역이 없습니다.</p>`;
  return html`<ol class="ledger">${rows.slice(0, 40).map((r) => {
    const action = String(r.action ?? ''), denom = String(r.denom ?? ''), raw0 = Number(r.amount_p ?? r.amount ?? 0);
    const amt = denom.startsWith('u') ? raw0 / 1e6 : raw0;
    const out = /sent|forfeited|infused|burned|redeemed|seized_from/.test(action);
    const when = String(r.time ?? r.created_at ?? r.updated_at ?? '');
    const other = String(r.counterparty ?? r.other_player_id ?? r.destination ?? r.source ?? '');
    return html`<li class="${out ? 'out' : 'in'}"><b>${LEDGER_KO[action] ?? action}</b><span class="mono">${out ? '−' : '+'}${n(amt, denom.startsWith('u') ? 4 : 0)} ${denomLabel(denom.replace(/\.infused$/, ''))}</span>${/^\d{1,2}-\d+$/.test(other) ? html`<a class="mono" href="${href(`/o/${other}`)}">${other}</a>` : html`<span></span>`}<small class="mono faint">${when ? new Date(when).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : r.block_height ? '#' + n(r.block_height) : ''}</small></li>`;
  })}</ol>`;
}

function walletTab(s: State): Safe {
  return html`<div class="g2" style="align-items:start">
    <section class="card game-panel"><div class="card-head"><h2>내 보유품</h2></div>
      ${s.coins.length ? html`<ul class="coins">${s.coins.map((c) => html`<li><span class="coin-ico ${c.denom === 'ualpha' ? 'alpha' : 'token'}"></span><div><b>${denomLabel(c.denom)}</b></div><strong class="mono ${c.denom === 'ualpha' ? 'c-hwang' : ''}">${micro(c.amount, 4)}</strong><button class="btn ghost sm" data-act="send" data-d="${c.denom}" ${unlocked() ? '' : 'disabled'}>보내기</button></li>`)}</ul>` : html`<p class="empty">잔액이 없습니다.</p>`}
      <button class="btn gold" data-act="send" data-d="ualpha" ${unlocked() ? '' : 'disabled'}>알파 보내기</button>
    </section>
    <section class="card game-panel"><h2>보유품 기록</h2>${ledgerList(s.ledger)}</section>
    <section class="card game-panel"><h2>레플리칸트 보유품</h2>
      <p class="note">레플리칸트의 알파는 <a href="${href('/replicants')}">레플리칸트</a> 화면에서 한 번에 회수하거나, 여기서 개별로 보낼 수 있습니다.</p>
      <ul class="coins">${wallet.accounts.filter((a) => a.index > 0).slice(0, 12).map((a) => html`<li><span class="coin-ico rep"></span><div><b>#${a.index} ${a.playerId ?? ''}</b><small class="mono">${a.address.slice(0, 18)}…</small></div><button class="btn ghost sm" data-act="sendFrom" data-i="${a.index}" ${unlocked() ? '' : 'disabled'}>보내기</button></li>`)}</ul>
      ${wallet.accounts.some((a) => a.index > 0) ? '' : html`<p class="empty">레플리칸트가 없습니다.</p>`}
    </section></div>`;
}

const screen: Screen = {
  async render(root, params) {
    const pid = needSession(root, '시장');
    if (!pid) return;
    mount(root, loading());
    const startTab = (params.get('tab') as Tab) || 'buy';
    const s: State = { tab: TABS.some(([t]) => t === startTab) ? startTab : 'buy', me: null, providers: [], mineProv: [], stats: new Map(), agreements: [], bank: [], coins: [], sel: 0, capKw: 10, days: 7, q: null, busy: false, sort: 'price', policy: '', bankGuild: '', bankAmount: '', hist: new Map(), ledger: undefined };
    let quoteTicket = 0;
    const requote = () => {
      const p = s.providers[s.sel];
      if (!p) { s.q = null; return; }
      const cap = Math.round(s.capKw * KW), dur = Math.round(s.days * BLOCKS_PER_DAY);
      s.q = quoteLocal(p, cap, dur);
      // Only the newest ask's answer may land: an older one would price an earlier capacity.
      const ticket = ++quoteTicket;
      void quote(p, cap, dur).then((q) => { if (ticket === quoteTicket) { s.q = q; paint(); } }).catch(() => null);
    };
    const resort = () => {
      const cur = s.providers[s.sel]?.id;
      s.providers.sort((a, b) => s.sort === 'cap' ? Number(b.capacity_maximum) - Number(a.capacity_maximum) : (alphaEq(s, a) ?? Infinity) - (alphaEq(s, b) ?? Infinity));
      s.sel = Math.max(0, s.providers.findIndex((p) => p.id === cur));
    };
    const tabs = (): Safe => html`<div class="tabs" role="tablist">${TABS.map(([t, l]) => html`<button class="tab ${s.tab === t ? 'on' : ''}" role="tab" aria-selected="${s.tab === t}" data-act="tab" data-t="${t}">${l}</button>`)}</div>`;
    const histPending = new Set<string>();
    const loadHist = (gid: string) => {
      if (!gid || s.hist.has(gid) || histPending.has(gid)) return;
      histPending.add(gid);
      void guildApi.bankHistory(gid, '1d').then((r) => { s.hist.set(gid, r); paint(); }).catch(() => { s.hist.set(gid, null); paint(); });
    };
    const paint = () => {
      if (!root.isConnected) return;
      if (s.tab === 'bank') loadHist(s.bankGuild || s.bank[0]?.guild_id || '');
      if (s.tab === 'wallet' && s.ledger === undefined) { s.ledger = null; void call<Record<string, unknown>[]>(`ledger/list/player/${encodeURIComponent(pid)}/page/1?limit=40&order=desc`).then((b) => { s.ledger = b.data ?? []; paint(); }).catch(() => { s.ledger = []; paint(); }); }
      mount(root, html`<div class="card-head"><h1 style="font-size:28px">시장</h1></div>${tabs()}${s.tab === 'buy' ? buy(s) : s.tab === 'mine' ? mine(s) : s.tab === 'sell' ? sell(s) : s.tab === 'bank' ? bank(s) : walletTab(s)}`, handlers);
      const alpha = s.coins.find((c) => c.denom === 'ualpha')?.amount ?? s.me?.alpha;
      setTiles([{ label: '알파 매터', value: alpha != null ? micro(alpha, 2) + ' g' : '—', tone: 'var(--hwang)' }, { label: '계약', value: n(s.agreements.length) }, { label: '판매 중', value: n(s.providers.length) }]);
    };
    const sign = (p: Promise<string>, after?: () => void) => {
      s.busy = true; paint();
      p.then(() => { sfx.play('coin'); toast('명령을 내렸습니다'); after?.(); setTimeout(() => void refresh(), 6000); })
        .catch((e) => toast('실패: ' + (e as Error).message, 5000)).finally(() => { s.busy = false; paint(); });
    };
    const handlers = {
      tab: (el: HTMLElement) => { s.tab = el.dataset.t as Tab; history.replaceState(null, '', href(`/market?tab=${s.tab}`)); paint(); },
      pick: (el: HTMLElement, ev: Event) => { if ((ev.target as HTMLElement).closest('a,[data-act=shareOffer]')) return; s.sel = Number(el.dataset.i); requote(); paint(); },
      sort: (el: HTMLElement) => { s.sort = (el as HTMLSelectElement).value as State['sort']; resort(); paint(); },
      policy: (el: HTMLElement) => { s.policy = (el as HTMLSelectElement).value as State['policy']; paint(); },
      cap: (el: HTMLElement) => { s.capKw = Number((el as HTMLInputElement).value) || 0; requote(); paint(); },
      days: (el: HTMLElement) => { s.days = Number((el as HTMLInputElement).value) || 0; requote(); paint(); },
      shareOffer: (el: HTMLElement) => { const p = s.providers[Number(el.dataset.i)]; if (p) share({ kind: 'situation', s: offerSituation(p, s.me?.username) }); },
      shareProv: (el: HTMLElement) => { const p = s.mineProv.find((x) => x.id === el.dataset.id); if (p) share({ kind: 'situation', s: offerSituation(p, s.me?.username) }); },
      open: () => { const p = s.providers[s.sel]; if (p) sign(actions.agreementOpen(p.id, Math.round(s.capKw * KW), Math.round(s.days * BLOCKS_PER_DAY))); },
      extend: (el: HTMLElement) => sign(actions.agreementExtend(el.dataset.id!, BLOCKS_PER_DAY)),
      capUp: (el: HTMLElement) => sign(actions.agreementCapacity(el.dataset.id!, KW)),
      capDown: (el: HTMLElement) => sign(actions.agreementCapacity(el.dataset.id!, -KW)),
      close: (el: HTMLElement) => { sign(actions.agreementClose(el.dataset.id!)); },
      access: (el: HTMLElement) => sign(actions.providerAccess(el.dataset.id!, (el as HTMLSelectElement).value as 'openMarket')),
      withdraw: (el: HTMLElement) => { const to = wallet.commander?.address; if (!to || wallet.state !== 'unlocked') { toast('계정 잠금을 해제하세요.'); return; } sign(actions.providerWithdraw(el.dataset.id!, to)); },
      delete: (el: HTMLElement) => { sign(actions.providerDelete(el.dataset.id!)); },
      create: async (el: HTMLElement) => {
        const f = new FormData(el as HTMLFormElement);
        const num = (k: string) => Number(f.get(k));
        // Rates are listed in whole steps: use the nearest one and say so, rather than asking.
        const rate = chainRate(num('rate'));
        if (rate.changed) toast(`요율은 가장 가까운 단위인 ${n(rate.listed, 2)} / kW 하루로 등록됩니다`, 4000);
        sign(actions.providerCreate({
          substationId: String(f.get('sub')), rate: { denom: String(f.get('denom')), amount: rate.amount },
          accessPolicy: String(f.get('policy')) as 'openMarket', capacityMinimum: Math.round(num('cmin') * KW), capacityMaximum: Math.round(num('cmax') * KW),
          durationMinimum: Math.round(num('dmin') * BLOCKS_PER_DAY), durationMaximum: Math.round(num('dmax') * BLOCKS_PER_DAY),
          consumerCancellationPenalty: String(f.get('pc')), providerCancellationPenalty: String(f.get('pp')),
        }));
      },
      bankPick: (el: HTMLElement, ev: Event) => { if ((ev.target as HTMLElement).closest('a')) return; s.bankGuild = el.dataset.g!; paint(); },
      bankAmount: (el: HTMLElement) => { s.bankAmount = (el as HTMLInputElement).value; paint(); },
      convert: () => { const g = s.bank.find((b) => b.guild_id === s.bankGuild) ?? s.bank[0], a = parseGrams(s.bankAmount); if (g && a) sign(actions.bankConvert(g.guild_id, Math.round(a * 1e6), Math.floor((a / Number(g.ratio)) * 0.99 * 1e6))); },
      redeem: () => { const g = s.bank.find((b) => b.guild_id === s.bankGuild) ?? s.bank[0], a = parseGrams(s.bankAmount); if (g && a) sign(actions.bankRedeem(g.denom, Math.round(a * 1e6), Math.floor(a * Number(g.ratio) * 0.99 * 1e6))); },
      mint: () => { const g = s.bank.find((b) => b.guild_id === s.bankGuild) ?? s.bank[0], a = parseGrams(s.bankAmount); if (g && a) sign(actions.bankMint(g.guild_id, Math.round(a * 1e6), Math.round(a * 1e6))); },
      send: (el: HTMLElement) => void openTransfer({ denom: el.dataset.d }),
      sendFrom: (el: HTMLElement) => void openTransfer({ from: Number(el.dataset.i) }),
    };
    const refresh = async () => {
      const [me, providers, stats, agreements, bankRows] = await Promise.all([
        guildApi.player(pid).catch(() => null), guildApi.providerMarket(), marketStats().catch(() => []), guildApi.agreementsOf(pid).catch(() => []), guildApi.bank().catch(() => []),
      ]);
      s.me = me; s.providers = [...providers]; s.stats = new Map(stats.map((x) => [x.provider_id, x])); s.agreements = agreements; s.bank = bankRows;
      s.bankGuild ||= me?.guild_id && bankRows.some((b) => b.guild_id === me.guild_id) ? me.guild_id : bankRows[0]?.guild_id ?? '';
      [s.mineProv, s.coins] = await Promise.all([guildApi.providersOf(pid).catch(() => providers.filter((p) => p.owner === pid)), wallet.commander ? balances(wallet.commander.address).catch(() => []) : Promise.resolve([] as Coin[])]);
      if (!s.mineProv.length) s.mineProv = providers.filter((p) => p.owner === pid);
      resort(); requote(); paint();
    };
    try { await refresh(); } catch (e) { mount(root, errorCard(e)); }
    const offNames = onNames(() => { if (root.isConnected) paint(); });
    return () => { offNames(); setTiles([]); };
  },
};
export default screen;
