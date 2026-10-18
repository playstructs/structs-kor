/* 알파 거래소 on the demo base: sell spare capacity for alpha per block, watch the price move,
 * and learn the risk — a sold kilowatt is the first thing a brownout cuts. */
import { html, mount, n, toast, type Safe } from '../ui/dom';
import { setTiles } from '../ui/shell';
import { demo, RATE, LOAN, JOBS, BLACK, BLACK_DEALS, type BlackId } from '../game/demo';
import { sfx } from '../game/sfx';
import { notify, float } from '../game/fx';
import { career } from '../game/progress';
import { keys } from '../game/keys';

export function demoExchange(root: HTMLElement): () => void {
  let kw = 1, blocks = 30, side: 'sell' | 'buy' = 'sell';
  const free = () => demo.sellableKw();

  const chart = (): Safe => {
    const h = demo.priceHist.slice(-40);
    const lo = Math.min(...h) * 0.95, hi = Math.max(...h) * 1.05;
    const y = (v: number) => 100 - ((v - lo) / (hi - lo)) * 100;
    return html`<div class="candles" role="img" aria-label="최근 40블록 전력 가격">${h.map((v, i) => {
      const o = i ? h[i - 1] : v, up = v >= o;
      const top = Math.min(y(v), y(o)), bh = Math.max(1, Math.abs(y(v) - y(o)));
      return html`<div class="candle ${up ? 'up' : 'down'}"><i class="wick" style="top:${top - 3}%;height:${bh + 6}%"></i><i class="body" style="top:${top}%;height:${bh}%"></i></div>`;
    })}</div>`;
  };

  const view = (): Safe => {
    const price = demo.price, prev = demo.priceHist[demo.priceHist.length - 2] ?? price;
    const ch = ((price - prev) / prev) * 100;
    const income = kw * price * blocks;
    const spareAfter = free() - kw;
    const ask = price * demo.guildAsk(), cost = kw * ask * blocks, canBuy = demo.state.alpha >= kw * ask * 3;
    const ev = demo.event;
    // The wire: the power price, how much the market will still buy, every rival's worth and its change
    // since the last power sample, yours, and what your vassals pay.
    const hist = demo.powerHist, prevSample = hist[hist.length - 2];
    const ticker: [string, number, number][] = [
      ['전력 kW·블록', price, ch],
      ['남은 시장 수요 kW', Math.max(0, RATE.marketDepthKw - demo.soldKw()), 0],
      ...demo.rivals().map((r): [string, number, number] => {
        const now = demo.rivalWorth(r), was = prevSample?.r[r.id] ?? now;
        return [`${r.vassal != null ? '♛ ' : ''}${r.name} 세력`, now, ((now - was) / Math.max(1, was)) * 100];
      }),
      ['내 세력', demo.netWorth(), prevSample ? ((demo.netWorth() - prevSample.me) / Math.max(1, prevSample.me)) * 100 : 0],
      ...(demo.rates().tribute ? [['공물 α/블록', demo.rates().tribute, 0] as [string, number, number]] : []),
    ];
    return html`
    <div class="card-head"><h1 style="font-size:28px">알파 거래소</h1><span class="label c-cheong">ALPHA EXCHANGE</span><span class="end mono c-hwang">누적 수익 +${demo.state.earned.toFixed(2)} α</span></div>
    <div class="ticker" aria-hidden="true"><div class="ticker-in" style="animation-delay:-${Math.round(performance.now() % 40000)}ms">${[...ticker, ...ticker].map(([k, v, c]) => html`<span><span class="dim">${k}</span> <b class="mono">${v < 1 ? v.toFixed(4) : v < 100 ? v.toFixed(2) : n(Math.round(v))}</b> <span class="mono ${c >= 0 ? 'c-cheong' : 'c-jeok'}">${c >= 0 ? '▲' : '▼'} ${Math.abs(c).toFixed(1)}%</span></span>`)}</div></div>
    <div class="exch">
      <section class="card game-panel">
        <div class="price-row"><span class="label dim">전력 · kW당 블록 가격</span><strong class="mono">${price.toFixed(4)} α</strong><span class="mono ${ch >= 0 ? 'c-cheong' : 'c-jeok'}">${ch >= 0 ? '▲' : '▼'} ${Math.abs(ch).toFixed(2)}%</span></div>
        ${chart()}
        ${ev ? html`<div class="notice ${ev.tone === 'jeok' ? 'err' : ''}"><b>${ev.name}</b> · ${ev.text} · ${ev.left}블록 남음</div>` : ''}
        <h2>진행 중인 계약</h2>
        <div class="deals">${demo.contracts.length ? demo.contracts.map((c) => { const buy = c.dir === 'buy'; return html`<div class="deal ${buy ? 'buy' : ''}"><div class="deal-top"><span class="mono dim">${c.id}</span><span class="chip ${buy ? 'jeok' : 'cheong'}">${buy ? '구매 중' : '판매 중'}</span></div><b>${buy ? `${c.buyer}에서 ${c.kw} kW` : `${c.buyer}에 ${c.kw} kW`}</b><div class="deal-top mono"><span>${(c.rate * (buy ? 1 : demo.sellBonus())).toFixed(4)} α</span><span class="${buy ? 'c-jeok' : 'c-cheong'}">${buy ? '−' : '+'}${(c.kw * c.rate * (buy ? 1 : demo.sellBonus())).toFixed(3)} α/블록</span></div><span class="mono faint">${c.left}블록 남음</span></div>`; }) : html`<p class="empty">계약이 없습니다. 남는 전력은 매 블록 사라집니다 — 파세요.</p>`}</div>
      </section>
      <aside class="card game-panel accent ticket">
        <div class="side-tabs" role="tablist"><button role="tab" class="${side === 'sell' ? 'on sell' : ''}" aria-selected="${side === 'sell'}" data-act="side" data-v="sell">판매</button><button role="tab" class="${side === 'buy' ? 'on buy' : ''}" aria-selected="${side === 'buy'}" data-act="side" data-v="buy">구매</button></div>
        <label class="field"><span>${side === 'sell' ? html`전력량 · 여유 <b class="mono c-cheong">${free().toFixed(2)} kW</b> · 시장 수요 <b class="mono">${Math.max(0, RATE.marketDepthKw - demo.soldKw()).toFixed(1)} kW</b> · 계약당 최대 ${RATE.maxDealKw} kW` : '전력량 (kW)'}</span><input class="input" type="number" min="0.1" step="0.1" value="${kw}" aria-label="전력량 (kW)" data-act="kw" data-on="change"></label>
        <label class="field"><span>기간 (블록)</span><input class="input" type="number" min="5" max="${RATE.maxTerm}" step="5" value="${blocks}" aria-label="기간 (블록)" data-act="blocks" data-on="change"></label>
        ${side === 'sell' ? html`
        <div class="quote mono">
          <div><span class="dim">매수 호가</span><span>${price.toFixed(4)} α/kW·블록</span></div>
          <div><span class="dim">블록당</span><span>+${(kw * price).toFixed(3)} α</span></div>
          <div class="total"><span>예상 수익</span><strong class="c-cheong">+${income.toFixed(2)} α</strong></div>
        </div>
        ${spareAfter < 0 ? html`<div class="notice err">여유 전력보다 많이 팔 수 없습니다. 리액터에 알파를 주입하거나 구조체를 끄세요.</div>` : spareAfter < 0.5 ? html`<div class="notice">판매 후 여유 ${spareAfter.toFixed(2)} kW. 발전기 하나만 잃어도 이 계약이 가장 먼저 차단됩니다.</div>` : ''}
        <button class="btn primary lg" data-act="sell" ${spareAfter < 0 ? 'disabled' : ''}>판매 계약 체결 <kbd>Enter</kbd></button>
        <p class="note">수익은 매 블록 알파로 들어옵니다. 판매한 전력은 내 구조체보다 먼저 차단됩니다.</p>` : html`
        <div class="quote mono">
          <div><span class="dim">매도 호가 (+${Math.round((demo.guildAsk() - 1) * 100)}%)</span><span>${ask.toFixed(4)} α/kW·블록</span></div>
          <div><span class="dim">블록당</span><span>−${(kw * ask).toFixed(3)} α</span></div>
          <div class="total"><span>총 비용</span><strong class="c-jeok">−${cost.toFixed(2)} α</strong></div>
        </div>
        ${canBuy ? html`<div class="notice">용량이 즉시 +${kw} kW 늘어납니다. 매 블록 지불하며, 알파가 바닥나면 계약이 끊깁니다. 구매한 전력은 되팔 수 없습니다.</div>` : html`<div class="notice err">최소 3블록치 알파(${(kw * ask * 3).toFixed(2)} g)가 필요합니다.</div>`}
        <button class="btn danger lg" data-act="buy" ${canBuy ? '' : 'disabled'}>구매 계약 체결 <kbd>Enter</kbd></button>`}
      </aside>
    </div>
    ${blackCard()}
    ${jobsCard()}
    ${loanCard()}`;
  };

  /* 의뢰 게시판: deliveries (ore now, alpha at a premium) and defence contracts. */
  /* 암시장: a smuggler's three one-off deals while the ship is docked. */
  const blackCard = (): Safe => {
    const b = demo.black;
    if (!b.offers.length) return html`<section class="card game-panel black"><div class="card-head"><h2>암시장</h2><span class="end label c-hwang">BLACK MARKET</span></div><p class="note">밀수선이 없습니다${'next' in b ? ` · 약 ${b.next}블록 뒤 입항` : ''}. 들어오면 ${BLACK.stays}블록 동안 한 번씩만 파는 거래를 엽니다.</p></section>`;
    return html`<section class="card game-panel black"><div class="card-head"><h2>암시장</h2><span class="end mono c-jeok">${b.left}블록 뒤 출항</span></div>
      <div class="job-row">${b.offers.map((o) => { const why = demo.blackBlocked(o.id); return html`<article class="job">
        <span class="label c-hwang">${BLACK_DEALS[o.id].name}</span>
        <b>${BLACK_DEALS[o.id].what}</b>
        <small class="dim">${why ?? '한 번만 팝니다'}</small>
        <button class="btn gold" data-act="black" data-id="${o.id}" ${why ? 'disabled' : ''}>${o.id === 'scrap' ? `매각 · +${Math.round(Math.min(BLACK.scrapMax, Math.floor(demo.state.ore)) * BLACK.scrapRate * 10) / 10} α` : `${o.price} α · 거래`}</button>
      </article>`; })}</div>
    </section>`;
  };

  const jobsCard = (): Safe => {
    const j = demo.jobs;
    if (!j) return html``;
    const who = (id: string) => demo.rivals().find((r) => r.id === id)?.name ?? id;
    return html`<section class="card game-panel jobs"><div class="card-head"><h2>의뢰 게시판</h2><span class="end mono dim">새 의뢰까지 ${j.next}블록 · 완수 ${j.done}회</span></div>
      ${j.active ? html`<div class="notice">진행 중 · ${who(j.active.who)} 방어 의뢰 · 습격 격퇴 ${j.active.count} / ${j.active.need} · ${j.active.left}블록 남음 · 보수 ${j.active.reward} α</div>` : ''}
      ${j.offers.length ? html`<div class="job-row">${j.offers.map((o) => html`<article class="job">
        <span class="label ${o.kind === 'deliver' ? 'c-hwang' : 'c-jeok'}">${o.kind === 'deliver' ? '납품' : '방어'} · ${who(o.who)}</span>
        <b>${o.kind === 'deliver' ? `광석 ${o.need} 단위 → ${o.reward} α` : `${JOBS.defendFor}블록 안에 습격 ${o.need}회 격퇴 → ${o.reward} α`}</b>
        <small class="dim">${o.kind === 'deliver' ? `정제가보다 ${Math.round((o.reward / o.need - 1) * 100)}% 높게 · 즉시 지급 · 약탈당할 광석이 줄어듭니다` : '수락 후 시작된 습격만 집계 · 기한을 넘기면 무효'}</small>
        <button class="btn ${o.kind === 'deliver' ? 'gold' : 'danger'}" data-act="job" data-id="${o.id}" ${o.kind === 'deliver' && demo.state.ore < o.need ? 'disabled' : o.kind === 'defend' && j.active ? 'disabled' : ''}>${o.kind === 'deliver' ? '납품' : '수락'}</button>
      </article>`)}</div>` : html`<p class="note">게시판이 비었습니다. 곧 새 의뢰가 올라옵니다.</p>`}
    </section>`;
  };

  /* 청룡 상단 credit: borrow now, pay 20% more in 200 blocks, or lose ore and face their fleet. */
  const loanCard = (): Safe => {
    const l = demo.loan;
    return html`<section class="card game-panel loan"><div class="card-head"><h2>청룡 상단 대출</h2><span class="end label c-hwang">CREDIT</span></div>
      ${l ? html`<div class="g2" style="gap:8px"><div class="stat"><small>갚을 금액</small><strong class="c-hwang">${l.owed.toFixed(1)} α</strong></div><div class="stat"><small>만기까지</small><strong class="${l.left < 30 ? 'c-jeok' : ''}">${l.left}블록</strong></div></div>
        <button class="btn gold" data-act="repay" ${demo.state.alpha >= l.owed ? '' : 'disabled'}>지금 상환 · ${l.owed.toFixed(1)} α</button>
        <p class="note">만기에 금고에서 자동으로 갚습니다. 모자라면 광석을 두 배로 압류하고, 청룡 상단 함대가 옵니다.</p>`
      : html`<p class="note">알파를 먼저 쓰고 나중에 갚으세요. 이자 ${Math.round(LOAN.rate * 100)}% · ${LOAN.term}블록 후 만기 · 최대 ${LOAN.max} g. 갚지 못하면 광석을 압류당하고 습격을 받습니다.</p>
        <div style="display:flex;gap:8px;flex-wrap:wrap">${[20, 50].map((g) => html`<button class="btn ghost" data-act="borrow" data-g="${g}">${g} g 빌리기 · 갚을 돈 ${(g * (1 + LOAN.rate)).toFixed(0)} α</button>`)}</div>`}
    </section>`;
  };

  const paint = () => {
    if (!root.isConnected) return;
    const focus = (document.activeElement as HTMLElement | null)?.dataset?.act;
    mount(root, view(), handlers);
    if (focus) root.querySelector<HTMLInputElement>(`[data-act="${focus}"]`)?.focus();
    const d = demo.dashboard();
    setTiles([
      { label: '알파 매터', value: '', num: Number(d.player.alpha) / 1e6, fmt: (v) => n(v, 2) + ' g', tone: 'var(--hwang)', delta: `+${demo.rates().alpha.toFixed(2)}/블록` },
      { label: '여유 전력', value: `${free().toFixed(2)} kW`, tone: 'var(--cheong-hi)' },
      { label: '전력 시세', value: `${demo.price.toFixed(4)} α` },
      ...(() => { const ids = Object.keys(demo.state.stakes ?? {}); if (!ids.length) return []; const per = ids.reduce((a, id) => a + demo.stake(id).perBlock, 0); return [{ label: '배당', value: `+${per.toFixed(3)} α/블록`, tone: 'var(--hwang)', href: '/galaxy' }]; })(),
    ]);
  };
  const handlers = {
    job: (el: HTMLElement) => {
      const o = demo.jobs?.offers.find((x) => x.id === el.dataset.id);
      const e = demo.takeJob(el.dataset.id!);
      if (e) { sfx.play('error'); toast(e); return; }
      sfx.play('coin'); float(el, o?.kind === 'deliver' ? `+${o.reward} α` : '의뢰 수락', 'var(--hwang)', true); paint();
    },
    black: (el: HTMLElement) => {
      const id = el.dataset.id as BlackId, ore = demo.state.ore, alpha = demo.state.alpha;
      const e = demo.buyBlack(id);
      if (e) { sfx.play('error'); toast(e); return; }
      sfx.play('coin');
      const d = Math.round((demo.state.alpha - alpha) * 10) / 10;
      float(el, id === 'scrap' ? `광석 −${Math.round(ore - demo.state.ore)} · +${d} α` : `${d} α`, 'var(--hwang)', true);
      notify('암시장', BLACK_DEALS[id].name, 'hwang', null); paint();
    },
    borrow: (el: HTMLElement) => {
      const e = demo.borrow(Number(el.dataset.g));
      if (e) { sfx.play('error'); toast(e); return; }
      sfx.play('coin'); notify('대출', `청룡 상단에서 ${el.dataset.g} g · ${LOAN.term}블록 후 만기`, 'hwang', null); paint();
    },
    repay: () => {
      const e = demo.repay();
      if (e) { sfx.play('error'); toast(e); return; }
      sfx.play('confirm'); notify('상환 완료', '청룡 상단 대출을 갚았습니다', 'cheong', null); paint();
    },
    kw: (el: HTMLElement) => { kw = Math.max(0.1, Number((el as HTMLInputElement).value) || 0); paint(); },
    blocks: (el: HTMLElement) => { blocks = Math.max(5, Math.round(Number((el as HTMLInputElement).value) || 0)); paint(); },
    side: (el: HTMLElement) => { side = el.dataset.v as 'sell' | 'buy'; paint(); },
    buy: (el: HTMLElement) => {
      const m = demo.buy(kw, blocks);
      if (m) { sfx.play('error'); toast(m); return; }
      sfx.play('confirm'); float(el, `+${kw} kW`, 'var(--cheong-hi)', true);
      notify('전력 구매', `${kw} kW × ${blocks}블록`, 'cheong', null);
      paint();
    },
    sell: (el: HTMLElement) => {
      const m = demo.sell(kw, blocks);
      if (m) { sfx.play('error'); toast(m); return; }
      sfx.play('coin'); float(el, `+${(kw * demo.price * blocks).toFixed(1)} α`, 'var(--hwang)', true);
      notify('계약 체결', `${kw} kW × ${blocks}블록`, 'hwang', null);
      if (demo.contracts.length === 1) career.award(40, '첫 전력 판매');
      paint();
    },
  };
  paint();
  const offs = [demo.onBlock(() => { if (!(document.activeElement instanceof HTMLInputElement)) paint(); }), keys.scope({ Enter: () => (side === 'sell' ? handlers.sell : handlers.buy)(root.querySelector<HTMLElement>(`[data-act="${side}"]`) ?? root) })];
  return () => { offs.forEach((f) => f()); setTiles([]); };
}
