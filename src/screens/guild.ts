/* 길드: who you fight beside, and running it.
 *
 *   개요       banner, figures (members, bank, power), share a recruiting card, open guild chat
 *   길드원     the roster: search and sort; card, message and pay anyone; officers kick and set ranks
 *   가입 신청  join requests to approve or deny, invites out (revoke), invites waiting for me
 *   길드 찾기  every guild in the directory: open its card, request to join
 *   관리       the owner's settings: name, endpoint, entry substation, join minimum, entry rank
 *
 * Every write is a chain message from the commander (MsgGuildMembership*, MsgGuildUpdate*,
 * MsgPlayerUpdateGuildRank); the chain decides who may. ?id=0-x shows another guild. */
import type { Screen } from '../router';
import { href, go } from '../router';
import { html, mount, n, micro, raw, toast, watts, type Safe } from '../ui/dom';
import { needSession, errorCard, loading } from '../ui/gate';
import { setTiles } from '../ui/shell';
import { guildApi, type GuildRow, type RosterRow, type BankRow, type DirectoryRow, type PlayerRow } from '../api/guild';
import { actions } from '../api/actions';
import { applications, mockResolve, type Application } from '../api/chain';
import { MOCK } from '../api/http';
import { wallet } from '../wallet/wallet';
import { portraitHtml, seededPfp } from '../game/portrait';
import { sfx } from '../game/sfx';
import { banner } from '../game/fx';
import { share } from '../social/share';
import { guildSituation } from '../social/situations';
import { matrix } from '../chat/matrix';
import { messageHtml } from '../social/share';
import { openTransfer } from '../social/transfer';
import { nameOf, onNames } from '../api/names';

type Tab = 'home' | 'members' | 'apps' | 'find' | 'admin';

const screen: Screen = {
  async render(root, params) {
    const pid = needSession(root, '길드');
    if (!pid) return;
    mount(root, loading('길드 불러오는 중…'));
    let me: PlayerRow | null = null, guild: GuildRow | null = null, roster: RosterRow[] = [], bank: BankRow[] = [], count = 0, power: Record<string, unknown> | null = null;
    let notice: { alias: string | null; items: { who: string; body: string; ts: number }[] } | null = null;
    let dir: DirectoryRow[] = [], apps: Application[] = [], myApps: Application[] = [];
    let tab: Tab = (params.get('tab') as Tab) || 'home', q = '', sort: 'alpha' | 'name' = 'alpha', busy = false;
    const viewing = () => params.get('id');
    const unlocked = () => wallet.state === 'unlocked';

    const load = async () => {
      me = await guildApi.player(pid);
      const gid = viewing() || me.guild_id;
      const soft = <T,>(p: Promise<T>, d: T) => p.catch(() => d);
      [guild, roster, bank, count, power, dir, apps, myApps] = await Promise.all([
        soft(guildApi.guild(gid), null), soft(guildApi.roster(gid), [] as RosterRow[]), soft(guildApi.bank(), [] as BankRow[]),
        soft(guildApi.memberCount(gid).then((c) => c.count), 0), soft(guildApi.guildPower(gid) as Promise<Record<string, unknown>>, null),
        soft(guildApi.directory(), [] as DirectoryRow[]), soft(applications({ guildId: gid }), [] as Application[]), soft(applications({ playerId: pid }), [] as Application[]),
      ]);
    };
    const mine = () => !!me && !!guild && me.guild_id === guild.id;
    const owner = () => !!me && !!guild && guild.owner === me.id;

    /* ── Pieces ── */
    const head = (): Safe => html`
      <div class="guild-hero">
        <div class="guild-crest big">${guild?.tag || '?'}</div>
        <div class="guild-hero-txt"><span class="label c-hwang">길드</span><h1>${guild?.name ?? '길드'}</h1>${guild?.description ? html`<p>${guild.description}</p>` : ''}</div>
        <div class="guild-hero-acts">
          ${mine() ? html`<a class="btn ghost" href="${href('/chat?room=%23sn-corp')}">길드 통신</a>` : html`<button class="btn gold" data-act="request" ${busy || !unlocked() ? 'disabled' : ''}>가입 신청</button>`}
          <button class="btn primary" data-act="shareGuild">모집 카드 공유</button>
          ${viewing() && !mine() ? html`<a class="btn ghost" href="${href('/guild')}">내 길드로</a>` : ''}
        </div>
      </div>
      <div class="tabs" role="tablist">${([['home', '개요'], ['members', `길드원 ${n(count || roster.length)}`], ['apps', `가입 신청${apps.length ? ' · ' + apps.length : ''}`], ['find', '길드 찾기'], ...(mine() ? [['admin', owner() ? '관리' : '관리 (권한 필요)']] : [])] as [Tab, string][]).map(([t, l]) => html`<button class="tab ${tab === t ? 'on' : ''}" role="tab" aria-selected="${tab === t}" data-act="tab" data-t="${t}">${l}</button>`)}</div>`;

    const home = (): Safe => {
      const b = bank.find((x) => x.guild_id === guild?.id);
      const cap = Number(power?.capacity ?? 0), load = Number(power?.load ?? 0);
      const top = [...roster].sort((a, z) => Number(z.alpha) - Number(a.alpha)).slice(0, 5);
      const rank = [...dir].sort((a, z) => Number(z.alpha) - Number(a.alpha)).findIndex((d) => d.guild_id === guild?.id);
      return html`<div class="guild-wrap">
        <section class="card game-panel"><h2>길드 현황</h2>
          <div class="stat-grid">
            <div class="stat"><small>길드원</small><strong class="mono">${n(count || roster.length)}</strong></div>
            <div class="stat"><small>알파 순위</small><strong class="mono c-hwang">${rank >= 0 ? `${rank + 1}위 / ${dir.length}` : '—'}</strong></div>
            <div class="stat"><small>길드 은행 교환 비율</small><strong class="mono" style="color:${b && Number(b.ratio) < 1 ? 'var(--jeok)' : 'var(--cheong)'}">${b ? n(b.ratio, 3) : '—'}</strong></div>
            <div class="stat"><small>길드 화폐 유통량</small><strong class="mono">${b ? micro(b.supply, 0) : '—'}</strong></div>
            <div class="stat"><small>주 리액터</small><strong class="mono"><a href="${href(`/o/${guild?.primary_reactor_id ?? ''}`)}">${guild?.primary_reactor_id || '—'}</a></strong></div>
            <div class="stat"><small>가입 변전소</small><strong class="mono"><a href="${href(`/o/${guild?.entry_substation_id ?? ''}`)}">${guild?.entry_substation_id || '—'}</a></strong></div>
            <div class="stat"><small>리액터 기본 몫</small><strong class="mono">${guild?.default_commission ? n(Number(guild.default_commission) * 100, 1) + '%' : '—'}</strong></div>
            <div class="stat"><small>가입 최소 주입</small><strong class="mono">${guild ? micro(guild.join_infusion_minimum, 1) + ' g' : '—'}</strong></div>
          </div>
          ${cap ? html`<div><small class="dim">길드 전력 ${watts(load)} / ${watts(cap)}</small><div class="meter"><i style="width:${Math.min(100, (load / cap) * 100)}%"></i></div></div>` : ''}
          <p class="note">길드장 <a href="${href(`/o/${guild?.owner ?? ''}`)}">${nameOf(guild?.owner)}</a>${guild?.website && /^https?:\/\//i.test(guild.website) ? html` · <a href="${guild.website}" target="_blank" rel="noopener noreferrer">웹사이트</a>` : ''}</p>
        </section>
        <section class="card game-panel"><div class="card-head"><h2>알파 상위 길드원</h2><button class="linkish end" data-act="tab" data-t="members">모두 보기</button></div>
          <ol class="standings">${top.map((m, i) => html`<li class="${m.id === pid ? 'me' : ''}"><span class="rk mono">${i + 1}</span>${raw(portraitHtml(m.pfp || seededPfp(m.id), 32))}<div><a href="${href(`/o/${m.id}`)}"><b>${m.username || m.id}</b></a><small class="mono">알파 ${micro(m.alpha_p ?? m.alpha, 1)} g</small></div>${m.id === pid ? html`<span class="chip cheong">나</span>` : ''}</li>`)}</ol>
          ${top.length ? '' : html`<p class="empty">길드원 정보가 없습니다.</p>`}
        </section>
        ${mine() ? html`<section class="card game-panel"><div class="card-head"><h2>길드 공지</h2><a class="btn ghost sm end" href="${href(`/chat?room=${encodeURIComponent(notice?.alias ?? '#sn-corp')}`)}">통신방</a></div>
          ${notice === null ? html`<p class="note">${matrix.possible ? '공지를 불러오는 중…' : '통신에 연결하면 길드 대화방의 고정 공지가 여기에 보입니다.'}</p>` : notice.items.length ? html`<ol class="newswire">${notice.items.map((x) => html`<li><b>${x.who}</b> ${raw(messageHtml(x.body))} <span class="mono faint">${new Date(x.ts).toLocaleDateString('ko-KR')}</span></li>`)}</ol>` : html`<p class="note">고정된 공지가 없습니다. 통신에서 메시지를 고정하면 여기에 보입니다.</p>`}</section>` : ''}
        ${myApps.length ? html`<section class="card warn game-panel"><h2>나에게 온 초대 · 내 신청</h2>${myApps.map((a) => html`<div class="app-row"><span>${a.joinType === 'invite' ? html`<b>${a.guildId}</b> 길드가 초대했습니다` : html`<b>${a.guildId}</b> 길드에 가입 신청 중`}</span><span class="app-acts">${a.joinType === 'invite'
          ? html`<button class="btn primary sm" data-act="inviteAccept" data-g="${a.guildId}" ${unlocked() ? '' : 'disabled'}>수락</button><button class="btn ghost sm" data-act="inviteDeny" data-g="${a.guildId}" ${unlocked() ? '' : 'disabled'}>거절</button>`
          : html`<button class="btn ghost sm" data-act="requestRevoke" data-g="${a.guildId}" ${unlocked() ? '' : 'disabled'}>신청 취소</button>`}</span></div>`)}</section>` : ''}
      </div>`;
    };

    const members = (): Safe => {
      const list = roster.filter((m) => !q || (m.username || '').toLowerCase().includes(q.toLowerCase()) || m.id.includes(q))
        .sort((a, z) => sort === 'name' ? (a.username || a.id).localeCompare(z.username || z.id, 'ko') : Number(z.alpha) - Number(a.alpha));
      return html`<section class="card game-panel"><div class="card-head"><h2>길드원</h2>
        <span class="end mkt-filters"><input class="input" name="q" value="${q}" placeholder="이름 또는 ID" data-act="q" aria-label="길드원 검색"><select class="input" data-act="sort" data-on="change" aria-label="정렬"><option value="alpha" ${sort === 'alpha' ? 'selected' : ''}>알파 순</option><option value="name" ${sort === 'name' ? 'selected' : ''}>이름 순</option></select></span></div>
        <div class="roster">${list.map((m, i) => html`<article class="roster-row ${m.id === pid ? 'me' : ''}">
          <span class="rk mono">${i + 1}</span>${raw(portraitHtml(m.pfp || seededPfp(m.id), 40))}
          <div class="roster-nm"><a href="${href(`/o/${m.id}`)}"><b>${m.username || m.id}</b></a><small class="mono">${m.id} · 알파 ${micro(m.alpha_p ?? m.alpha, 1)} g</small></div>
          <span class="roster-acts">${m.id === pid ? html`<span class="chip cheong">나</span>` : html`
            <button class="hud-btn" data-act="dm" data-id="${m.id}" title="메시지" aria-label="${m.username || m.id}에게 메시지"><i class="si icon-phone"></i></button>
            <button class="hud-btn" data-act="pay" data-id="${m.id}" title="알파 보내기" aria-label="${m.username || m.id}에게 알파 보내기"><i class="si icon-send-alpha"></i></button>
            ${mine() ? html`<select class="input rank-sel" data-act="rank" data-on="change" data-id="${m.id}" aria-label="계급" ${unlocked() ? '' : 'disabled'}><option value="">계급…</option>${[1, 2, 3, 4, 5].map((r) => html`<option value="${r}">${r === 1 ? '1 · 운영진' : r === 2 ? '2 · 장교' : r === 3 ? '3 · 정예' : r === 4 ? '4 · 대원' : '5 · 신입'}</option>`)}</select>
            <button class="btn outline-danger sm" data-act="kick" data-id="${m.id}" ${unlocked() ? '' : 'disabled'}>추방</button>` : ''}`}</span></article>`)}</div>
        ${list.length ? '' : html`<p class="empty">맞는 길드원이 없습니다.</p>`}
        <p class="note">계급 변경과 추방은 길드 권한이 있는 운영진만 할 수 있습니다.</p></section>`;
    };

    const appsTab = (): Safe => {
      const reqs = apps.filter((a) => a.joinType !== 'invite'), invs = apps.filter((a) => a.joinType === 'invite');
      return html`<div class="guild-wrap">
        <section class="card game-panel"><div class="card-head"><h2>가입 요청</h2><span class="end mono dim">${n(reqs.length)}</span></div>
          ${reqs.length ? reqs.map((a) => html`<div class="app-row">${raw(portraitHtml(seededPfp(a.playerId), 32))}<span><a href="${href(`/o/${a.playerId}`)}"><b>${a.playerId}</b></a> 님이 가입을 원합니다</span><span class="app-acts">
            <button class="btn primary sm" data-act="approve" data-id="${a.playerId}" ${unlocked() || MOCK ? '' : 'disabled'}>승인</button><button class="btn ghost sm" data-act="deny" data-id="${a.playerId}" ${unlocked() || MOCK ? '' : 'disabled'}>거절</button></span></div>`) : html`<p class="empty">대기 중인 요청이 없습니다.</p>`}
        </section>
        <section class="card game-panel"><div class="card-head"><h2>보낸 초대</h2><span class="end mono dim">${n(invs.length)}</span></div>
          ${invs.map((a) => html`<div class="app-row">${raw(portraitHtml(seededPfp(a.playerId), 32))}<span><a href="${href(`/o/${a.playerId}`)}"><b>${a.playerId}</b></a> 초대함${a.substationId ? ` · 변전소 ${a.substationId}` : ''}</span><span class="app-acts"><button class="btn ghost sm" data-act="revoke" data-id="${a.playerId}" ${unlocked() || MOCK ? '' : 'disabled'}>초대 취소</button></span></div>`)}
          <form class="invite-form" data-act="invite" data-on="submit"><input class="input mono" name="who" placeholder="플레이어 ID (1-…)" required><button class="btn gold" ${unlocked() || MOCK ? '' : 'disabled'}>초대 보내기</button></form>
          <p class="note">초대받은 사령관이 수락하면 바로 길드원이 됩니다. 가입 변전소 ${guild?.entry_substation_id || '—'}에 연결됩니다.</p>
        </section></div>`;
    };

    const find = (): Safe => html`<section class="card flush game-panel"><div class="card-head" style="padding:16px"><h2>길드 찾기</h2><span class="end dim" style="font-size:13px">알파 보유 순</span></div>
      <div class="scroll-x"><table class="t" style="min-width:560px"><thead><tr><th>#</th><th>길드</th><th class="r">길드원</th><th class="r">알파</th><th class="r"></th></tr></thead><tbody>
      ${[...dir].sort((a, z) => Number(z.alpha) - Number(a.alpha)).map((d, i) => html`<tr class="${d.guild_id === me?.guild_id ? 'me' : ''}"><td class="mono">${i + 1}</td><td><a class="c-white" href="${href(`/guild?id=${d.guild_id}`)}"><b>${d.name || d.guild_id}</b></a> <span class="mono faint">${d.guild_id}</span>${d.guild_id === me?.guild_id ? html` <span class="chip cheong">내 길드</span>` : ''}</td>
        <td class="r mono">${n(d.members)}</td><td class="r mono c-hwang">${micro(d.alpha, 0)} g</td>
        <td class="r"><div style="display:inline-flex;gap:4px"><a class="btn ghost sm" href="${href(`/o/${d.guild_id}`)}">카드</a>${d.guild_id !== me?.guild_id ? html`<button class="btn gold sm" data-act="requestTo" data-g="${d.guild_id}" ${unlocked() ? '' : 'disabled'}>가입 신청</button>` : ''}</div></td></tr>`)}
      ${dir.length ? '' : html`<tr><td colspan="5" class="empty">길드 목록을 불러오지 못했습니다.</td></tr>`}
      </tbody></table></div></section>`;

    const admin = (): Safe => html`<section class="card game-panel" style="max-width:860px"><h2>길드 관리</h2>
      ${owner() ? '' : html`<div class="notice">이 설정은 길드장(또는 권한을 받은 운영진)만 바꿀 수 있습니다.</div>`}
      <div class="admin-grid">
        <form data-act="setName" data-on="submit"><label class="field"><span>길드 이름</span><input class="input" name="v" value="${guild?.name ?? ''}" required></label><button class="btn ghost sm">이름 변경</button></form>
        <form data-act="setEndpoint" data-on="submit"><label class="field"><span>길드 서버 주소</span><input class="input" name="v" value="${guild?.endpoint ?? ''}" placeholder="https://…"></label><button class="btn ghost sm">주소 변경</button></form>
        <form data-act="setSub" data-on="submit"><label class="field"><span>가입 변전소</span><input class="input mono" name="v" value="${guild?.entry_substation_id ?? ''}" placeholder="4-…"></label><button class="btn ghost sm">변전소 변경</button></form>
        <form data-act="setMin" data-on="submit"><label class="field"><span>가입 최소 주입 (g)</span><input class="input mono" name="v" type="number" step="any" min="0" value="${guild ? Number(guild.join_infusion_minimum) / 1e6 : 0}"></label><button class="btn ghost sm">최소값 변경</button></form>
        <form data-act="setEntry" data-on="submit"><label class="field"><span>신입 기본 계급 (1–5)</span><input class="input mono" name="v" type="number" min="1" max="99" value="5"></label><button class="btn ghost sm">기본 계급 변경</button></form>
      </div>
      <p class="note">변경 사항은 바로 적용됩니다.</p></section>`;

    const view = (): Safe => html`${head()}${tab === 'home' ? home() : tab === 'members' ? members() : tab === 'apps' ? appsTab() : tab === 'find' ? find() : admin()}`;
    const paint = () => {
      if (!root.isConnected) return;
      mount(root, view(), handlers);
      const b = bank.find((x) => x.guild_id === guild?.id);
      setTiles([{ label: '길드', value: guild?.tag ? `[${guild.tag}]` : guild?.id ?? '—', tone: 'var(--hwang)' }, { label: '길드원', value: n(count || roster.length) }, { label: '교환 비율', value: b ? n(b.ratio, 3) : '—', tone: 'var(--cheong-hi)' }]);
    };
    const sign = (p: Promise<string>, done = '보냈습니다', after?: () => void) => {
      busy = true; paint();
      p.then(() => { sfx.play('confirm'); toast(done); after?.(); setTimeout(() => void load().then(paint).catch(() => null), 6000); })
        .catch((e) => toast('실패: ' + (e as Error).message, 5000)).finally(() => { busy = false; paint(); });
    };
    /** Under the mock nothing is signed; the fixture just moves so the screen can be exercised. */
    const mockOr = (playerId: string, p: () => Promise<string>, done: string) => { if (MOCK) { mockResolve(playerId); apps = apps.filter((a) => a.playerId !== playerId); toast(`${done} (모의)`); paint(); return; } sign(p(), done); };
    const gid = () => guild?.id ?? '';
    const handlers = {
      tab: (el: HTMLElement) => { tab = el.dataset.t as Tab; const u = new URLSearchParams(location.search); u.set('tab', tab); history.replaceState(null, '', href('/guild?' + u.toString())); paint(); },
      q: (el: HTMLElement) => { q = (el as HTMLInputElement).value; paint(); },
      sort: (el: HTMLElement) => { sort = (el as HTMLSelectElement).value as typeof sort; paint(); },
      dm: (el: HTMLElement) => go(`/chat?dm=${el.dataset.id}`),
      pay: (el: HTMLElement) => void openTransfer({ to: el.dataset.id }),
      shareGuild: () => { if (guild) share({ kind: 'situation', s: guildSituation({ id: guild.id, name: guild.name, tag: guild.tag, members: count || roster.length, ratio: bank.find((b) => b.guild_id === guild!.id)?.ratio as number | undefined ?? null, note: guild.description, by: me?.username }) }); },
      request: () => sign(actions.guildRequest(gid(), pid, guild?.entry_substation_id ?? ''), '가입 신청을 보냈습니다'),
      requestTo: (el: HTMLElement) => { sign(actions.guildRequest(el.dataset.g!, pid), '가입 신청을 보냈습니다'); },
      requestRevoke: (el: HTMLElement) => sign(actions.guildRequestRevoke(el.dataset.g!, pid), '신청을 취소했습니다'),
      inviteAccept: (el: HTMLElement) => sign(actions.guildInviteApprove(el.dataset.g!, pid), '초대를 수락했습니다', () => banner({ kicker: '길드 가입', title: el.dataset.g!, sub: '새 길드에 합류했습니다', tone: 'gold' })),
      inviteDeny: (el: HTMLElement) => sign(actions.guildInviteDeny(el.dataset.g!, pid), '초대를 거절했습니다'),
      approve: (el: HTMLElement) => mockOr(el.dataset.id!, () => actions.guildRequestApprove(gid(), el.dataset.id!, guild?.entry_substation_id ?? ''), '승인했습니다'),
      deny: (el: HTMLElement) => mockOr(el.dataset.id!, () => actions.guildRequestDeny(gid(), el.dataset.id!), '거절했습니다'),
      revoke: (el: HTMLElement) => mockOr(el.dataset.id!, () => actions.guildInviteRevoke(gid(), el.dataset.id!), '초대를 취소했습니다'),
      invite: (el: HTMLElement) => {
        const raw0 = String(new FormData(el as HTMLFormElement).get('who') || '').trim();
        const who = /^\d+$/.test(raw0) ? '1-' + raw0 : raw0;
        if (!/^1-\d+$/.test(who)) { toast('플레이어 ID를 입력하세요 (예: 1-42)'); return; }
        if (MOCK) { apps = [...apps, { guildId: gid(), playerId: who, joinType: 'invite', status: 'proposed', proposer: pid, substationId: guild?.entry_substation_id ?? '' }]; toast('초대했습니다 (모의)'); paint(); return; }
        sign(actions.guildInvite(gid(), who, guild?.entry_substation_id ?? ''), '초대를 보냈습니다');
      },
      kick: (el: HTMLElement) => { sign(actions.guildKick(gid(), el.dataset.id!), '추방했습니다'); },
      rank: (el: HTMLElement) => { const r = Number((el as HTMLSelectElement).value); if (r) sign(actions.guildRank(gid(), el.dataset.id!, r), `계급 ${r}로 변경했습니다`); },
      setName: (el: HTMLElement) => sign(actions.guildName(gid(), String(new FormData(el as HTMLFormElement).get('v'))), '이름을 바꿨습니다'),
      setEndpoint: (el: HTMLElement) => sign(actions.guildEndpoint(gid(), String(new FormData(el as HTMLFormElement).get('v'))), '주소를 바꿨습니다'),
      setSub: (el: HTMLElement) => sign(actions.guildEntrySubstation(gid(), String(new FormData(el as HTMLFormElement).get('v'))), '가입 변전소를 바꿨습니다'),
      setMin: (el: HTMLElement) => sign(actions.guildJoinMinimum(gid(), Math.round(Number(new FormData(el as HTMLFormElement).get('v')) * 1e6)), '최소 주입을 바꿨습니다'),
      setEntry: (el: HTMLElement) => sign(actions.guildEntryRank(gid(), Number(new FormData(el as HTMLFormElement).get('v'))), '기본 계급을 바꿨습니다'),
    };
    try { await load(); } catch (e) { mount(root, errorCard(e)); return () => undefined; }
    if (params.get('join') === '1' && !mine()) tab = 'home';
    paint();
    // The guild room's pinned messages are its notice board.
    if (mine() && matrix.possible) void matrix.ensure().then(async () => {
      const r = matrix.guildRoom(guild!.id);
      if (!r) { notice = { alias: null, items: [] }; paint(); return; }
      const items = (await Promise.all(r.pinned.slice(0, 5).map((id) => matrix.event(r.id, id)))).filter((x): x is { sender: string; body: string; ts: number } => !!x).map((x) => ({ who: matrix.displayName(r.id, x.sender), body: x.body, ts: x.ts }));
      notice = { alias: r.alias, items }; paint();
    }).catch(() => { notice = { alias: null, items: [] }; paint(); });
    const offNames = onNames(() => { if (root.isConnected) paint(); });
    return () => { offNames(); setTiles([]); };
  },
};
export default screen;
