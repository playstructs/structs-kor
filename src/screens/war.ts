/* 작전 상황실 (war room): who to hit, who hit you, and what is burning right now.
 *
 *   표적      commanders worth raiding, scored (ore you could take, weak shields, guild priority,
 *            grudges) — never your own guild or anyone on the never-attack list
 *   원한·금지  grudges (raiders of your planet, added by hand or from incidents), priority guilds,
 *            and the never-attack hard veto
 *   사건      the combat story of your planet (attacks, raids) from planet activity
 *   습격 현황  active raids on the planets of the commanders in view
 *
 * Scoring is advice: nothing here signs. Launching goes through the galaxy's fleet order.
 * After structs-universe's War area (Targets, Lists, Incidents, Live Raids). */
import type { Screen } from '../router';
import { href } from '../router';
import { html, mount, n, micro, raw, toast, type Safe } from '../ui/dom';
import { needSession, errorCard, loading } from '../ui/gate';
import { guildApi, type PlayerRow, type ActivityRow, type RaidRow, type LeaderPlayer } from '../api/guild';
import { portraitHtml, seededPfp } from '../game/portrait';
import { activityLabel } from '../i18n/ko';
import { share } from '../social/share';
import { setTiles } from '../ui/shell';

type Tab = 'targets' | 'lists' | 'incidents' | 'raids';
interface Lists { grudges: string[]; vetoes: string[]; priority: string[]; minOre: number }
const KEY = 'structs-kor.war';
const loadLists = (): Lists => { try { return { grudges: [], vetoes: [], priority: [], minOre: 1, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { return { grudges: [], vetoes: [], priority: [], minOre: 1 }; } };
const saveLists = (l: Lists) => { try { localStorage.setItem(KEY, JSON.stringify(l)); } catch { /* fine */ } };

interface Target { p: PlayerRow; shield: number | null; raid: RaidRow | null; score: number; why: string[] }

const screen: Screen = {
  async render(root, params) {
    const pid = needSession(root, '작전 상황실');
    if (!pid) return;
    mount(root, loading('정찰 보고를 모으는 중…'));
    let me: PlayerRow | null = null, targets: Target[] = [], incidents: ActivityRow[] = [], tab: Tab = (params.get('tab') as Tab) || 'targets';
    const L = loadLists();
    const isCombat = (r: ActivityRow) => /attack|raid|health|destroy|fleet_arrive/.test(r.category);

    const scoreOf = (p: PlayerRow, shield: number | null): [number, string[]] => {
      const why: string[] = [];
      let s = Math.min(60, Number(p.ore) / 4);
      if (Number(p.ore) > 0) why.push(`광석 ${n(p.ore)}`);
      if (shield != null) { s += Math.max(0, 25 - shield / 4); if (shield < 40) why.push(`방어막 ${shield}`); }
      if (L.grudges.includes(p.id)) { s += 25; why.push('원한'); }
      if (L.priority.includes(p.guild_id)) { s += 15; why.push('우선 길드'); }
      return [Math.round(Math.min(100, s)), why];
    };
    const load = async () => {
      me = await guildApi.player(pid);
      const soft = <T,>(p: Promise<T>, d: T) => p.catch(() => d);
      const leaders = await soft(guildApi.leaderboard<LeaderPlayer>('player', 25), []);
      const ids = [...new Set([...leaders.map((l) => l.player_id), ...L.grudges])].filter((id) => id !== pid).slice(0, 25);
      const rows = (await Promise.all(ids.map((id) => soft(guildApi.player(id), null)))).filter((x): x is PlayerRow => !!x && !!x.planet_id);
      const extra = await Promise.all(rows.map(async (p) => [await soft(guildApi.shieldHealth(p.planet_id).then((r) => r?.health ?? null), null), await soft(guildApi.activeRaid(p.planet_id), null)] as const));
      targets = rows.map((p, i) => { const [shield, raid] = extra[i]; const [score, why] = scoreOf(p, shield); return { p, shield, raid, score, why }; }).sort((a, b) => b.score - a.score);
      incidents = me.planet_id ? (await soft(guildApi.activity(me.planet_id, 1, 60), [])).filter(isCombat) : [];
    };
    const eligible = (t: Target) => t.p.guild_id !== me?.guild_id && !L.vetoes.includes(t.p.id) && Number(t.p.ore) >= L.minOre;

    const targetsTab = (): Safe => {
      const list = targets.filter(eligible);
      return html`<section class="card flush game-panel"><div class="card-head" style="padding:16px"><h2>표적 보드</h2><span class="dim" style="font-size:13px">점수 0–100 · 광석 · 약한 방어막 · 원한 · 우선 길드</span>
        <label class="end chk">최소 광석 <input class="input mono" style="width:80px;min-height:32px" type="number" min="0" name="minOre" value="${L.minOre}" data-act="minOre" data-on="change"></label></div>
        <div class="scroll-x"><table class="t" style="min-width:760px"><thead><tr><th class="r">점수</th><th>사령관</th><th class="r">광석</th><th class="r">방어막</th><th>이유</th><th class="r"></th></tr></thead><tbody>
        ${list.length ? list.map((t) => html`<tr><td class="r"><span class="score ${t.score >= 60 ? 'hot' : t.score >= 30 ? 'warm' : ''}">${t.score}</span></td>
          <td><span style="display:inline-flex;align-items:center;gap:8px">${raw(portraitHtml(t.p.pfp || seededPfp(t.p.id), 28))}<span><a class="c-white" href="${href(`/o/${t.p.id}`)}"><b>${t.p.username || t.p.id}</b></a><br><span class="mono faint" style="font-size:11px">${t.p.id} · ${t.p.tag || t.p.guild_id} · ${t.p.planet_id}</span></span></span></td>
          <td class="r mono c-hwang">${n(t.p.ore)}</td><td class="r mono">${t.shield ?? '—'}</td><td>${t.why.join(' · ') || '—'}${t.raid ? html` <span class="chip jeok">습격받는 중</span>` : ''}</td>
          <td class="r"><span style="display:inline-flex;gap:4px"><a class="btn ghost sm" href="${href(`/o/${t.p.planet_id}`)}">관전</a><a class="btn ghost sm" href="${href(`/sim?vs=${t.p.id}`)}">시뮬</a><a class="btn danger sm" href="${href('/galaxy')}">출격</a>
            <button class="hud-btn" data-act="shareT" data-id="${t.p.id}" title="표적 공유" aria-label="표적 공유"><i class="si icon-link-out"></i></button><button class="hud-btn" data-act="veto" data-id="${t.p.id}" title="공격 금지에 추가" aria-label="공격 금지"><i class="si icon-blocked"></i></button></span></td></tr>`)
        : html`<tr><td colspan="6" class="empty">조건에 맞는 표적이 없습니다.</td></tr>`}
        </tbody></table></div>
        <p class="note" style="padding:0 16px 14px">같은 길드와 공격 금지 목록은 자동으로 제외됩니다. 점수는 참고용이며, 명령은 직접 내려야 합니다.</p></section>`;
    };
    const listBox = (title: string, key: 'grudges' | 'vetoes' | 'priority', hint: string, ph: string): Safe => html`<section class="card game-panel"><div class="card-head"><h2>${title}</h2><span class="end mono dim">${L[key].length}</span></div>
      <p class="note">${hint}</p>
      <div class="tagbox">${L[key].map((id) => html`<span class="tag"><a href="${href(key === 'priority' ? `/guild?id=${id}` : `/o/${id}`)}">${id}</a><button data-act="rm" data-k="${key}" data-id="${id}" aria-label="${id} 빼기">×</button></span>`)}${L[key].length ? '' : html`<span class="faint">비어 있음</span>`}</div>
      <form class="invite-form" data-act="add" data-k="${key}" data-on="submit"><input class="input mono" name="id" placeholder="${ph}"><button class="btn ghost sm">추가</button></form></section>`;
    const listsTab = (): Safe => html`<div class="guild-wrap">
      ${listBox('원한', 'grudges', '내 행성을 습격한 사령관. 표적 점수 +25. 사건 기록에서 바로 추가할 수 있습니다.', '1-…')}
      ${listBox('우선 길드', 'priority', '이 길드 사령관은 점수 +15.', '0-…')}
      ${listBox('공격 금지', 'vetoes', '절대 표적에 올리지 않습니다 (동맹, 약속, 신입 보호).', '1-…')}</div>`;
    const incidentsTab = (): Safe => html`<section class="card game-panel"><div class="card-head"><h2>내 행성 사건 기록</h2><span class="end mono dim">${me?.planet_id ?? ''}</span></div>
      ${incidents.length ? html`<ol class="newswire obj-log">${incidents.map((r) => { const who = typeof r.detail === 'object' ? String((r.detail as Record<string, unknown>).attacker ?? (r.detail as Record<string, unknown>).player_id ?? '') : (String(r.detail).match(/1-\d+/)?.[0] ?? ''); return html`<li class="hot"><span class="mono faint">${r.block_height ? '#' + n(r.block_height) : new Date(r.time).toLocaleString('ko-KR')}</span> <b>${activityLabel(r.category)}</b> ${typeof r.detail === 'string' ? r.detail : ''} ${who && /^1-\d+$/.test(who) ? html`<a href="${href(`/o/${who}`)}">${who}</a> <button class="linkish" data-act="grudge" data-id="${who}">원한에 추가</button>` : ''}</li>`; })}</ol>` : html`<p class="empty">최근 전투 기록이 없습니다. 평화롭네요.</p>`}</section>`;
    const raidsTab = (): Safe => {
      const live = targets.filter((t) => t.raid);
      return html`<section class="card game-panel"><h2>진행 중인 습격</h2>
        ${live.length ? html`<div class="obj-structs">${live.map((t) => html`<a class="obj-struct enemy" href="${href(`/o/${t.p.planet_id}`)}"><b>${t.p.username || t.p.id}의 행성 ${t.p.planet_id}</b><small class="mono">습격 함대 ${t.raid!.fleet_id}${t.raid!.fleet_owner ? ' · ' + t.raid!.fleet_owner : ''} · ${t.raid!.status}</small></a>`)}</div>` : html`<p class="empty">보이는 범위에 진행 중인 습격이 없습니다.</p>`}
        <p class="note">상위 사령관과 원한 목록의 행성만 확인합니다. 행성을 눌러 실시간으로 관전하세요.</p></section>`;
    };
    const view = (): Safe => html`
      <div class="card-head"><h1 style="font-size:28px">작전 상황실</h1><span class="label c-jeok">WAR ROOM</span><button class="btn ghost end" data-act="reload">다시 정찰</button></div>
      <div class="tabs" role="tablist">${([['targets', '표적'], ['lists', '원한 · 금지'], ['incidents', `사건 ${incidents.length || ''}`], ['raids', `습격 현황 ${targets.filter((t) => t.raid).length || ''}`]] as [Tab, string][]).map(([t, l]) => html`<button class="tab ${tab === t ? 'on' : ''}" role="tab" aria-selected="${tab === t}" data-act="tab" data-t="${t}">${l}</button>`)}</div>
      ${tab === 'targets' ? targetsTab() : tab === 'lists' ? listsTab() : tab === 'incidents' ? incidentsTab() : raidsTab()}`;
    const paint = () => {
      if (!root.isConnected) return;
      mount(root, view(), handlers);
      setTiles([{ label: '표적', value: n(targets.filter(eligible).length), tone: 'var(--jeok)' }, { label: '원한', value: n(L.grudges.length) }, { label: '내 광석', value: me ? n(me.ore) : '—', tone: 'var(--hwang)' }]);
    };
    const rescore = () => { for (const t of targets) [t.score, t.why] = scoreOf(t.p, t.shield); targets.sort((a, b) => b.score - a.score); };
    const handlers = {
      tab: (el: HTMLElement) => { tab = el.dataset.t as Tab; paint(); },
      reload: async () => { mount(root, loading('다시 정찰하는 중…')); await load().catch(() => null); paint(); },
      minOre: (el: HTMLElement) => { L.minOre = Math.max(0, Number((el as HTMLInputElement).value) || 0); saveLists(L); paint(); },
      veto: (el: HTMLElement) => { const id = el.dataset.id!; if (!L.vetoes.includes(id)) L.vetoes.push(id); saveLists(L); toast(`${id} 공격 금지`); paint(); },
      grudge: (el: HTMLElement) => { const id = el.dataset.id!; if (!L.grudges.includes(id)) L.grudges.push(id); saveLists(L); rescore(); toast(`${id} 원한 목록에 추가`); paint(); },
      rm: (el: HTMLElement) => { const k = el.dataset.k as keyof Omit<Lists, 'minOre'>; L[k] = L[k].filter((x) => x !== el.dataset.id); saveLists(L); rescore(); paint(); },
      add: (el: HTMLElement) => {
        const k = el.dataset.k as keyof Omit<Lists, 'minOre'>;
        let v = String(new FormData(el as HTMLFormElement).get('id') || '').trim();
        if (/^\d+$/.test(v)) v = (k === 'priority' ? '0-' : '1-') + v;
        if (!/^\d{1,2}-\d+$/.test(v)) { toast('ID를 입력하세요'); return; }
        if (!L[k].includes(v)) L[k].push(v);
        saveLists(L); rescore(); paint();
      },
      shareT: (el: HTMLElement) => {
        const t = targets.find((x) => x.p.id === el.dataset.id);
        if (t) share({ kind: 'situation', s: { t: 'raid', title: `표적: ${t.p.username || t.p.id} (점수 ${t.score})`, sub: '합동 습격 갈 사람?', lines: [['광석', n(t.p.ore)], ['방어막', t.shield == null ? '—' : String(t.shield)], ['행성', t.p.planet_id], ['길드', t.p.tag || t.p.guild_id], ['알파', `${micro(t.p.alpha, 0)} g`]], ids: [t.p.id, t.p.planet_id], go: `/o/${t.p.planet_id}`, tone: 'jeok', by: me?.username, at: Date.now() } });
      },
    };
    try { await load(); } catch (e) { mount(root, errorCard(e)); return; }
    paint();
    return () => setTiles([]);
  },
};
export default screen;
