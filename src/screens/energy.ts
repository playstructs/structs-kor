/* 전력망 지휘 (Grid Command): online ⇔ load + structsLoad ≤ capacity + capacitySecondary. One read
 * (REQ-EN-1) with allocations in cascade order, a brownout wargame (REQ-EN-2), struct power
 * switches (signed MsgStructActivate / MsgStructDeactivate), and the reactor core in the middle.
 * The demo base feeds the same view and lets the player infuse alpha for capacity. */
import type { Screen } from '../router';
import { href } from '../router';
import { html, mount, n, watts, micro, toast, type Safe } from '../ui/dom';
import { needSession, errorCard, loading } from '../ui/gate';
import { setTiles } from '../ui/shell';
import { energy, whatIfLocal, powerWhatIf, type Energy } from '../api/planned';
import { guildApi, type PlayerRow, type StructRow } from '../api/guild';
import { actions } from '../api/actions';
import { wallet } from '../wallet/wallet';
import { onGrass, throttled } from '../grass/grass';
import { ALLOCATION_TYPE, STRUCT_TYPE, entityOf } from '../i18n/ko';
import { TYPES_BY_ID } from '../data/catalogue';
import { demo, DEMO_ID } from '../game/demo';
import { sfx } from '../game/sfx';
import { notify, float } from '../game/fx';
import { keys } from '../game/keys';
import { career } from '../game/progress';

const ONLINE = 4, DESTROYED = 32;

function demoEnergy(): { p: PlayerRow; e: Energy; structs: StructRow[] } {
  const d = demo.dashboard();
  const s = demo.state;
  return {
    p: d.player,
    structs: d.structs,
    e: {
      power: d.power,
      infusions: s.infusedKw ? [{ destination_id: '3-15', address: '', destination_type: 'reactor', player_id: DEMO_ID, fuel: s.infusedKw * 1e6, defusing: 0, power: s.infusedKw * 1e6, ratio: 1, commission: 3 }] : [],
      allocations_out: demo.contracts.map((c, i) => ({ id: c.id, allocation_type: 'provider-agreement', source_id: DEMO_ID, index: i, destination_id: c.buyer, creator: DEMO_ID, controller: DEMO_ID, created_at: String(i), updated_at: '', power: c.kw * 1e6, cascade_rank: i + 1 })),
      allocations_in: [],
      substation: { id: '4-7', name: null, connection_count: 12, connection_capacity: 0 },
    },
  };
}

interface Inf { reactor: string; amount: string; busy: boolean }
interface Dist { source: string; type: 'static' | 'dynamic' | 'automated'; kw: string; subs: { id: string; name: string }[]; busy: boolean }
function distribution(p: PlayerRow, e: Energy, d: Dist, canSign: boolean): Safe {
  const pw = e.power;
  const supply = Number(pw?.capacity ?? p.capacity) + Number(pw?.connection_capacity ?? p.connection_capacity);
  const demand = Number(pw?.load ?? p.load) + Number(pw?.structs_load ?? p.structs_load);
  const after = supply - demand - Number(d.kw || 0) * 1e6;
  return html`<section class="card game-panel"><div class="card-head"><h2>배전 · 할당과 변전소</h2><span class="end dim" style="font-size:13px">내 전력을 변전소로 보내 나와 길드원(레플리칸트)에게 나눔</span></div>
    <div class="g2" style="align-items:start;gap:14px">
      <div><h3 class="sub-h">보내는 할당</h3>
        ${e.allocations_out.length ? html`<ul class="coins">${e.allocations_out.map((a) => html`<li><span class="rank mono">${a.cascade_rank}</span><div><b>${ALLOCATION_TYPE[a.allocation_type] ?? a.allocation_type} · ${a.id}</b><small class="mono">→ ${a.destination_id ? html`<a href="${href(`/o/${a.destination_id}`)}">${entityOf(a.destination_id)} ${a.destination_id}</a>` : '연결 안 됨'} · 출처 ${a.source_id}</small></div><strong class="mono">${a.power == null ? '—' : watts(Number(a.power))}</strong>
          <span class="alloc-acts"><button class="btn ghost sm" data-act="allocPower" data-id="${a.id}" ${canSign ? '' : 'disabled'}>전력</button>${a.destination_id ? html`<button class="btn ghost sm" data-act="allocDisc" data-id="${a.id}" ${canSign ? '' : 'disabled'}>끊기</button>` : html`<button class="btn ghost sm" data-act="allocConn" data-id="${a.id}" ${canSign ? '' : 'disabled'}>연결</button><button class="btn ghost sm" data-act="subNew" data-id="${a.id}" ${canSign ? '' : 'disabled'} title="이 할당으로 새 변전소">변전소 만들기</button>`}<button class="btn outline-danger sm" data-act="allocDel" data-id="${a.id}" ${canSign ? '' : 'disabled'}>삭제</button></span></li>`)}</ul>` : html`<p class="note">보내는 할당이 없습니다.</p>`}
        <form class="alloc-form" data-act="allocNew" data-on="submit">
          <label class="field"><span>출처 (나·리액터·발전기)</span><input class="input mono" name="source" value="${d.source}" data-act="dSource" placeholder="1-… / 3-… / 5-…"></label>
          <label class="field"><span>방식</span><select class="input" name="type" data-act="dType" data-on="change">${(['static', 'dynamic', 'automated'] as const).map((t) => html`<option value="${t}" ${d.type === t ? 'selected' : ''}>${ALLOCATION_TYPE[t]}</option>`)}</select></label>
          <label class="field"><span>전력 (kW)</span><input class="input mono" name="kw" value="${d.kw}" data-act="dKw" inputmode="decimal"></label>
          <button class="btn gold" ${canSign && !d.busy ? '' : 'disabled'}>할당 만들기</button>
        </form>
        <div class="verdict ${after < 0 ? 'bad' : after < supply * 0.1 ? 'warn' : 'ok'}" style="margin-top:8px"><strong>${after < 0 ? '정전 위험' : '여유'} ${watts(Math.abs(after))}</strong><span>${after < 0 ? '이 할당을 만들면 부하가 용량을 넘습니다. 먼저 만든 할당부터 끊깁니다.' : '할당 후 남는 용량입니다. 자동 할당은 용량에 맞춰 늘고, 출처당 하나만 됩니다.'}</span></div>
      </div>
      <div><h3 class="sub-h">내 변전소</h3>
        ${d.subs.length ? html`<ul class="coins">${d.subs.map((x) => html`<li><span class="coin-ico token"></span><div><b><a href="${href(`/o/${x.id}`)}">${x.name || '이름 없음'}</a></b><small class="mono">${x.id}${p.substation_id === x.id ? ' · 연결됨' : ''}</small></div>
          <span class="alloc-acts"><button class="btn ghost sm" data-act="subName" data-id="${x.id}" ${canSign ? '' : 'disabled'}>이름</button>${p.substation_id === x.id ? '' : html`<button class="btn ghost sm" data-act="subJoin" data-id="${x.id}" ${canSign ? '' : 'disabled'}>여기로 연결</button>`}</span></li>`)}</ul>` : html`<p class="note">소유한 변전소가 없습니다. 연결되지 않은 할당으로 하나 만들 수 있습니다.</p>`}
        <p class="note">지금 연결: <a href="${href(`/o/${p.substation_id}`)}">${p.substation_id || '—'}</a> · 레플리칸트를 내 변전소에 연결하면 그 몫만큼 복제 여유가 생깁니다.</p>
      </div>
    </div></section>`;
}
function infusionPanel(e: Energy, inf: Inf, canSign: boolean): Safe {
  return html`<div class="inf-panel">
    ${e.infusions.length ? html`<ul class="coins">${e.infusions.map((i) => html`<li><span class="coin-ico"></span><div><b><a href="${href(`/o/${i.destination_id}`)}">${entityOf(i.destination_id)} ${i.destination_id}</a></b><small class="mono">주입 ${micro(i.fuel_p ?? i.fuel, 2)} g · 회수 중 ${micro(i.defusing, 2)} g · 수수료 ${n(Number(i.commission))}%</small></div><strong class="mono c-hwang">${watts(Number(i.power_p ?? i.power ?? 0))}</strong>
      <button class="btn ghost sm" data-act="defuse" data-id="${i.destination_id}" data-fuel="${String(i.fuel_p ?? i.fuel)}" ${canSign && Number(i.fuel) > 0 ? '' : 'disabled'}>회수</button></li>`)}</ul>` : html`<p class="note">아직 주입한 알파가 없습니다. 1 g당 약 1 kW 용량이 생깁니다.</p>`}
    <form class="inf-form" data-act="infuseReal" data-on="submit">
      <label class="field"><span>리액터</span><input class="input mono" name="reactor" value="${inf.reactor}" placeholder="3-…" data-act="infReactor" required></label>
      <label class="field"><span>알파 (g)</span><input class="input mono" name="amount" value="${inf.amount}" inputmode="decimal" placeholder="1" data-act="infAmount" required></label>
      <button class="btn gold" ${canSign && !inf.busy ? '' : 'disabled'}>${inf.busy ? '처리 중…' : '주입'}</button>
    </form>
    <p class="note">알파를 리액터에 주입하면 그만큼 전력 용량이 생깁니다. 회수하면 정해진 대기 시간이 지난 뒤에 돌아옵니다.</p></div>`;
}

function view(p: PlayerRow, e: Energy, structs: StructRow[], dropKw: number, cut: Set<string>, offline: boolean, isDemo: boolean, inf: Inf = { reactor: '', amount: '', busy: false }): Safe {
  const pw = e.power;
  const cap = Number(pw?.capacity ?? p.capacity), sec = Number(pw?.connection_capacity ?? p.connection_capacity);
  const load = Number(pw?.load ?? p.load), sl = Number(pw?.structs_load ?? p.structs_load);
  const supply = cap + sec, demand = load + sl, use = demand / Math.max(1, supply);
  const tone = use > 0.95 ? 'var(--jeok)' : use > 0.8 ? 'var(--warn)' : 'var(--cheong)';
  const infused = e.infusions.reduce((s, i) => s + Number(i.power_p ?? i.power ?? 0), 0);
  const gens = structs.filter((s) => s.type === 20 && (s.status & ONLINE));
  const spare = Math.max(0, supply - demand);
  const live = structs.filter((s) => !(s.status & DESTROYED));
  const canSign = isDemo || wallet.state === 'unlocked';
  const deg = Math.min(360, use * 360);
  const verdict = dropKw === 0 ? ['안정', '현재 모든 할당과 구조체가 유지됩니다.', 'ok'] : offline ? ['구조체 정전', '할당을 모두 끊어도 부족합니다. 구조체가 꺼지고 정제·방어가 멈춥니다.', 'bad'] : cut.size ? [`계약 ${cut.size}건 차단`, '먼저 체결한 할당부터 끊기고 그 수익도 사라집니다. 받던 쪽도 전력을 잃습니다.', 'warn'] : ['흡수 가능', '여유 용량 안에서 버팁니다.', 'ok'];

  return html`
  <div class="grid-cmd">
    <section class="card game-panel grid-flow">
      <div class="card-head"><h1 style="font-size:28px">전력망 지휘</h1><span class="label c-hwang">GRID COMMAND</span>
        <span class="end chip ${use > 1 ? 'jeok' : 'cheong'}">● ${use > 1 ? '정전' : '그리드 온라인'}</span></div>
      <div class="flow">
        <div class="flow-col">
          <div class="src gold"><span class="label">알파 주입</span><strong class="mono">${watts(infused)}</strong><small>${e.infusions[0] ? `리액터 ${e.infusions[0].destination_id} · 수수료 ${n(e.infusions[0].commission)}%` : '1 g = 1 kW'}</small></div>
          <div class="src cheong"><span class="label">필드 발전기 ×${gens.length}</span><strong class="mono">${isDemo ? `${(gens.length * 2).toFixed(1)} kW` : gens.length ? '가동' : '—'}</strong><small>${gens.length ? '행성 발전' : '지상 슬롯에 건설'}</small></div>
          <div class="src"><span class="label">변전소 ${e.substation?.id ?? '—'}</span><strong class="mono">${watts(sec)}</strong><small>${e.substation?.connection_count != null ? `${n(e.substation.connection_count)}명 연결` : '(용량 − 부하) ÷ 연결 수'}</small></div>
        </div>
        <div class="wire gold" aria-hidden="true"></div>
        <div class="core" style="--deg:${deg}deg;--tone:${tone}" role="img" aria-label="총 용량 ${watts(supply)}, 사용률 ${Math.round(use * 100)}%">
          <div class="core-in"><span class="label">총 용량</span><strong class="mono">${watts(supply)}</strong><span class="mono" style="color:${tone}">부하 ${Math.round(use * 100)}%</span><small class="mono">여유 ${watts(spare)}</small></div>
        </div>
        <div class="wire cheong" aria-hidden="true"></div>
        <div class="flow-col sinks">
          <span class="label">차단 순서 · 위에서부터</span>
          ${e.allocations_out.map((a) => html`<div class="sink ${cut.has(a.id) ? 'cut' : ''}"><span class="rank mono">${a.cascade_rank}</span><div><b title="${ALLOCATION_TYPE[a.allocation_type] ?? a.allocation_type} → ${entityOf(a.destination_id)} ${a.destination_id}">${ALLOCATION_TYPE[a.allocation_type] ?? a.allocation_type} → ${entityOf(a.destination_id)} ${a.destination_id}</b><small class="mono">${a.id}</small></div><span class="mono">${a.power == null ? '—' : watts(Number(a.power))}</span></div>`)}
          ${live.some((s) => s.status & ONLINE) ? html`<div class="sink ${offline ? 'cut' : ''}"><span class="rank mono">${e.allocations_out.length + 1}</span><div><b>구조체 ${live.filter((s) => s.status & ONLINE).length}기 가동</b><small>정전 시 꺼짐</small></div><span class="mono">${watts(sl)}</span></div>` : ''}
          ${!e.allocations_out.length && !live.some((s) => s.status & ONLINE) ? html`<p class="note">아직 전력을 쓰는 곳이 없습니다.</p>` : ''}
        </div>
      </div>
    </section>

    <section class="card game-panel warn wargame"><h2>${sl <= 0 && !e.allocations_out.length ? '전력 늘리기' : '정전 워게임'}</h2>
${sl <= 0 && !e.allocations_out.length ? '' : html`      <label class="field"><span style="font-size:15px;color:var(--text)">적이 내 용량 <b class="mono c-hwang" style="font-size:18px">${dropKw} kW</b>를 끊으면?</span>
        <input type="range" min="0" max="${Math.max(10, Math.ceil(supply / 1e6))}" value="${dropKw}" aria-label="끊길 용량 (kW)" data-act="drop" style="accent-color:var(--hwang);min-height:32px"></label>
      <div class="verdict ${verdict[2]}"><strong>${verdict[0]}</strong><span>${verdict[1]}</span></div>`}
      <div style="display:flex;flex-direction:column;gap:8px">
        <span class="label dim">권장 대응</span>
        ${isDemo ? html`
          <button class="btn gold" data-act="infuse" data-g="1" style="justify-content:space-between">알파 1 g 주입 <span class="mono">+1 kW · <kbd>I</kbd></span></button>
          <button class="btn ghost" data-act="infuse" data-g="5" style="justify-content:space-between" ${demo.state.alpha < 5 ? 'disabled' : ''}>알파 5 g 주입 <span class="mono">+5 kW</span></button>` : infusionPanel(e, inf, canSign)}
        <a class="btn ghost" href="${href('/market')}" style="justify-content:space-between">여유 ${watts(spare)} 판매 <span class="mono c-cheong">거래소 →</span></a>
      </div>
      <p class="note">부하가 용량을 넘으면 가장 오래된 외부 할당부터 끊기고, 그 손실이 아래쪽으로 이어집니다.</p>
    </section>
  </div>

  <section class="card game-panel"><div class="card-head"><h2>구조체 전원</h2><span class="dim" style="font-size:13px">오프라인이면 건설·공격·채굴 불가 · 복구 행동은 가능</span></div>
    ${canSign ? '' : html`<div class="notice">전원을 바꾸려면 계정 잠금을 해제하세요.</div>`}
    <div class="switches">
      ${live.map((s) => {
        const on = (s.status & ONLINE) !== 0;
        const draw = TYPES_BY_ID[s.type]?.passiveDraw;
        return html`<div class="switch ${on ? 'on' : ''}">
          <div style="flex:1 1 auto;display:flex;flex-direction:column;gap:2px"><strong class="c-white" style="font-size:14px">${STRUCT_TYPE[s.type] ?? s.type} <span class="mono faint" style="font-size:11px">${s.id}</span></strong><span class="mono" style="font-size:12px">${draw != null ? watts(draw) : '—'} · ${on ? '가동' : '꺼짐'}</span></div>
          <button class="sw" aria-pressed="${on}" aria-label="${STRUCT_TYPE[s.type] ?? s.type} 전원" data-act="power" data-id="${s.id}" data-on-state="${on ? 1 : 0}" ${canSign ? '' : 'disabled'}></button></div>`;
      })}
    </div>
  </section>
  ${!isDemo && e.allocations_in.length ? html`<p class="note">받는 할당 ${e.allocations_in.length}건: ${e.allocations_in.map((a) => a.source_id).join(', ')}</p>` : ''}
  <p class="note">알파 ${micro(p.alpha)} g · ${p.guild_name || p.guild_id}</p>`;
}

const screen: Screen = {
  async render(root) {
    const pid = needSession(root, '전력망 지휘', { demo: true });
    if (!pid) return;
    const isDemo = pid === DEMO_ID;
    mount(root, loading());
    let p: PlayerRow, e: Energy, structs: StructRow[] = [];
    let dropKw = 0;
    let cut = new Set<string>(), offline = false;
    const inf: Inf = { reactor: '', amount: '1', busy: false };
    const dist: Dist = { source: pid, type: 'static', kw: '1', subs: [], busy: false };
    const validatorOf = async (reactorId: string) => String(((await guildApi.objects([reactorId])).find((o) => o.id === reactorId)?.object as Record<string, unknown> | undefined)?.validator ?? '');
    const tiles = () => {
      const pw = e.power;
      const use = pw ? Number(pw.total_load) / Math.max(1, Number(pw.total_capacity)) : 0;
      setTiles([
        { label: '알파 매터', value: micro(p.alpha) + ' g', num: Number(p.alpha) / 1e6, fmt: (v) => n(v, 2) + ' g', tone: 'var(--hwang)' },
        { label: `전력 · ${Math.round(use * 100)}%`, value: pw ? `${watts(Number(pw.total_load))} / ${watts(Number(pw.total_capacity))}` : '—', tone: use > 0.95 ? 'var(--jeok)' : use > 0.8 ? 'var(--warn)' : 'var(--cheong)', alert: use > 0.95 },
        { label: '여유 전력', value: pw ? watts(Math.max(0, Number(pw.total_capacity) - Number(pw.total_load))) : '—', tone: 'var(--cheong-hi)' },
      ]);
    };
    const sign = (pr: Promise<string>, done: string) => {
      dist.busy = true; paint();
      pr.then(() => { sfx.play('confirm'); toast(done); setTimeout(() => void load(), 6000); })
        .catch((err) => { sfx.play('error'); toast('실패: ' + (err as Error).message, 5000); })
        .finally(() => { dist.busy = false; paint(); });
    };
    const paint = () => { if (root.isConnected) { mount(root, html`${view(p, e, structs, dropKw, cut, offline, isDemo, inf)}${isDemo ? '' : distribution(p, e, dist, wallet.state === 'unlocked')}`, handlers); tiles(); } };
    const recompute = () => { const local = whatIfLocal(e, dropKw * 1e6); cut = new Set(local.cut); offline = local.offline; };
    const handlers = {
      drop: (el: HTMLElement) => {
        dropKw = Number((el as HTMLInputElement).value);
        recompute(); paint();
        if (isDemo) return;
        // The guild's answer (REQ-EN-2) replaces the local one when it serves it.
        const want = dropKw;
        void powerWhatIf(pid, e, dropKw * 1e6).then((r) => { if (want === dropKw) { cut = new Set(r.cut); offline = r.offline; paint(); } }).catch(() => null);
      },
      power: (el: HTMLElement) => {
        const id = el.dataset.id!, on = el.dataset.onState === '1';
        if (isDemo) { const m = demo.toggle(id); if (m) { sfx.play('error'); toast(m); } else { sfx.play(on ? 'click' : 'confirm'); load(); } return; }
        (el as HTMLButtonElement).disabled = true;
        (on ? actions.structDeactivate(id) : actions.structActivate(id))
          .then(() => { sfx.play('confirm'); toast('명령을 내렸습니다'); })
          .catch((err) => { sfx.play('error'); toast('실패: ' + (err as Error).message, 5000); })
          .finally(() => { (el as HTMLButtonElement).disabled = false; });
      },
      dSource: (el: HTMLElement) => { dist.source = (el as HTMLInputElement).value.trim(); },
      dType: (el: HTMLElement) => { dist.type = (el as HTMLSelectElement).value as Dist['type']; },
      dKw: (el: HTMLElement) => { dist.kw = (el as HTMLInputElement).value; paint(); },
      allocNew: () => { const kw = Number(dist.kw); if (!(kw > 0) || !dist.source) { toast('출처와 전력을 입력하세요.'); return; } sign(actions.allocationCreate(dist.source, dist.type, Math.round(kw * 1e6)), '할당을 만들었습니다'); },
      allocPower: (el: HTMLElement) => { const v = Number(prompt('새 전력 (kW)')); if (v > 0) sign(actions.allocationUpdate(el.dataset.id!, Math.round(v * 1e6)), '전력을 바꿨습니다'); },
      allocConn: (el: HTMLElement) => { const to = (prompt('연결할 변전소 ID', dist.subs[0]?.id ?? p.substation_id) || '').trim(); if (/^4-\d+$/.test(to)) sign(actions.allocationConnect(el.dataset.id!, to), `${to}에 연결했습니다`); },
      allocDisc: (el: HTMLElement) => sign(actions.allocationDisconnect(el.dataset.id!), '연결을 끊었습니다'),
      allocDel: (el: HTMLElement) => { sign(actions.allocationDelete(el.dataset.id!), '할당을 삭제했습니다'); },
      subNew: (el: HTMLElement) => sign(actions.substationCreate(pid, el.dataset.id!), '변전소를 만들었습니다'),
      subName: (el: HTMLElement) => { const nm = (prompt('변전소 이름') || '').trim(); if (nm) sign(actions.substationName(el.dataset.id!, nm), '이름을 바꿨습니다'); },
      subJoin: (el: HTMLElement) => sign(actions.substationConnect(el.dataset.id!, pid), '변전소에 연결했습니다'),
      infReactor: (el: HTMLElement) => { inf.reactor = (el as HTMLInputElement).value.trim(); },
      infAmount: (el: HTMLElement) => { inf.amount = (el as HTMLInputElement).value; },
      infuseReal: async () => {
        const g = Number(inf.amount);
        if (!(g > 0) || !inf.reactor) { toast('리액터와 알파 양을 입력하세요.'); return; }
        inf.busy = true; paint();
        try {
          const v = await validatorOf(inf.reactor);
          if (!v) throw new Error(`${inf.reactor}의 검증인을 찾지 못했습니다`);
          await actions.reactorInfuse(v, Math.round(g * 1e6));
          sfx.play('coin'); notify('리액터 주입', `알파 ${g} g → ${inf.reactor}`, 'hwang', null);
          setTimeout(() => void load(), 6000);
        } catch (err) { sfx.play('error'); toast('주입 실패: ' + (err as Error).message, 5000); }
        inf.busy = false; paint();
      },
      defuse: async (el: HTMLElement) => {
        const id = el.dataset.id!, fuel = Number(el.dataset.fuel) / 1e6;
        const ans = prompt(`${id}에서 회수할 알파 (g, 최대 ${fuel.toFixed(2)})`, fuel.toFixed(2));
        const g = Number(ans);
        if (!(g > 0)) return;
        try {
          const v = await validatorOf(id);
          if (!v) throw new Error('검증인을 찾지 못했습니다');
          await actions.reactorDefuse(v, Math.round(Math.min(g, fuel) * 1e6));
          sfx.play('confirm'); toast('회수를 시작했습니다');
          setTimeout(() => void load(), 6000);
        } catch (err) { toast('회수 실패: ' + (err as Error).message, 5000); }
      },
      infuse: (el: HTMLElement) => {
        const g = Number(el.dataset.g ?? 1);
        const m = demo.infuse(g);
        if (m) { sfx.play('error'); toast(m); return; }
        sfx.play('coin'); float(el, `+${g} kW`, 'var(--hwang)', true);
        notify('리액터 주입', `알파 ${g} g → 용량 +${g} kW`, 'hwang', null);
        if (g >= 5) career.award(10, '대규모 주입');
        load();
      },
    };
    const load = async () => {
      try {
        if (isDemo) ({ p, e, structs } = demoEnergy());
        else {
          p = await guildApi.player(pid);
          [e, structs] = await Promise.all([energy(p), guildApi.structsOf(pid).catch(() => [])]);
          dist.subs = await guildApi.substationsOf(pid).then((r) => r.map((x) => ({ id: x.id, name: x.name }))).catch(() => []);
          if (!inf.reactor) inf.reactor = e.infusions[0]?.destination_id ?? (await guildApi.guild(p.guild_id).catch(() => null))?.primary_reactor_id ?? '';
        }
        recompute();
        paint();
      } catch (err) { mount(root, errorCard(err)); }
    };
    await load();
    const offKeys = keys.scope({ i: () => isDemo && handlers.infuse(document.querySelector<HTMLElement>('[data-act="infuse"]') ?? document.body) });
    if (isDemo) { const off = demo.onBlock(() => void load()); return () => { off(); offKeys(); setTiles([]); }; }
    const again = throttled(() => void load(), 2000);
    const off = onGrass(`structs.grid.player.${pid}.>`, again);
    return () => { off(); offKeys(); setTiles([]); };
  },
};
export default screen;
