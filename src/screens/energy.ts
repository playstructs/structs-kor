/* 에너지 관리: online ⇔ load + structsLoad ≤ capacity + capacitySecondary. One read (REQ-EN-1)
 * with allocations in cascade order, a brownout what-if (REQ-EN-2), and struct power switches
 * (signed MsgStructActivate / MsgStructDeactivate). */
import type { Screen } from '../router';
import { html, mount, n, watts, micro, toast, type Safe } from '../ui/dom';
import { needSession, errorCard, loading } from '../ui/gate';
import { energy, whatIfLocal, powerWhatIf, type Energy } from '../api/planned';
import { guildApi, type PlayerRow, type StructRow } from '../api/guild';
import { actions } from '../api/actions';
import { wallet } from '../wallet/wallet';
import { onGrass, throttled } from '../grass/grass';
import { ALLOCATION_TYPE, STRUCT_TYPE, entityOf } from '../i18n/ko';
import { TYPES_BY_ID } from '../data/catalogue';

const ONLINE = 4, DESTROYED = 32;

function view(p: PlayerRow, e: Energy, structs: StructRow[], dropKw: number, cut: Set<string>, offline: boolean): Safe {
  const pw = e.power;
  const cap = Number(pw?.capacity ?? p.capacity), sec = Number(pw?.connection_capacity ?? p.connection_capacity);
  const load = Number(pw?.load ?? p.load), sl = Number(pw?.structs_load ?? p.structs_load);
  const supply = cap + sec, demand = load + sl, use = demand / Math.max(1, supply);
  const tone = use > 0.95 ? 'var(--jeok)' : use > 0.8 ? 'var(--warn)' : 'var(--cheong)';
  const wl = Math.min(100, (load / Math.max(1, supply)) * 100), ws = Math.min(100 - wl, (sl / Math.max(1, supply)) * 100);
  const infused = e.infusions.reduce((s, i) => s + Number(i.power_p ?? i.power ?? 0), 0);
  return html`
  <section class="card">
    <div class="card-head"><h1 style="font-size:28px">전력 사용률 <span class="mono" style="color:${tone}">${Math.round(use * 100)}%</span></h1>
      <span class="mono">${watts(demand)} / ${watts(supply)}</span>
      <span class="end chip ${use > 1 ? 'jeok' : 'cheong'}">● ${use > 1 ? '오프라인' : '그리드 온라인'}</span></div>
    <div style="position:relative;height:28px;background:var(--sunken);border:1px solid var(--line);display:flex" role="img" aria-label="할당 부하 ${watts(load)}, 구조체 소비 ${watts(sl)}, 총 용량 ${watts(supply)}">
      <div style="width:${wl}%;background:var(--hwang)"></div><div style="width:${ws}%;background:var(--cheong)"></div>
      <div style="position:absolute;top:-4px;bottom:-4px;left:80%;width:2px;background:var(--warn)"></div><div style="position:absolute;top:-4px;bottom:-4px;left:95%;width:2px;background:var(--jeok-strong)"></div>
    </div>
    <div style="display:flex;flex-wrap:wrap;gap:18px;font-size:13px">
      <span><i style="display:inline-block;width:10px;height:10px;background:var(--hwang)"></i> 할당 부하 <b class="mono c-white">${watts(load)}</b></span>
      <span><i style="display:inline-block;width:10px;height:10px;background:var(--cheong)"></i> 구조체 소비 <b class="mono c-white">${watts(sl)}</b></span>
      <span>내 용량 <b class="mono c-white">${watts(cap)}</b></span><span>변전소 몫 <b class="mono c-white">${watts(sec)}</b></span>
      <span class="c-warn">80% 경고</span><span class="c-jeok">95% 위험</span>
    </div>
  </section>

  <section class="card"><div class="card-head"><h2>전력 흐름</h2><span class="dim" style="font-size:13px">에너지는 저장되지 않습니다 · 같은 블록에 생산·소비</span></div>
    <div style="display:flex;flex-wrap:wrap;align-items:stretch">
      ${[
        ['알파 매터', micro(p.alpha) + ' g', '1 g = 1 kW', 'var(--hwang-bg)', 'var(--hwang-line)'],
        [`주입 · ${e.infusions.length}건`, watts(infused), e.infusions[0] ? `${e.infusions[0].destination_id} · 수수료 ${n(e.infusions[0].commission)}%` : '리액터에 주입하세요', 'var(--bg-raised)', 'var(--line-strong)'],
        ['내 용량', watts(cap), '외부로 할당 가능', 'var(--cheong-bg)', 'var(--cheong)'],
        [`할당 · ${e.allocations_out.length}건`, watts(load), '생성 순서대로 차단', 'var(--bg-raised)', 'var(--hwang)'],
        [`변전소 · ${e.substation?.id ?? '—'}`, e.substation?.connection_count != null ? `${n(e.substation.connection_count)}명 연결` : '—', '(용량 − 부하) ÷ 연결 수', 'var(--bg-raised)', 'var(--line-strong)'],
      ].map(([k, v, s, bg, bd], i) => html`${i ? html`<span aria-hidden="true" style="display:flex;align-items:center;justify-content:center;flex:0 0 28px;color:var(--text-faint);font-size:20px">→</span>` : ''}
        <div style="flex:1 1 150px;padding:12px 14px;background:${bg};border:1px solid ${bd};display:flex;flex-direction:column;gap:4px"><small class="dim">${k}</small><strong class="mono c-white" style="font-size:18px">${v}</strong><span style="font-size:12px">${s}</span></div>`)}
    </div>
  </section>

  <div class="g2">
    <section class="card flush"><div class="card-head" style="padding:16px"><h2>내 할당</h2><span class="end dim" style="font-size:12px">정전 시 위에서부터 차단</span></div>
      <div class="scroll-x"><table class="t" style="min-width:520px"><thead><tr><th>순서</th><th>할당</th><th>대상</th><th>유형</th><th class="r">용량</th><th class="r">정전 시</th></tr></thead><tbody>
      ${e.allocations_out.length ? e.allocations_out.map((a) => html`<tr style="background:${cut.has(a.id) ? 'var(--jeok-bg)' : 'transparent'}">
        <td class="mono">${a.cascade_rank}</td><td class="mono c-cheong">${a.id}</td><td class="c-white">${entityOf(a.destination_id)} ${a.destination_id}</td>
        <td>${ALLOCATION_TYPE[a.allocation_type] ?? a.allocation_type}</td><td class="r mono">${a.power == null ? '—' : watts(Number(a.power))}</td>
        <td class="r" style="font-weight:700;color:${cut.has(a.id) ? 'var(--jeok)' : 'var(--cheong)'}">${cut.has(a.id) ? '차단' : '유지'}</td></tr>`) : html`<tr><td colspan="6" class="empty">외부로 나가는 할당이 없습니다.</td></tr>`}
      </tbody></table></div>
      ${e.allocations_in.length ? html`<p class="note" style="padding:12px 16px">받는 할당 ${e.allocations_in.length}건: ${e.allocations_in.map((a) => a.source_id).join(', ')}</p>` : ''}
    </section>
    <section class="card warn"><h2>정전 시뮬레이션</h2>
      <label class="field"><span style="font-size:15px;color:var(--text)">내 용량이 <b class="mono c-hwang" style="font-size:18px">${dropKw} kW</b> 줄어들면?</span>
        <input type="range" min="0" max="${Math.max(10, Math.ceil(cap / 1e6))}" value="${dropKw}" data-act="drop" style="accent-color:var(--hwang);min-height:32px"></label>
      <div style="padding:14px;background:var(--sunken);border:1px solid var(--line);font-size:14px;line-height:1.6">
        차단되는 할당 <b class="mono c-jeok">${cut.size}건</b><br>
        ${dropKw === 0 ? '현재는 모든 할당이 유지됩니다.' : offline ? '할당을 모두 끊어도 부족합니다. 구조체 전원을 꺼야 온라인을 유지할 수 있습니다.' : cut.size ? '차단된 할당을 받던 대상도 전력을 잃습니다. 미리 할당을 줄이거나 리액터에 추가 주입하세요.' : '여유 용량으로 흡수됩니다.'}
      </div>
      <p class="note">부하가 용량을 넘으면 체인이 외부 할당을 생성 순서대로 삭제하고, 손실은 하위로 연쇄됩니다 (GridCascade).</p>
    </section>
  </div>

  <section class="card"><div class="card-head"><h2>구조체 전원</h2><span class="dim" style="font-size:13px">오프라인이면 건설·공격·채굴 불가 · 복구 행동은 가능</span></div>
    ${wallet.state !== 'unlocked' ? html`<div class="notice">전원을 바꾸려면 지갑 잠금을 해제하세요 (트랜잭션 서명).</div>` : ''}
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:10px">
      ${structs.filter((s) => !(s.status & DESTROYED)).map((s) => {
        const on = (s.status & ONLINE) !== 0;
        const draw = TYPES_BY_ID[s.type]?.passiveDraw;
        return html`<div style="display:flex;align-items:center;gap:12px;padding:12px 14px;background:var(--bg-raised);border:1px solid var(--line)">
          <div style="flex:1 1 auto;display:flex;flex-direction:column;gap:2px"><strong class="c-white" style="font-size:14px">${STRUCT_TYPE[s.type] ?? s.type} <span class="mono faint" style="font-size:11px">${s.id}</span></strong><span class="mono" style="font-size:12px">${draw != null ? watts(draw) : '—'} · ${on ? '가동' : '꺼짐'}</span></div>
          <button class="sw" aria-pressed="${on}" aria-label="${STRUCT_TYPE[s.type] ?? s.type} 전원" data-act="power" data-id="${s.id}" data-on-state="${on ? 1 : 0}" ${wallet.state !== 'unlocked' ? 'disabled' : ''}></button></div>`;
      })}
    </div>
  </section>`;
}

const screen: Screen = {
  async render(root) {
    const pid = needSession(root, '에너지 관리');
    if (!pid) return;
    mount(root, loading());
    let p: PlayerRow, e: Energy, structs: StructRow[] = [];
    let dropKw = 0;
    let cut = new Set<string>(), offline = false;
    const paint = () => { if (root.isConnected) mount(root, view(p, e, structs, dropKw, cut, offline), handlers); };
    const handlers = {
      drop: (el: HTMLElement) => {
        dropKw = Number((el as HTMLInputElement).value);
        const local = whatIfLocal(e, dropKw * 1e6);
        cut = new Set(local.cut); offline = local.offline; paint();
        // The guild's answer (REQ-EN-2) replaces the local one when it serves it.
        const want = dropKw;
        void powerWhatIf(pid, e, dropKw * 1e6).then((r) => { if (want === dropKw) { cut = new Set(r.cut); offline = r.offline; paint(); } }).catch(() => null);
      },
      power: (el: HTMLElement) => {
        const id = el.dataset.id!, on = el.dataset.onState === '1';
        (el as HTMLButtonElement).disabled = true;
        (on ? actions.structDeactivate(id) : actions.structActivate(id))
          .then((h) => toast(`전송됨 · ${h.slice(0, 10)}…`))
          .catch((err) => toast('실패: ' + (err as Error).message, 5000))
          .finally(() => { (el as HTMLButtonElement).disabled = false; });
      },
    };
    const load = async () => {
      try {
        p = await guildApi.player(pid);
        [e, structs] = await Promise.all([energy(p), guildApi.structsOf(pid).catch(() => [])]);
        paint();
      } catch (err) { mount(root, errorCard(err)); }
    };
    await load();
    const again = throttled(() => void load(), 2000);
    const off = onGrass(`structs.grid.player.${pid}.>`, again);
    return () => off();
  },
};
export default screen;
