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

function view(p: PlayerRow, e: Energy, structs: StructRow[], dropKw: number, cut: Set<string>, offline: boolean, isDemo: boolean): Safe {
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
          ${e.allocations_out.map((a) => html`<div class="sink ${cut.has(a.id) ? 'cut' : ''}"><span class="rank mono">${a.cascade_rank}</span><div><b>${ALLOCATION_TYPE[a.allocation_type] ?? a.allocation_type} → ${entityOf(a.destination_id)} ${a.destination_id}</b><small class="mono">${a.id}</small></div><span class="mono">${a.power == null ? '—' : watts(Number(a.power))}</span></div>`)}
          <div class="sink ${offline ? 'cut' : ''}"><span class="rank mono">${e.allocations_out.length + 1}</span><div><b>구조체 ${live.filter((s) => s.status & ONLINE).length}기 가동</b><small>정전 시 꺼짐</small></div><span class="mono">${watts(sl)}</span></div>
        </div>
      </div>
    </section>

    <section class="card game-panel warn wargame"><h2>정전 워게임</h2>
      <label class="field"><span style="font-size:15px;color:var(--text)">적이 내 용량 <b class="mono c-hwang" style="font-size:18px">${dropKw} kW</b>를 끊으면?</span>
        <input type="range" min="0" max="${Math.max(10, Math.ceil(supply / 1e6))}" value="${dropKw}" data-act="drop" style="accent-color:var(--hwang);min-height:32px"></label>
      <div class="verdict ${verdict[2]}"><strong>${verdict[0]}</strong><span>${verdict[1]}</span></div>
      <div style="display:flex;flex-direction:column;gap:8px">
        <span class="label dim">권장 대응</span>
        ${isDemo ? html`
          <button class="btn gold" data-act="infuse" data-g="1" style="justify-content:space-between">알파 1 g 주입 <span class="mono">+1 kW · <kbd>I</kbd></span></button>
          <button class="btn ghost" data-act="infuse" data-g="5" style="justify-content:space-between" ${demo.state.alpha < 5 ? 'disabled' : ''}>알파 5 g 주입 <span class="mono">+5 kW</span></button>` : html`<p class="note">리액터에 알파를 주입하면 1 g당 1 kW 용량이 생깁니다 (MsgReactorInfuse).</p>`}
        <a class="btn ghost" href="${href('/market')}" style="justify-content:space-between">여유 ${watts(spare)} 판매 <span class="mono c-cheong">거래소 →</span></a>
      </div>
      <p class="note">부하가 용량을 넘으면 체인이 외부 할당을 생성 순서대로 삭제하고, 손실은 하위로 연쇄됩니다 (GridCascade).</p>
    </section>
  </div>

  <section class="card game-panel"><div class="card-head"><h2>구조체 전원</h2><span class="dim" style="font-size:13px">오프라인이면 건설·공격·채굴 불가 · 복구 행동은 가능</span></div>
    ${canSign ? '' : html`<div class="notice">전원을 바꾸려면 지갑 잠금을 해제하세요 (트랜잭션 서명).</div>`}
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
    const tiles = () => {
      const pw = e.power;
      const use = pw ? Number(pw.total_load) / Math.max(1, Number(pw.total_capacity)) : 0;
      setTiles([
        { label: '알파 매터', value: micro(p.alpha) + ' g', num: Number(p.alpha) / 1e6, fmt: (v) => n(v, 2) + ' g', tone: 'var(--hwang)' },
        { label: `전력 · ${Math.round(use * 100)}%`, value: pw ? `${watts(Number(pw.total_load))} / ${watts(Number(pw.total_capacity))}` : '—', tone: use > 0.95 ? 'var(--jeok)' : use > 0.8 ? 'var(--warn)' : 'var(--cheong)', alert: use > 0.95 },
        { label: '여유 전력', value: pw ? watts(Math.max(0, Number(pw.total_capacity) - Number(pw.total_load))) : '—', tone: 'var(--cheong-hi)' },
      ]);
    };
    const paint = () => { if (root.isConnected) { mount(root, view(p, e, structs, dropKw, cut, offline, isDemo), handlers); tiles(); } };
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
          .then((h) => { sfx.play('confirm'); toast(`전송됨 · ${h.slice(0, 10)}…`); })
          .catch((err) => { sfx.play('error'); toast('실패: ' + (err as Error).message, 5000); })
          .finally(() => { (el as HTMLButtonElement).disabled = false; });
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
