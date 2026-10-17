/* 지휘 콘솔: the commander's planet, fleet, work and live log. One read (REQ-AGG-1), refreshed by
 * GRASS events for this player and planet instead of polling. */
import type { Screen } from '../router';
import { href } from '../router';
import { html, mount, n, watts, micro, type Safe } from '../ui/dom';
import { needSession, errorCard, loading } from '../ui/gate';
import { setTiles } from '../ui/shell';
import { dashboard, type Dashboard } from '../api/planned';
import type { StructRow } from '../api/guild';
import { onGrass, throttled } from '../grass/grass';
import { AMBIT, AMBITS, STRUCT_TYPE, WORK, activityLabel } from '../i18n/ko';

const DESTROYED = 32, ONLINE = 4;
const isFleetType = (t: number) => t <= 13;

function slots(d: Dashboard, where: 'planet' | 'fleet'): Safe {
  const planetSlots: Record<string, number> = { space: d.planet?.space_slots ?? 4, air: d.planet?.air_slots ?? 4, land: d.planet?.land_slots ?? 4, water: d.planet?.water_slots ?? 4 };
  const mine = d.structs.filter((s) => (where === 'fleet' ? isFleetType(s.type) : !isFleetType(s.type)));
  return html`${AMBITS.map((a) => {
    const count = where === 'fleet' ? 4 : Math.max(1, Math.min(4, planetSlots[a] || 1));
    const row: (StructRow | null)[] = Array.from({ length: count }, (_, i) => mine.find((s) => s.operating_ambit === a && s.slot === i) ?? null);
    return html`<div style="display:grid;grid-template-columns:52px repeat(4,minmax(0,1fr));gap:6px">
      <span class="dim" style="display:flex;align-items:center;justify-content:center;background:var(--bg-raised);font-size:12px">${AMBIT[a]}</span>
      ${row.map((s, i) => s ? structCell(s) : html`<div style="min-height:70px;padding:8px 10px;background:var(--surface);border:1px dashed var(--line-strong);color:var(--text-faint);font-size:13px;display:flex;flex-direction:column;justify-content:space-between"><span class="mono" style="font-size:11px">${AMBIT[a]} · ${i + 1}</span><span>비어 있음</span></div>`)}
    </div>`;
  })}`;
}

function structCell(s: StructRow): Safe {
  const dead = (s.status & DESTROYED) !== 0;
  const online = (s.status & ONLINE) !== 0;
  const prot = s.protected_struct_id;
  const tone = dead ? ['var(--bg-raised)', 'var(--jeok-strong)', 'var(--jeok)'] : !online ? ['var(--hwang-bg)', 'var(--hwang-line)', 'var(--hwang)'] : ['var(--cheong-bg)', 'var(--cheong-mid)', 'var(--cheong-hi)'];
  return html`<div style="min-height:70px;padding:8px 10px;background:${tone[0]};border:1px solid ${tone[1]};display:flex;flex-direction:column;justify-content:space-between;gap:4px" title="${s.id}">
    <span class="mono" style="font-size:11px;color:${tone[2]}">${s.id}${prot ? ` · 방어 → ${prot}` : ''}</span>
    <strong class="c-white" style="font-size:14px">${STRUCT_TYPE[s.type] ?? `유형 ${s.type}`}</strong>
    <span class="mono" style="font-size:11px;color:${tone[2]}">${dead ? '파괴됨' : online ? `HP ${s.health}` : '오프라인'}</span>
  </div>`;
}

function view(d: Dashboard): Safe {
  const p = d.player;
  const pw = d.power;
  const raid = d.active_raid;
  return html`
  ${raid ? html`<section class="card danger" role="alert"><div class="card-head"><h2 style="color:var(--jeok-hi)">행성 습격 진행 중</h2><span class="end mono c-jeok">${raid.status}</span></div>
    <p style="margin:0;color:#F4D3C9">함대 ${raid.fleet_id}${raid.fleet_owner ? ` (${raid.fleet_owner})` : ''}가 행성 ${raid.planet_id}의 방어를 돌파하려 합니다. 방어 구조체를 확인하세요.</p>
    <div><a class="btn danger" href="${href('/sim')}">방어 시뮬레이션</a></div></section>` : ''}
  <div class="row">
    <section class="card grow" aria-label="행성">
      <div class="card-head"><h1 style="font-size:26px">${d.planet?.name || `행성 ${p.planet_id || '—'}`}</h1>
        <span class="label c-cheong">${p.planet_id}</span>
        <span class="end chip ${d.shield_health != null && d.shield_health < 50 ? 'jeok' : 'cheong'}">보호막 ${d.shield_health == null ? '—' : d.shield_health + '%'}</span></div>
      ${slots(d, 'planet')}
      <div style="display:flex;flex-wrap:wrap;gap:20px;font-size:14px;border-top:1px solid var(--line);padding-top:12px">
        <span>남은 광석 <strong class="mono c-hwang">${n(d.planet?.undiscovered_ore)}</strong></span>
        <span>보유 광석 <strong class="mono c-white">${n(p.ore)}</strong> <span class="faint">(약탈 가능)</span></span>
        <span>블록 <strong class="mono c-white">${d.height == null ? '—' : '#' + n(d.height)}</strong></span>
      </div>
    </section>
    <aside class="side" style="display:flex;flex-direction:column;gap:16px">
      <section class="card"><div class="card-head"><h2>작업 증명</h2><span class="end faint" style="font-size:12px">해시 작업</span></div>
        ${d.work.length ? html`<ul class="log" style="padding:0">${d.work.map((w) => html`<li style="display:flex;justify-content:space-between;gap:8px"><span class="c-cheong">${WORK[w.category] ?? w.category} · ${w.object_id}</span><span class="dim">난이도 ${n(w.difficulty_target)}</span></li>`)}</ul>` : html`<p class="empty" style="padding:8px">진행 중인 작업이 없습니다.</p>`}
      </section>
      <section class="card" style="background:var(--sunken)"><div class="card-head"><h2>실시간 기록</h2></div>
        ${d.activity.length ? html`<ol class="log" style="padding:0">${d.activity.slice(0, 12).map((a) => html`<li><span class="faint">${a.block_height ? '#' + a.block_height : new Date(a.time).toLocaleTimeString('ko-KR')}</span> <span class="${a.category.includes('attack') || a.category.includes('raid') ? 'c-jeok' : 'c-cheong'}">${activityLabel(a.category)}</span> <span class="dim">${a.planet_id}</span></li>`)}</ol>` : html`<p class="empty" style="padding:8px">기록이 없습니다.</p>`}
      </section>
    </aside>
  </div>
  <section class="card" aria-label="함대">
    <div class="card-head"><h2>내 함대</h2><span class="mono dim">${d.fleet?.id ?? '—'}</span><span class="end chip ${d.fleet?.status === 'onStation' ? 'cheong' : 'hwang'}">${d.fleet?.status === 'onStation' ? '본거지 주둔' : d.fleet?.status ? '원정 중 · ' + d.fleet.location_id : '—'}</span></div>
    ${slots(d, 'fleet')}
    <div style="display:flex;flex-wrap:wrap;gap:10px"><a class="btn gold" href="${href('/sim')}">먼저 시뮬레이션</a><a class="btn ghost" href="${href('/energy')}">전력 관리</a><a class="btn ghost" href="${href('/replicants')}">레플리칸트</a></div>
  </section>
  <p class="note">전력 ${pw ? `${watts(Number(pw.total_load))} / ${watts(Number(pw.total_capacity))}` : '—'} · 알파 ${micro(p.alpha)} g · 길드 ${p.guild_name || p.guild_id}</p>`;
}

const screen: Screen = {
  async render(root) {
    const pid = needSession(root, '지휘 콘솔');
    if (!pid) return;
    mount(root, loading());
    let d: Dashboard;
    const load = async () => {
      try {
        d = await dashboard(pid);
        const pw = d.power;
        const use = pw ? Number(pw.total_load) / Math.max(1, Number(pw.total_capacity)) : 0;
        setTiles([
          { label: '알파 매터', value: micro(d.player.alpha) + ' g', tone: 'var(--hwang)', href: '/market' },
          { label: `전력 · ${Math.round(use * 100)}%`, value: pw ? `${watts(Number(pw.total_load))} / ${watts(Number(pw.total_capacity))}` : '—', tone: use > 0.95 ? 'var(--jeok)' : use > 0.8 ? 'var(--warn)' : 'var(--cheong)', href: '/energy' },
          { label: '보유 광석 · 약탈 가능', value: n(d.player.ore) },
          { label: '구조체', value: n(d.structs.filter((s) => !(s.status & DESTROYED)).length) },
        ]);
        if (root.isConnected) mount(root, view(d));
      } catch (e) { mount(root, errorCard(e)); }
    };
    await load();
    const again = throttled(() => void load(), 2000);
    const offs = [onGrass(`structs.grid.player.${pid}.>`, again), onGrass(`structs.player.*.${pid}`, again)];
    if (d!?.player.planet_id) offs.push(onGrass(`structs.planet.${d!.player.planet_id}.>`, again));
    return () => { offs.forEach((f) => f()); setTiles([]); };
  },
};
export default screen;
