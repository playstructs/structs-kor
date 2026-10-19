/* 레플리칸트: extra commanders derived from the same recovery phrase (HD index ≥ 1), each its own
 * player in the guild — your armada.
 *
 *   복제 콘솔   one button (the guild's signup for the next HD index), 자동 복제, the energy gate:
 *              each new player needs ≥ 4 kW of substation share, (capacity − load) ÷ (connections + 1)
 *   명단        every replicant as a card: role, power battery, alpha, ore, planet; filter, sort, select;
 *              sweep alpha home, set roles in bulk, send from any one
 *   분대        the squad by role, with totals, shareable
 *   복무 규칙   the standing orders this browser runs (auto-sweep, auto-replicate) and the duty log
 *
 * After structs-universe's Armada roster and replication window. */
import type { Screen } from '../router';
import { href } from '../router';
import { html, mount, n, micro, watts, toast, raw, type Safe } from '../ui/dom';
import { portraitHtml, seededPfp } from '../game/portrait';
import { needSession, errorCard, loading } from '../ui/gate';
import type { Replicant } from '../api/planned';
import { wallet } from '../wallet/wallet';
import { MOCK } from '../api/http';
import { setTiles } from '../ui/shell';
import { sfx } from '../game/sfx';
import { float } from '../game/fx';
import { openTransfer } from '../social/transfer';
import { share } from '../social/share';
import { doctrine, setDoctrine, dutyLog, onOrders, roster, replicate, sweep, shareNow, derived, runOrdersNow, CALLSIGNS, SCAN, type Role } from '../game/orders';

type Tab = 'roster' | 'squads' | 'orders';
const ROLE: Record<Role, { name: string; builds: string; c1: string; c2: string; head: string }> = {
  productive: { name: '생산형', builds: '추출기 · 정제소 · 필드 발전기', c1: '#43CDB6', c2: '#1C5F6A', head: '#133546' },
  bait: { name: '미끼형', builds: '추출기만 · 광석 축적', c1: '#EBAA49', c2: '#785B02', head: '#3A2F12' },
  raider: { name: '레이더형', builds: '스타파이터 · 추격 전투기 · 탱크 · 구축함', c1: '#EE7D69', c2: '#5D0C15', head: '#2E1F3E' },
};
const ROLES = Object.keys(ROLE) as Role[];
const sw = (on: boolean, act: string, label: string) => html`<button class="sw" aria-pressed="${on}" aria-label="${label}" data-act="${act}"></button>`;

const screen: Screen = {
  async render(root, params) {
    const pid = needSession(root, '레플리칸트');
    if (!pid) return;
    if (!MOCK && wallet.state !== 'unlocked') {
      mount(root, html`<section class="card accent" style="max-width:560px;margin:40px auto"><h1 style="font-size:28px">계정 잠금 해제 필요</h1><p class="note">레플리칸트는 내 사령관 계정에서 갈라져 나온 부대입니다. 부대를 불러오려면 계정 잠금을 해제하세요.</p><a class="btn primary" href="${href('/login')}">잠금 해제</a></section>`);
      return;
    }
    mount(root, loading());
    let list: Replicant[] = [], gate = { share: 0, free: 0, conns: 0, ok: false }, busy = false, count = 1;
    let tab: Tab = (params.get('tab') as Tab) || 'roster', q = '', roleF: Role | '' = '', attention = false, sort: 'index' | 'alpha' | 'ore' | 'power' = 'index';
    const selected = new Set<string>();
    let bulkRole: Role = 'productive';

    const roleOf = (r: Replicant): Role => doctrine().roles[r.player_id] ?? doctrine().roles[`idx:${r.hd_index}`] ?? 'productive';
    const nameOf = (r: Replicant, i = 0) => r.username || `${CALLSIGNS[(r.hd_index ?? i) % CALLSIGNS.length]}-${r.hd_index ?? i + 1}`;
    const pct = (r: Replicant) => Number(r.capacity) > 0 ? Math.min(1.5, Number(r.load) / Number(r.capacity)) : 0;
    const needsAttention = (r: Replicant) => !r.planet_id || pct(r) > 0.95 || (Number(r.alpha) === 0 && Number(r.ore) === 0);
    const nextIndex = () => { const used = new Set(list.map((r) => r.hd_index)); for (let i = 1; i <= SCAN + 20; i++) if (!used.has(i)) return i; return SCAN + 1; };
    const totAlpha = () => list.reduce((s, r) => s + Number(r.alpha), 0) / 1e6;
    const sweepable = () => { const d = doctrine(); return list.reduce((s, r) => s + Math.max(0, Number(r.alpha) / 1e6 - d.keep), 0); };
    const shown = () => list.filter((r) => (!q || nameOf(r).toLowerCase().includes(q.toLowerCase()) || r.player_id.includes(q) || (r.planet_id || '').includes(q)) && (!roleF || roleOf(r) === roleF) && (!attention || needsAttention(r)))
      .sort((a, b) => sort === 'alpha' ? Number(b.alpha) - Number(a.alpha) : sort === 'ore' ? Number(b.ore) - Number(a.ore) : sort === 'power' ? pct(b) - pct(a) : (a.hd_index ?? 0) - (b.hd_index ?? 0));

    const battery = (r: Replicant) => { const p = pct(r), lit = Math.max(0, 5 - Math.ceil(p * 5)); return html`<span class="battery ${p > 0.95 ? 'low' : ''}" title="전력 ${watts(Number(r.load))} / ${watts(Number(r.capacity))}">${[0, 1, 2, 3, 4].map((i) => html`<i class="${i < lit ? 'on' : ''}"></i>`)}</span>`; };

    const consoleCard = (): Safe => {
      const d = doctrine();
      return html`<section class="card game-panel rep-console">
        <button class="rep-big" data-act="replicate" ${(!gate.ok && !MOCK) || busy ? 'disabled' : ''}>복제 <small>#${nextIndex()}${count > 1 ? ` 외 ${count - 1}` : ''}</small></button>
        <div class="rep-console-row"><label class="rep-count">수량 <input class="input mono" type="number" min="1" max="5" name="count" value="${count}" data-act="count"></label>
          <select class="input" data-act="newRole" data-on="change" aria-label="새 레플리칸트 역할">${ROLES.map((r) => html`<option value="${r}" ${d.newRole === r ? 'selected' : ''}>${ROLE[r].name}</option>`)}</select>
          <span class="rep-auto">${sw(d.autoReplicate, 'tAutoRep', '자동 복제')} 자동 복제</span></div>
        <div class="rep-figures">
          <div><b class="mono" style="color:${gate.ok ? 'var(--cheong)' : 'var(--jeok)'}">${watts(gate.share)}</b><small>연결당 전력${gate.ok ? '' : ' · 4 kW 미만'}</small></div>
          <div><b class="mono">${n(list.length)}</b><small>레플리칸트</small></div>
          <div><b class="mono c-hwang">${n(totAlpha(), 2)} g</b><small>보유 알파</small></div>
          <div><b class="mono">${n(list.reduce((s, r) => s + Number(r.ore), 0))}</b><small>보유 광석</small></div>
          <div><b class="mono ${list.filter(needsAttention).length ? 'c-warn' : ''}">${n(list.filter(needsAttention).length)}</b><small>주의 필요</small></div>
        </div>
        <p class="note">변전소에 연결된 사령관 한 명당 ${watts(gate.share)}을 받습니다${gate.conns ? ` (연결 ${n(gate.conns)}명)` : ''}. 레플리칸트를 하나 더 연결하려면 한 명당 4 kW 이상이 남아야 합니다.</p>
      </section>`;
    };

    const rosterTab = (): Safe => {
      const s = shown(), d = doctrine();
      return html`
      <div class="rep-bar">
        <button class="btn gold" data-act="sweepAll" ${busy || sweepable() <= 0 ? 'disabled' : ''}>전체 회수 ${n(sweepable(), 2)} g</button>
        <select class="input" data-act="bulkRole" data-on="change" aria-label="일괄 역할">${ROLES.map((r) => html`<option value="${r}" ${bulkRole === r ? 'selected' : ''}>→ ${ROLE[r].name}</option>`)}</select>
        <button class="btn ghost" data-act="setRoles" ${selected.size ? '' : 'disabled'}>역할 지정 ${selected.size ? `(${selected.size})` : ''}</button>
        <button class="btn ghost" data-act="refresh">새로고침</button>
        <span class="end note">회수 시 각자 ${n(d.keep, 2)} g 남김</span>
      </div>
      <div class="rep-filters">
        <input class="input" name="q" value="${q}" placeholder="이름 · ID · 행성" data-act="q" aria-label="필터">
        <select class="input" data-act="roleF" data-on="change" aria-label="역할 필터"><option value="">모든 역할</option>${ROLES.map((r) => html`<option value="${r}" ${roleF === r ? 'selected' : ''}>${ROLE[r].name}</option>`)}</select>
        <label class="chk"><input type="checkbox" data-act="attention" ${attention ? 'checked' : ''}> 주의 필요만</label>
        <select class="input" data-act="sort" data-on="change" aria-label="정렬">${([['index', '번호 순'], ['alpha', '알파 순'], ['ore', '광석 순'], ['power', '전력 사용 순']] as [typeof sort, string][]).map(([k, l]) => html`<option value="${k}" ${sort === k ? 'selected' : ''}>${l}</option>`)}</select>
        <label class="chk"><input type="checkbox" data-act="all" ${s.length && s.every((r) => selected.has(r.player_id)) ? 'checked' : ''}> 보이는 것 전체 선택</label>
      </div>
      ${s.length ? html`<div class="rep-roster">${s.map((r, i) => {
        const ro = ROLE[roleOf(r)];
        return html`<article class="rep-cardx ${selected.has(r.player_id) ? 'sel' : ''} ${needsAttention(r) ? 'warn' : ''}" style="--c1:${ro.c1};--c2:${ro.c2};--hd:${ro.head}">
          <header><label class="rep-pick"><input type="checkbox" data-act="pick" data-id="${r.player_id}" ${selected.has(r.player_id) ? 'checked' : ''} aria-label="${nameOf(r, i)} 선택"></label><div><b>${nameOf(r, i)}</b><small class="mono">#${r.hd_index ?? '?'} · ${r.player_id}</small></div><span class="rep-role">${ro.name}</span></header>
          <div class="rep-mid">${raw(portraitHtml(seededPfp('rep:' + r.address), 60, nameOf(r, i)))}<div class="rep-reads">${battery(r)}<span class="mono c-hwang">${micro(r.alpha, 2)} g α</span><span class="mono">${n(r.ore)} 광석</span></div></div>
          <footer>
            ${r.planet_id ? html`<a class="hud-btn" href="${href(`/o/${r.planet_id}`)}" title="행성 ${r.planet_id}" aria-label="행성"><i class="si icon-planet"></i></a>` : html`<span class="chip jeok" title="행성 없음">행성 없음</span>`}
            <a class="hud-btn" href="${href(`/o/${r.player_id}`)}" title="카드" aria-label="카드"><i class="si icon-member"></i></a>
            <button class="hud-btn" data-act="sendFrom" data-i="${r.hd_index ?? ''}" title="이 레플리칸트에서 보내기" aria-label="보내기"><i class="si icon-send-alpha"></i></button>
            <button class="hud-btn" data-act="sweepOne" data-id="${r.player_id}" title="알파 회수" aria-label="회수" ${Number(r.alpha) / 1e6 > d.keep ? '' : 'disabled'}><i class="si icon-incoming"></i></button>
            <select class="input rep-rolesel" data-act="setRole" data-on="change" data-id="${r.player_id}" aria-label="역할">${ROLES.map((k) => html`<option value="${k}" ${roleOf(r) === k ? 'selected' : ''}>${ROLE[k].name}</option>`)}</select>
          </footer></article>`;
      })}</div>` : html`<div class="card"><p class="empty">${list.length ? '맞는 레플리칸트가 없습니다.' : '아직 레플리칸트가 없습니다. 위에서 첫 레플리칸트를 복제하세요.'}</p></div>`}`;
    };

    const squadsTab = (): Safe => html`<div class="guild-wrap">${ROLES.map((k) => {
      const m = list.filter((r) => roleOf(r) === k), ro = ROLE[k];
      return html`<section class="card game-panel squad" style="--c1:${ro.c1};--c2:${ro.c2}"><div class="card-head"><h2>${ro.name} 분대</h2><span class="end mono">${n(m.length)}명</span></div>
        <p class="note">${ro.builds}</p>
        <div class="stat-grid"><div class="stat"><small>알파</small><strong class="mono c-hwang">${n(m.reduce((s, r) => s + Number(r.alpha), 0) / 1e6, 2)} g</strong></div><div class="stat"><small>광석</small><strong class="mono">${n(m.reduce((s, r) => s + Number(r.ore), 0))}</strong></div><div class="stat"><small>행성</small><strong class="mono">${n(m.filter((r) => r.planet_id).length)}</strong></div></div>
        <div class="squad-faces">${m.slice(0, 16).map((r) => raw(portraitHtml(seededPfp('rep:' + r.address), 34, nameOf(r))))}</div>
        <button class="btn ghost sm" data-act="shareSquad" data-r="${k}" ${m.length ? '' : 'disabled'}>분대 현황 공유</button></section>`;
    })}</div>`;

    const ordersTab = (): Safe => {
      const d = doctrine(), log = dutyLog();
      return html`<div class="guild-wrap">
        <section class="card game-panel"><h2>복무 규칙</h2>
          <div class="order-row"><div><b class="c-white">규칙 활성화</b><br><span class="dim" style="font-size:12px">아래 자동 규칙을 이 브라우저에서 실행</span></div>${sw(d.enabled, 'tEnabled', '규칙 활성화')}</div>
          <div class="order-row"><div><b class="c-white">자동 회수</b><br><span class="dim" style="font-size:12px">알파가 ${n(d.sweepAbove, 2)} g를 넘으면 사령관에게 송금 (2분마다)</span></div>${sw(d.autoSweep, 'tAutoSweep', '자동 회수')}</div>
          <div class="order-row"><div><b class="c-white">자동 복제</b><br><span class="dim" style="font-size:12px">연결당 전력이 4 kW 이상이면 최대 ${n(d.maxReps)}명까지 복제</span></div>${sw(d.autoReplicate, 'tAutoRep', '자동 복제')}</div>
          <div class="order-row"><div><b class="c-white">사령관 자동 조종</b><br><span class="dim" style="font-size:12px">내 계정도 같은 규칙으로 운영 (Structs Desktop)</span></div>${sw(d.autopilot, 'tAuto', '사령관 자동 조종')}</div>
          <div class="stat-grid">
            <label class="field"><span>회수 기준 (g)</span><input class="input mono" type="number" min="0" step="0.1" name="sweepAbove" value="${d.sweepAbove}" data-act="num" data-k="sweepAbove" data-on="change"></label>
            <label class="field"><span>각자 남길 양 (g)</span><input class="input mono" type="number" min="0" step="0.1" name="keep" value="${d.keep}" data-act="num" data-k="keep" data-on="change"></label>
            <label class="field"><span>최대 인원</span><input class="input mono" type="number" min="1" max="60" name="maxReps" value="${d.maxReps}" data-act="num" data-k="maxReps" data-on="change"></label>
            <label class="field"><span>레이더 집결 행성</span><input class="input mono" name="rally" value="${d.rally}" placeholder="2-…" data-act="rally" data-on="change"></label>
          </div>
          <pre class="order-pre">${d.enabled ? `만약 구성 미완성   → 구조체 건설
만약 전력 부족     → 전원 연결
만약 광석 소진     → 새 행성 탐사 (직접 승인)
만약 알파 > ${d.sweepAbove} g  → 사령관에게 회수${d.autoSweep ? ' ✔' : ''}
만약 연결당 ≥ 4 kW → 복제${d.autoReplicate ? ' ✔' : ''}
만약 역할 = 레이더 → ${d.rally || '[집결 행성]'} 집결
만약 행동 거부     → 약 1분 대기` : '규칙 꺼짐 — 아무 행동도 하지 않습니다.'}</pre>
          <button class="btn primary" data-act="runNow" ${busy ? 'disabled' : ''}>지금 한 번 실행</button>
          <p class="note">✔ 표시된 규칙은 이 탭이 열려 있고 계정이 열려 있는 동안 2분마다 실행됩니다. 행성 탐사처럼 되돌릴 수 없는 행동은 자동으로 하지 않습니다.</p>
        </section>
        <section class="card game-panel"><div class="card-head"><h2>근무 일지</h2><button class="linkish end" data-act="clearLog">지우기</button></div>
          ${log.length ? html`<ol class="newswire duty">${log.map((x) => html`<li class="${x.tone ?? ''}"><span class="mono faint">${new Date(x.at).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}</span> ${x.text}</li>`)}</ol>` : html`<p class="empty">아직 기록이 없습니다.</p>`}
        </section></div>`;
    };

    const view = (): Safe => html`
      <div class="card-head"><h1 style="font-size:28px">레플리칸트</h1><span class="label c-cheong">ARMADA · 함대 편성</span></div>
      ${consoleCard()}
      <div class="tabs" role="tablist">${([['roster', `명단 ${n(list.length)}`], ['squads', '분대'], ['orders', '복무 규칙']] as [Tab, string][]).map(([t, l]) => html`<button class="tab ${tab === t ? 'on' : ''}" role="tab" aria-selected="${tab === t}" data-act="tab" data-t="${t}">${l}</button>`)}</div>
      ${tab === 'roster' ? rosterTab() : tab === 'squads' ? squadsTab() : ordersTab()}`;
    const paint = () => {
      if (!root.isConnected) return;
      mount(root, view(), handlers);
      setTiles([{ label: '레플리칸트', value: n(list.length) }, { label: '분대 알파', value: n(totAlpha(), 2) + ' g', tone: 'var(--hwang)' }, { label: '연결당 전력', value: watts(gate.share), tone: gate.ok ? 'var(--cheong)' : 'var(--jeok)' }]);
    };
    const reload = async () => { [list, gate] = await Promise.all([roster(pid), shareNow(pid).catch(() => gate)]); paint(); };
    const handlers = {
      tab: (el: HTMLElement) => { tab = el.dataset.t as Tab; paint(); },
      count: (el: HTMLElement) => { count = Math.max(1, Math.min(5, Number((el as HTMLInputElement).value) || 1)); },
      newRole: (el: HTMLElement) => setDoctrine({ newRole: (el as HTMLSelectElement).value as Role }),
      replicate: async (el: HTMLElement) => {
        busy = true; paint();
        const used = new Set(list.map((r) => r.hd_index));
        const free = (MOCK ? Array.from({ length: SCAN + 20 }, (_, i) => ({ index: i + 1 })) : derived()).filter((x) => !used.has(x.index)).slice(0, count);
        for (const x of free) { try { await replicate(x.index, doctrine().newRole); } catch (e) { toast('복제 실패: ' + (e as Error).message, 5000); break; } }
        sfx.play('confirm'); float(el, `+${free.length} 부화 중`, 'var(--cheong-hi)', true);
        toast(`${free.length}명 복제 신청 · 사령부 등록을 기다립니다`);
        busy = false; paint();
      },
      sweepAll: async () => {
        const d = doctrine();
        busy = true; paint();
        const r = await sweep(list, d.keep, d.keep);
        sfx.play('coin'); toast(`${r.sent}명에게서 ${n(r.total / 1e6, 2)} g 회수`);
        busy = false; setTimeout(() => void reload(), MOCK ? 0 : 6000); paint();
      },
      sweepOne: async (el: HTMLElement) => { const r = list.find((x) => x.player_id === el.dataset.id); if (!r) return; busy = true; paint(); const out = await sweep([r], doctrine().keep, doctrine().keep); toast(out.sent ? `${n(out.total / 1e6, 2)} g 회수` : '회수할 알파가 없습니다'); busy = false; paint(); },
      sendFrom: (el: HTMLElement) => { if (el.dataset.i) void openTransfer({ from: Number(el.dataset.i) }); },
      setRole: (el: HTMLElement) => { setDoctrine({ roles: { ...doctrine().roles, [el.dataset.id!]: (el as HTMLSelectElement).value as Role } }); paint(); },
      bulkRole: (el: HTMLElement) => { bulkRole = (el as HTMLSelectElement).value as Role; },
      setRoles: () => { const roles = { ...doctrine().roles }; for (const id of selected) roles[id] = bulkRole; setDoctrine({ roles }); toast(`${selected.size}명을 ${ROLE[bulkRole].name}(으)로 지정`); selected.clear(); paint(); },
      pick: (el: HTMLElement) => { const id = el.dataset.id!; if (selected.has(id)) selected.delete(id); else selected.add(id); paint(); },
      all: (el: HTMLElement) => { const on = (el as HTMLInputElement).checked; for (const r of shown()) if (on) selected.add(r.player_id); else selected.delete(r.player_id); paint(); },
      q: (el: HTMLElement) => { q = (el as HTMLInputElement).value; paint(); },
      roleF: (el: HTMLElement) => { roleF = (el as HTMLSelectElement).value as Role | ''; paint(); },
      attention: (el: HTMLElement) => { attention = (el as HTMLInputElement).checked; paint(); },
      sort: (el: HTMLElement) => { sort = (el as HTMLSelectElement).value as typeof sort; paint(); },
      refresh: () => void reload(),
      shareSquad: (el: HTMLElement) => {
        const k = el.dataset.r as Role, m = list.filter((r) => roleOf(r) === k);
        share({ kind: 'situation', s: { t: 'fleet', title: `${ROLE[k].name} 분대 ${m.length}명 대기 중`, sub: ROLE[k].builds, lines: [['인원', `${m.length}명`], ['알파', `${n(m.reduce((s, r) => s + Number(r.alpha), 0) / 1e6, 2)} g`], ['광석', n(m.reduce((s, r) => s + Number(r.ore), 0))], ['행성', `${m.filter((r) => r.planet_id).length}곳`]], ids: m.slice(0, 3).map((r) => r.player_id), go: '/replicants', tone: k === 'raider' ? 'jeok' : k === 'bait' ? 'hwang' : 'cheong', at: Date.now() } });
      },
      tEnabled: () => setDoctrine({ enabled: !doctrine().enabled }),
      tAutoSweep: () => setDoctrine({ autoSweep: !doctrine().autoSweep }),
      tAutoRep: () => setDoctrine({ autoReplicate: !doctrine().autoReplicate }),
      tAuto: () => setDoctrine({ autopilot: !doctrine().autopilot }),
      num: (el: HTMLElement) => setDoctrine({ [el.dataset.k!]: Math.max(0, Number((el as HTMLInputElement).value) || 0) } as never),
      rally: (el: HTMLElement) => setDoctrine({ rally: (el as HTMLInputElement).value.trim() }),
      runNow: async () => { busy = true; paint(); await runOrdersNow(); busy = false; await reload(); toast('규칙을 실행했습니다'); },
      clearLog: () => { try { localStorage.removeItem('structs-kor.duty'); } catch { /* fine */ } paint(); },
    };
    const off = onOrders(paint);
    try { await reload(); } catch (e) { mount(root, errorCard(e)); }
    return () => { off(); setTiles([]); };
  },
};
export default screen;
