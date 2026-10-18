/* 통신: guild chat over Matrix, signed in through the guild (POST /api/auth/matrix).
 *
 *   rail      고정 · 초대 · 다이렉트 · 로컬 넷 (my guild's homeserver) · 갤럭시 넷, a filter, join, channel finder
 *   room      open tabs, header (topic, pins, search, people), the timeline, typing and "seen by", composer
 *   side      people in the room (DM, pay, card), search results, or pinned messages
 *
 * Every object id in a message becomes a chip and (up to three) a live card under it; shared
 * situations (/s/…) unfurl as situation cards. Replies, edits, two-click delete, game-icon reactions,
 * pins, slash commands, Tab completion and Up/Down history. A message that looks like a recovery
 * phrase is stopped before it is sent, with Cancel as the default.
 *
 * The screen paints in regions so typing, scroll position and focus survive every sync. */
import type { Screen } from '../router';
import { href, go } from '../router';
import { ApiError } from '../api/http';
import { html, mount, raw, esc, toast, type Safe } from '../ui/dom';
import { needSession } from '../ui/gate';
import { matrix, localpart, type Room, type Message } from '../chat/matrix';
import { parse, playerArg, complete, COMMANDS, REACTIONS, reactionOf, type Completion } from '../chat/commands';
import { looksLikePhrase } from '../wallet/keys';
import { guildApi } from '../api/guild';
import { portraitHtml, seededPfp } from '../game/portrait';
import { refSlot, idsIn, resolveRef } from '../social/refs';
import { share, situationsIn, situationHtml, messageHtml, messageIds } from '../social/share';
import { openTransfer } from '../social/transfer';
import { openRent } from '../social/actions';
import { baseSituation } from '../social/situations';
import { ask } from '../ui/sheet';
import { sfx } from '../game/sfx';
import { webRoot } from '../core/desktop';
import { hasChallenge, challengeSlot, hydrateChallenges } from '../social/challenge';

const PINNED = ['#sn-corp', '#help', '#infrastructure'];
const GUESS = ['#sn-corp', '#help', '#infrastructure', '#raid', '#trade', '#market', '#recruit', '#korea', '#kr', '#general', '#announcements'];
const TABS_KEY = 'structs-kor.chat.tabs', MAX_TABS = 6;
const loadTabs = (): string[] => { try { return JSON.parse(localStorage.getItem(TABS_KEY) || '[]'); } catch { return []; } };
const saveTabs = (t: string[]) => { try { localStorage.setItem(TABS_KEY, JSON.stringify(t.slice(0, MAX_TABS))); } catch { /* fine */ } };

const time = (ts: number) => new Date(ts).toLocaleTimeString('ko-KR', { hour: 'numeric', minute: '2-digit' });
const day = (ts: number) => new Date(ts).toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'long' });

const screen: Screen = {
  async render(root, params) {
    const pid = needSession(root, '통신');
    if (!pid) return;
    if (!matrix.possible) {
      mount(root, html`<section class="card accent" style="max-width:560px;margin:40px auto"><h1 style="font-size:28px">지갑 잠금 해제 필요</h1><p class="note">채팅은 지갑 서명으로 로그인합니다. 비밀번호는 필요 없습니다.</p><a class="btn primary" href="${href('/login')}">잠금 해제</a></section>`);
      return;
    }
    let active: string | null = null, err = '', filter = '';
    let tabs = loadTabs();
    let side: 'people' | 'search' | 'pins' | 'find' | null = innerWidth > 1280 ? 'people' : null;
    let replyTo: Message | null = null, editing: Message | null = null, guard = false, confirmDelete: string | null = null;
    let picker: string | null = null; // message id with the reaction picker open
    let results: { roomId: string; id: string; sender: string; body: string; ts: number }[] = [], searchTerm = '', searchAll = false;
    let found: { alias: string; id: string | null }[] = [];
    const drafts = new Map<string, string>();
    const sent: string[] = []; let histAt = -1;
    let comp: (Completion & { i: number }) | null = null;
    const pfps = new Map<string, string>();
    let stick = true, backfilling = false, shown = 150;

    root.innerHTML = `<div class="chatx">
      <nav class="comms-rail" aria-label="대화방 목록"></nav>
      <section class="comms-room" aria-label="대화">
        <div class="comms-tabs" aria-label="열린 대화"></div>
        <header class="comms-head"></header>
        <div class="comms-pins"></div>
        <div class="comms-tl" tabindex="0" aria-live="polite"></div>
        <div class="comms-typing"></div>
        <div class="comms-compose">
          <div class="comms-reply"></div>
          <form class="comms-form"><label class="sr" for="msg">메시지 입력</label>
            <button type="button" class="hud-btn comms-plus" data-plus aria-label="공유하기" title="객체·상황 공유"><i class="si icon-add"></i></button>
            <textarea id="msg" class="input" rows="1" autocomplete="off" placeholder="메시지 · /help 명령어 · 2-14 처럼 ID를 쓰면 카드가 됩니다"></textarea>
            <button class="btn primary comms-send" type="submit" data-act="send">전송</button></form>
          <div class="comms-comp" role="listbox"></div>
        </div>
      </section>
      <aside class="comms-side" aria-label="참여자 · 검색"></aside>
    </div>`;
    const $ = <T extends HTMLElement>(s: string) => root.querySelector<T>(s)!;
    const railEl = $('.comms-rail'), tabsEl = $('.comms-tabs'), headEl = $('.comms-head'), pinsEl = $('.comms-pins'), tl = $('.comms-tl'), typingEl = $('.comms-typing');
    const replyEl = $('.comms-reply'), compEl = $('.comms-comp'), sideEl = $('.comms-side');
    const input = $<HTMLTextAreaElement>('#msg'), form = $<HTMLFormElement>('.comms-form');
    const base = href('');

    /* ── Data helpers ── */
    const sorted = () => [...matrix.rooms.values()].sort((a, b) => (b.events.at(-1)?.ts ?? 0) - (a.events.at(-1)?.ts ?? 0));
    const isPinnedRoom = (r: Room) => !!r.alias && PINNED.some((p) => r.alias!.startsWith(p + ':'));
    const room = () => (active ? matrix.rooms.get(active) ?? null : null);
    const people = () => { const r = room(); return r ? [...r.memberList.values()].filter((m) => m.membership === 'join').map((m) => ({ id: localpart(m.id), name: m.name, uid: m.id })) : []; };
    const allIds = () => { const s = new Set<string>(); for (const m of room()?.events ?? []) for (const id of idsIn(m.body, 10)) s.add(id); return [...s]; };
    const face = (uid: string, size = 34) => raw(portraitHtml(pfps.get(localpart(uid)) || seededPfp(localpart(uid)), size));
    const mentionsMe = (m: Message) => !m.mine && (m.body.includes('@' + localpart(matrix.me)) || m.body.includes(localpart(matrix.me)));
    void guildApi.player(pid).then((p) => guildApi.roster(p.guild_id)).then((r) => { for (const x of r) if (x.pfp) pfps.set(x.id, x.pfp); paintRoom(); paintSide(); }).catch(() => null);

    const open = (id: string | null) => {
      if (active) drafts.set(active, input.value);
      active = id; replyTo = null; editing = null; picker = null; confirmDelete = null; stick = true; shown = 150; lastHeard = "";
      if (id) { tabs = [id, ...tabs.filter((t) => t !== id)].slice(0, MAX_TABS); saveTabs(tabs); }
      const r = room();
      if (r) { r.unread = 0; r.highlight = 0; const last = r.events.filter((m) => !m.pending).at(-1); if (last) void matrix.read(r.id, last.id); }
      input.value = (id && drafts.get(id)) || '';
      autosize();
      paintAll();
      if (side === 'people' && r) void matrix.members(r.id);
      input.focus();
    };

    /* ── Rail ── */
    const railItem = (r: Room) => html`<button class="comms-item ${r.id === active ? 'on' : ''} ${r.highlight ? 'hi' : ''}" data-act="open" data-id="${r.id}">
      <span class="comms-ico">${r.direct ? face([...r.memberList.keys()].find((u) => u !== matrix.me) ?? r.id, 24) : raw(`<span class="hash">#</span>`)}</span>
      <span class="comms-nm">${r.name.replace(/^#/, '').split(':')[0]}</span>
      ${matrix.muted.has(r.id) ? html`<i class="si icon-disabled faint" title="알림 꺼짐"></i>` : ''}${r.unread ? html`<span class="comms-n ${r.highlight && !matrix.muted.has(r.id) ? 'hi' : ''}">${r.unread > 99 ? '99+' : r.unread}</span>` : ''}</button>`;
    const paintRail = () => {
      const all = sorted().filter((r) => !filter || r.name.toLowerCase().includes(filter.toLowerCase()) || (r.alias ?? '').includes(filter));
      const pinned = all.filter(isPinnedRoom), rest = all.filter((r) => !isPinnedRoom(r));
      const sec = (t: string, list: Room[]) => list.length ? html`<div class="comms-sec">${t}</div>${list.map(railItem)}` : '';
      mount(railEl, html`
        <div class="comms-me"><span class="dot ${matrix.state}"></span><span class="mono">${matrix.grant ? localpart(matrix.me) : err ? '연결 안 됨' : '연결 중…'}</span><span class="end faint">${matrix.state === 'stalled' ? '재연결 중' : matrix.state === 'live' ? '실시간' : ''}</span></div>
        <input class="input comms-filter" placeholder="대화방 찾기 (Ctrl+K)" value="${filter}" data-act="filter" aria-label="대화방 필터">
        ${matrix.invites.size ? html`<div class="comms-sec">초대</div>${[...matrix.invites.values()].map((i) => html`<div class="comms-invite"><b>${i.direct ? '@' : '#'}${i.name}</b><small>${localpart(i.inviter)} 님의 초대</small><span><button class="btn primary sm" data-act="accept" data-id="${i.id}">수락</button><button class="btn ghost sm" data-act="decline" data-id="${i.id}">거절</button></span></div>`)}` : ''}
        ${sec('고정', pinned)}${sec('다이렉트 메시지', rest.filter((r) => r.direct))}${sec('로컬 넷 · 내 길드', rest.filter((r) => !r.direct && r.local))}${sec('갤럭시 넷 · 타 서버', rest.filter((r) => !r.direct && !r.local))}
        ${!all.length ? html`<p class="faint comms-empty">${matrix.rooms.size ? '맞는 대화방이 없습니다.' : err || '대화방을 불러오는 중…'}</p>` : ''}
        <form class="comms-join" data-act="join" data-on="submit"><input class="input" name="alias" placeholder="#대화방 참여" aria-label="대화방 참여"><button class="btn ghost sm">참여</button></form>
        <button class="btn ghost sm comms-findbtn" data-act="find">채널 찾기</button>`, railHandlers);
    };
    const railHandlers = {
      open: (el: HTMLElement) => open(el.dataset.id!),
      filter: (el: HTMLElement) => { filter = (el as HTMLInputElement).value; const pos = (el as HTMLInputElement).selectionStart; paintRail(); const f = railEl.querySelector<HTMLInputElement>('.comms-filter')!; f.focus(); f.setSelectionRange(pos, pos); },
      join: (el: HTMLElement) => { const a = String(new FormData(el as HTMLFormElement).get('alias') || '').trim(); if (a) void joinAlias(a); },
      accept: (el: HTMLElement) => { void matrix.join(el.dataset.id!).then((r) => { toast('참여했습니다.'); open(r.room_id); }).catch((e) => toast('참여 실패: ' + (e as Error).message, 4000)); },
      decline: (el: HTMLElement) => { void matrix.decline(el.dataset.id!).then(paintRail); },
      find: () => { side = 'find'; void discover(); paintSide(); },
    };
    const joinAlias = async (a: string) => {
      const alias = a.startsWith('!') || a.includes(':') ? a : `${a.startsWith('#') ? a : '#' + a}:${matrix.server}`;
      try { const r = await matrix.join(alias); toast('참여했습니다.'); sfx.play('confirm'); setTimeout(() => open(r.room_id), 300); } catch (e) { toast('참여 실패: ' + (e as Error).message, 4000); }
    };
    const discover = async () => {
      const me = await guildApi.player(pid).catch(() => null);
      const guesses = [...GUESS, ...(me?.planet_id ? [`#planet-${me.planet_id}`] : []), ...(me?.guild_id ? [`#guild-${me.guild_id}`] : [])];
      found = await Promise.all(guesses.map(async (g) => { const alias = `${g}:${matrix.server}`; return { alias, id: await matrix.probe(alias) }; }));
      paintSide();
    };

    /* ── Tabs + header ── */
    const paintHead = () => {
      const r = room();
      mount(tabsEl, html`${tabs.map((id) => matrix.rooms.get(id)).filter(Boolean).map((t) => html`<span class="comms-tab ${t!.id === active ? 'on' : ''}"><button data-act="open" data-id="${t!.id}" aria-current="${t!.id === active ? 'page' : 'false'}">${t!.direct ? '@' : '#'}${t!.name.replace(/^#/, '').split(':')[0]}${t!.unread ? html` <b>${t!.unread}</b>` : ''}</button><button class="x" data-act="close" data-id="${t!.id}" aria-label="탭 닫기">×</button></span>`)}`, {
        open: (el) => open(el.dataset.id!),
        close: (el) => { tabs = tabs.filter((t) => t !== el.dataset.id); saveTabs(tabs); if (active === el.dataset.id) open(tabs[0] ?? null); else paintHead(); },
      });
      if (!r) { headEl.innerHTML = ''; pinsEl.innerHTML = ''; return; }
      mount(headEl, html`<button class="hud-btn comms-rooms" data-act="rooms" aria-label="대화방 목록"><i class="si icon-chevron-left"></i></button><div class="comms-title"><h1>${r.direct ? '@' : '#'}${r.name.replace(/^#/, '').split(':')[0]}</h1><small>${r.topic || (r.direct ? '다이렉트 메시지' : r.local ? '로컬 넷' : '갤럭시 넷')} · ${r.members || r.memberList.size}명</small></div>
        <div class="comms-tools">
          ${r.pinned.length ? html`<button class="hud-btn ${side === 'pins' ? 'on' : ''}" data-act="side" data-s="pins" title="고정 메시지" aria-label="고정 메시지 ${r.pinned.length}"><i class="si icon-key"></i><span class="tool-n">${r.pinned.length}</span></button>` : ''}
          <button class="hud-btn ${side === 'search' ? 'on' : ''}" data-act="side" data-s="search" title="검색 (Ctrl+F)" aria-label="검색"><i class="si icon-detected"></i></button>
          <button class="hud-btn ${side === 'people' ? 'on' : ''}" data-act="side" data-s="people" title="참여자" aria-label="참여자"><i class="si icon-member"></i></button>
          <button class="hud-btn ${matrix.muted.has(r.id) ? 'on' : ''}" data-act="mute" title="${matrix.muted.has(r.id) ? '알림 켜기' : '알림 끄기 (이 기기)'}" aria-label="알림 끄기" aria-pressed="${matrix.muted.has(r.id)}"><i class="si ${matrix.muted.has(r.id) ? 'icon-disabled' : 'icon-signal-jam'}"></i></button>
          <button class="hud-btn" data-act="shareroom" title="이 방 링크 복사" aria-label="방 링크"><i class="si icon-link-out"></i></button>
          <button class="hud-btn" data-act="leave" title="대화방 나가기" aria-label="대화방 나가기"><i class="si icon-close"></i></button>
        </div>`, {
        side: (el) => { const s = el.dataset.s as typeof side; side = side === s ? null : s; if (side === 'people') void matrix.members(r.id); paintHead(); paintSide(); },
        mute: () => { toast(matrix.toggleMute(r.id) ? '이 대화방 알림을 껐습니다.' : '알림을 다시 켰습니다.'); paintHead(); paintRail(); },
        leave: () => void command('leave', [], ''),
        rooms: () => { if (active) drafts.set(active, input.value); active = null; paintAll(); },
        shareroom: () => { void navigator.clipboard?.writeText(webRoot() + (`/chat?room=${encodeURIComponent(r.alias ?? r.id)}`)).then(() => toast('대화방 링크를 복사했습니다.')); },
      });
      const top = r.pinned[0] ? r.events.find((m) => m.id === r.pinned[0]) : null;
      pinsEl.innerHTML = top ? `<button class="comms-pinbar" data-pinjump="${esc(top.id)}"><i class="si icon-key"></i><b>${esc(matrix.displayName(r.id, top.sender))}</b> ${esc(top.body.slice(0, 160))}</button>` : '';
    };

    /* ── Timeline ── */
    const reactionChip = (m: Message) => m.reactions.length || picker === m.id ? html`<div class="comms-rx">${m.reactions.map((x) => { const k = reactionOf(x.key); return html`<button class="rx ${x.mine ? 'mine' : ''}" data-act="react" data-id="${m.id}" data-k="${x.key}" title="${x.senders.map((s) => matrix.displayName(active, s)).join(', ')}">${k?.icon ? raw(`<i class="si ${k.icon}"></i>`) : x.key.startsWith(':') ? x.key.slice(1, -1) : x.key}<b>${x.senders.length}</b></button>`; })}
      ${picker === m.id ? html`<span class="rx-pick">${REACTIONS.map((k) => html`<button class="rx" data-act="react" data-id="${m.id}" data-k="${k.key}" title="${k.label}">${k.icon ? raw(`<i class="si ${k.icon}"></i>`) : k.key}</button>`)}</span>` : ''}</div>` : '';
    const line = (r: Room, m: Message, grouped: boolean): Safe => {
      if (m.redacted) return html`<div class="cm redacted ${grouped ? 'g' : ''}"><span class="cm-face"></span><div class="cm-body"><p class="faint">삭제된 메시지</p></div></div>`;
      const reply = m.replyTo ? r.events.find((x) => x.id === m.replyTo) : null;
      const chal = hasChallenge(m.body), ids = chal ? [] : messageIds(m.body), sits = situationsIn(m.body);
      return html`<div class="cm ${m.mine ? 'mine' : ''} ${grouped ? 'g' : ''} ${mentionsMe(m) ? 'hi' : ''} ${m.pending ?? ''}" data-mid="${m.id}">
        <span class="cm-face">${grouped ? '' : face(m.sender)}</span>
        <div class="cm-body">
          ${grouped ? '' : html`<div class="cm-meta"><a class="cm-who" href="${href(`/o/${localpart(m.sender)}`)}">${matrix.displayName(r.id, m.sender)}</a><span class="mono faint">${localpart(m.sender)}</span><time>${time(m.ts)}</time></div>`}
          ${reply ? html`<button class="cm-quote" data-act="jump" data-id="${reply.id}"><b>${matrix.displayName(r.id, reply.sender)}</b> ${reply.redacted ? '삭제된 메시지' : reply.body.slice(0, 90)}</button>` : ''}
          ${m.image ? html`<button class="cm-img" data-mxc="${m.image.mxc}" style="aspect-ratio:${m.image.w && m.image.h ? `${m.image.w} / ${m.image.h}` : '4 / 3'}" aria-label="이미지 ${m.body}"><span class="faint">이미지 불러오는 중…</span></button>` : ''}
          ${m.image && /^[^\s]+\.(png|jpe?g|gif|webp)$/i.test(m.body) ? '' : html`<p class="cm-text ${m.emote ? 'emote' : ''}">${m.emote ? html`<b>* ${matrix.displayName(r.id, m.sender)}</b> ` : ''}${raw(messageHtml(m.body, base))}${m.edited ? html` <small class="faint">(수정됨)</small>` : ''}</p>`}
          ${sits.length || ids.length || chal ? html`<div class="cm-cards">${chal ? raw(challengeSlot(m.body, base, { id: localpart(m.sender), mine: m.mine })) : ''}${sits.map((s) => raw(situationHtml(s, base)))}${ids.map((id) => raw(refSlot(id, { compact: true, base, me: pid })))}</div>` : ''}
          ${reactionChip(m)}
          ${m.pending === 'failed' ? html`<span class="cm-fail">전송 실패 · <button class="linkish" data-act="retry" data-id="${m.id}">다시 보내기</button></span>` : m.pending === 'sending' ? html`<span class="cm-sending faint">보내는 중…</span>` : ''}
        </div>
        ${m.pending ? '' : html`<div class="cm-tools" role="toolbar" aria-label="메시지 작업">
          <button data-act="pick" data-id="${m.id}" title="반응" aria-label="반응"><i class="si icon-okay"></i></button>
          <button data-act="reply" data-id="${m.id}" title="답장" aria-label="답장"><i class="si icon-arrow" style="transform:scaleX(-1)"></i></button>
          <button data-act="pin" data-id="${m.id}" title="${r.pinned.includes(m.id) ? '고정 해제' : '고정'}" aria-label="고정"><i class="si icon-key"></i></button>
          ${m.mine ? html`<button data-act="edit" data-id="${m.id}" title="수정" aria-label="수정"><i class="si icon-edit"></i></button>
          <button data-act="del" data-id="${m.id}" class="${confirmDelete === m.id ? 'danger' : ''}" title="${confirmDelete === m.id ? '한 번 더 누르면 삭제' : '삭제'}" aria-label="삭제">${confirmDelete === m.id ? '삭제?' : raw('<i class="si icon-close"></i>')}</button>` : ''}
        </div>`}
      </div>`;
    };
    const paintRoom = () => {
      if (!root.isConnected) return;
      paintHead();
      const r = room();
      const atBottom = tl.scrollHeight - tl.scrollTop - tl.clientHeight < 40;
      const prevH = tl.scrollHeight, prevTop = tl.scrollTop;
      if (!r) { mount(tl, html`<div class="empty comms-blank">${err || (matrix.rooms.size ? html`<h2>통신</h2><p>왼쪽에서 대화방을 고르세요. <kbd>Ctrl</kbd>+<kbd>K</kbd>로 빠르게 찾을 수 있습니다.</p>` : '대화방을 불러오는 중…')}</div>`); typingEl.textContent = ''; return; }
      // Only a window of the newest messages is drawn; scrolling up widens it before asking the server.
      const evs = r.events.slice(-shown);
      const hiddenOlder = r.events.length > evs.length;
      const lastMine = [...evs].reverse().find((m) => m.mine && !m.pending);
      const seen = lastMine ? Object.entries(r.readUpTo).filter(([u, e]) => u !== matrix.me && e === lastMine.id).map(([u]) => matrix.displayName(r.id, u)) : [];
      mount(tl, html`
        ${hiddenOlder ? html`<button class="btn ghost sm comms-more" data-act="more">이전 메시지 ${r.events.length - evs.length}개 더 보기</button>` : r.noMoreHistory ? html`<div class="comms-start">${r.name.replace(/^#/, '').split(':')[0]}의 처음입니다.</div>` : r.prevBatch ? html`<button class="btn ghost sm comms-more" data-act="more">이전 메시지 불러오기</button>` : ''}
        ${evs.length ? evs.map((m, i) => {
          const prev = evs[i - 1];
          const newDay = !prev || new Date(prev.ts).toDateString() !== new Date(m.ts).toDateString();
          const grouped = !newDay && !!prev && prev.sender === m.sender && m.ts - prev.ts < 5 * 60_000 && !m.replyTo && !prev.redacted;
          return html`${newDay ? html`<div class="comms-day"><span>${day(m.ts)}</span></div>` : ''}${line(r, m, grouped)}`;
        }) : html`<p class="empty">아직 메시지가 없습니다. 첫 메시지를 보내보세요.</p>`}
        ${seen.length ? html`<div class="comms-seen faint">읽음 · ${seen.slice(0, 4).join(', ')}${seen.length > 4 ? ` 외 ${seen.length - 4}명` : ''}</div>` : ''}`, tlHandlers);
      void hydrateChallenges(tl);
      for (const b of tl.querySelectorAll<HTMLElement>('.cm-img[data-mxc]:not([data-done])')) {
        b.dataset.done = '1';
        void matrix.thumbnail(b.dataset.mxc!).then((u) => { b.innerHTML = u ? `<img src="${u}" alt="">` : '<span class="faint">이미지를 불러오지 못했습니다</span>'; });
      }
      if (stick || atBottom) tl.scrollTop = tl.scrollHeight;
      else if (backfilling) tl.scrollTop = prevTop + (tl.scrollHeight - prevH);
      else tl.scrollTop = prevTop;
      typingEl.textContent = r.typing.length ? `${r.typing.map((u) => matrix.displayName(r.id, u)).slice(0, 3).join(', ')} 님이 입력 중…` : '';
    };
    const findMsg = (id: string) => room()?.events.find((m) => m.id === id) ?? null;
    const tlHandlers = {
      more: () => void loadOlder(),
      react: (el: HTMLElement) => { const r = room(), m = findMsg(el.dataset.id!); if (r && m) { picker = null; sfx.play('click'); void matrix.react(r.id, m, el.dataset.k!).catch((e) => toast('반응 실패: ' + (e as Error).message)); paintRoom(); } },
      pick: (el: HTMLElement) => { picker = picker === el.dataset.id ? null : el.dataset.id!; stick = false; paintRoom(); },
      reply: (el: HTMLElement) => { replyTo = findMsg(el.dataset.id!); editing = null; paintCompose(); input.focus(); },
      edit: (el: HTMLElement) => { editing = findMsg(el.dataset.id!); replyTo = null; if (editing) { input.value = editing.body; autosize(); } paintCompose(); input.focus(); },
      del: (el: HTMLElement) => {
        const id = el.dataset.id!, r = room();
        if (confirmDelete !== id) { confirmDelete = id; stick = false; paintRoom(); setTimeout(() => { if (confirmDelete === id) { confirmDelete = null; paintRoom(); } }, 4000); return; }
        confirmDelete = null;
        if (r) void matrix.redact(r.id, id).catch((e) => toast('삭제 실패: ' + (e as Error).message));
      },
      pin: (el: HTMLElement) => { const r = room(); if (r) { const on = !r.pinned.includes(el.dataset.id!); void matrix.pin(r.id, el.dataset.id!, on).then(() => toast(on ? '고정했습니다.' : '고정을 해제했습니다.')).catch(() => toast('고정 권한이 없습니다.', 3000)); } },
      retry: (el: HTMLElement) => { const r = room(), m = findMsg(el.dataset.id!); if (r && m) void matrix.retry(r.id, m).catch(() => null); },
      jump: (el: HTMLElement) => jumpTo(el.dataset.id!),
    };
    const jumpTo = (id: string) => {
      const el = tl.querySelector<HTMLElement>(`[data-mid="${CSS.escape(id)}"]`);
      if (!el) { toast('이 메시지는 아직 불러오지 않았습니다.'); return; }
      stick = false; el.scrollIntoView({ block: 'center', behavior: 'smooth' }); el.classList.add('flash'); setTimeout(() => el.classList.remove('flash'), 1600);
    };
    const loadOlder = async () => {
      const r = room(); if (!r || backfilling) return;
      if (r.events.length > shown) { backfilling = true; stick = false; shown += 100; paintRoom(); backfilling = false; return; }
      if (r.noMoreHistory) return;
      backfilling = true; stick = false;
      try { await matrix.backfill(r.id); } catch { /* try again later */ }
      paintRoom(); backfilling = false;
    };
    tl.addEventListener('scroll', () => {
      stick = tl.scrollHeight - tl.scrollTop - tl.clientHeight < 40;
      if (tl.scrollTop < 60) void loadOlder();
    }, { passive: true });
    // Cards arrive after the paint and grow the timeline: keep the reader at the bottom if they were.
    let lastH = 0;
    const follow = new MutationObserver(() => { if (stick && tl.scrollHeight !== lastH) { tl.scrollTop = tl.scrollHeight; lastH = tl.scrollHeight; } });
    follow.observe(tl, { childList: true, subtree: true });
    tl.addEventListener('click', (e) => { const b = (e.target as HTMLElement).closest<HTMLElement>('.cm-img'); if (b) { b.classList.toggle('big'); stick = false; } });
    pinsEl.addEventListener('click', (e) => { const b = (e.target as HTMLElement).closest<HTMLElement>('[data-pinjump]'); if (b) jumpTo(b.dataset.pinjump!); });

    /* ── Side panel ── */
    const paintSide = () => {
      if (!root.isConnected) return;
      root.querySelector(".chatx")!.classList.toggle('with-side', !!side);
      const r = room();
      if (!side) { sideEl.innerHTML = ''; return; }
      if (side === 'people') {
        const list = people();
        mount(sideEl, html`<div class="side-head"><h2>참여자 <small>${list.length}</small></h2><button class="hud-btn" data-act="x" aria-label="닫기"><i class="si icon-close"></i></button></div>
          ${list.length ? html`<ul class="people">${list.map((p) => html`<li>${raw(portraitHtml(pfps.get(p.id) || seededPfp(p.id), 32))}<div><a href="${href(`/o/${p.id}`)}"><b>${p.name}</b></a><small class="mono">${p.id}</small></div>
            ${p.uid === matrix.me ? html`<span class="chip cheong">나</span>` : html`<span class="people-acts"><button class="hud-btn" data-act="dm" data-id="${p.id}" title="메시지" aria-label="${p.name}에게 메시지"><i class="si icon-phone"></i></button><button class="hud-btn" data-act="pay" data-id="${p.id}" title="알파 보내기" aria-label="${p.name}에게 알파 보내기"><i class="si icon-send-alpha"></i></button><a class="hud-btn" href="${href(`/sim?vs=${p.id}`)}" title="실전 예측으로 도전" aria-label="${p.name}에게 도전"><i class="si icon-combat-log"></i></a><a class="hud-btn" href="${href(`/sim?duel=${p.id}`)}" title="실시간 대전 신청" aria-label="${p.name}에게 실시간 대전 신청"><i class="si icon-raid"></i></a></span>`}</li>`)}</ul>` : html`<p class="note">${r ? '참여자를 불러오는 중…' : '대화방을 고르세요.'}</p>`}
          <button class="btn ghost sm" data-act="group">그룹 대화 만들기</button>`, sideHandlers);
      } else if (side === 'search') {
        mount(sideEl, html`<div class="side-head"><h2>검색</h2><button class="hud-btn" data-act="x" aria-label="닫기"><i class="si icon-close"></i></button></div>
          <form data-act="search" data-on="submit" class="side-search"><input class="input" name="q" value="${searchTerm}" placeholder="검색어" autofocus><button class="btn primary sm">찾기</button></form>
          <label class="side-scope"><input type="checkbox" data-act="scope" ${searchAll ? 'checked' : ''}> 모든 대화방에서</label>
          ${results.length ? html`<ol class="side-results">${results.map((x) => html`<li><button data-act="go" data-room="${x.roomId}" data-id="${x.id}"><b>${matrix.displayName(x.roomId, x.sender)}</b> <small class="faint">${matrix.rooms.get(x.roomId)?.name ?? ''} · ${time(x.ts)}</small><span>${x.body.slice(0, 140)}</span></button></li>`)}</ol>` : searchTerm ? html`<p class="note">결과가 없습니다.</p>` : ''}`, sideHandlers);
      } else if (side === 'pins') {
        const pins = (r?.pinned ?? []).map((id) => r!.events.find((m) => m.id === id)).filter(Boolean) as Message[];
        mount(sideEl, html`<div class="side-head"><h2>고정 메시지</h2><button class="hud-btn" data-act="x" aria-label="닫기"><i class="si icon-close"></i></button></div>
          ${pins.length ? html`<ol class="side-results">${pins.map((m) => html`<li><button data-act="go" data-room="${r!.id}" data-id="${m.id}"><b>${matrix.displayName(r!.id, m.sender)}</b> <small class="faint">${time(m.ts)}</small><span>${m.body.slice(0, 200)}</span></button></li>`)}</ol>` : html`<p class="note">고정된 메시지가 아직 불러와지지 않았습니다.</p>`}`, sideHandlers);
      } else {
        mount(sideEl, html`<div class="side-head"><h2>채널 찾기</h2><button class="hud-btn" data-act="x" aria-label="닫기"><i class="si icon-close"></i></button></div>
          <p class="note">이 서버는 공개 방 목록을 주지 않아서, 흔한 채널 이름을 하나씩 확인합니다.</p>
          ${found.length ? html`<ul class="side-found">${found.map((f) => html`<li class="${f.id ? '' : 'faint'}"><span class="mono">${f.alias.split(':')[0]}</span>${f.id ? matrix.rooms.has(f.id) ? html`<button class="btn ghost sm" data-act="go" data-room="${f.id}">열기</button>` : html`<button class="btn primary sm" data-act="joinf" data-alias="${f.alias}">참여</button>` : html`<small>없음</small>`}</li>`)}</ul>` : html`<p class="note">확인 중…</p>`}`, sideHandlers);
      }
    };
    const sideHandlers = {
      x: () => { side = null; paintHead(); paintSide(); },
      dm: (el: HTMLElement) => void openDm(el.dataset.id!),
      pay: (el: HTMLElement) => void openTransfer({ to: el.dataset.id! }),
      group: () => { input.value = '/group '; input.focus(); },
      search: (el: HTMLElement) => { searchTerm = String(new FormData(el as HTMLFormElement).get('q') || '').trim(); void runSearch(); },
      scope: (el: HTMLElement) => { searchAll = (el as HTMLInputElement).checked; if (searchTerm) void runSearch(); },
      go: (el: HTMLElement) => { if (el.dataset.room !== active) open(el.dataset.room!); if (el.dataset.id) setTimeout(() => jumpTo(el.dataset.id!), 60); },
      joinf: (el: HTMLElement) => void joinAlias(el.dataset.alias!),
    };
    const runSearch = async () => {
      if (!searchTerm) { results = []; paintSide(); return; }
      try { results = await matrix.search(searchTerm, searchAll ? undefined : active ?? undefined); } catch (e) { results = []; toast('검색 실패: ' + (e as Error).message); }
      paintSide();
    };
    const openDm = async (playerId: string, draft = '') => {
      try { const id = await matrix.dm(playerId); setTimeout(() => { open(id); if (draft) { input.value = draft; autosize(); } }, 200); } catch (e) { toast('대화를 열 수 없습니다: ' + (e as Error).message, 4000); }
    };

    /* ── Composer ── */
    const paintCompose = () => {
      replyEl.innerHTML = replyTo ? `<span><b>${esc(matrix.displayName(active, replyTo.sender))}</b>에게 답장 · ${esc(replyTo.body.slice(0, 80))}</span><button type="button" data-cancel aria-label="답장 취소">×</button>`
        : editing ? `<span><b>수정 중</b> · Esc로 취소</span><button type="button" data-cancel aria-label="수정 취소">×</button>` : '';
      replyEl.classList.toggle('on', !!(replyTo || editing));
      form.querySelector<HTMLButtonElement>('.comms-send')!.textContent = editing ? '수정' : '전송';
      if (guard) {
        replyEl.classList.add('on', 'danger');
        replyEl.innerHTML = `<div role="alertdialog" aria-label="복구 문구 경고"><b>복구 문구로 보이는 메시지입니다.</b> SN.CORP와 길드 운영진은 절대 복구 키를 요구하지 않습니다. <button type="button" class="btn danger sm" data-guard="cancel" autofocus>취소 (권장)</button> <button type="button" class="btn outline-danger sm" data-guard="force">그래도 보내기</button></div>`;
        replyEl.querySelector<HTMLElement>('[data-guard=cancel]')?.focus();
      } else replyEl.classList.remove('danger');
    };
    replyEl.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      if (t.closest('[data-cancel]')) { if (editing) input.value = ''; replyTo = null; editing = null; paintCompose(); input.focus(); }
      const g = t.closest<HTMLElement>('[data-guard]');
      if (g) { guard = false; if (g.dataset.guard === 'force') void deliver(input.value, true); paintCompose(); input.focus(); }
    });
    const autosize = () => { input.style.height = 'auto'; input.style.height = Math.min(160, input.scrollHeight) + 'px'; };
    const paintComp = () => {
      compEl.innerHTML = comp ? comp.options.map((o, i) => `<span class="${i === comp!.i ? 'on' : ''}">${esc(o)}</span>`).join('') + `<small>Tab 다음 · Shift+Tab 이전</small>` : '';
    };

    const help = () => {
      const r = room();
      const lines = COMMANDS.map((c) => `/${c.name} ${c.args} — ${c.help}`).join('\n');
      notice(`명령어\n${lines}\n\n단축키: Ctrl+K 대화방 찾기 · Ctrl+F 검색 · Tab 자동완성 · ↑↓ 보낸 메시지 · Esc 취소`, r);
    };
    /** A line only this player sees (command output), at the bottom of the room. */
    const notice = (text: string, r = room()) => {
      if (!r) { toast(text.split('\n')[0]); return; }
      r.events.push({ id: '~n' + Date.now() + Math.random(), sender: '@통신:local', body: text, ts: Date.now(), mine: false, notice: true, reactions: [] });
      stick = true; paintRoom();
    };

    async function command(name: string, args: string[], rest: string) {
      const r = room(), ppl = people();
      switch (name) {
        case 'help': help(); return;
        case 'me': if (r && rest) await matrix.send(r.id, rest, { emote: true }); return;
        case 'msg': { const p = playerArg(args[0] ?? '', ppl); if (!p) { notice('누구에게 보낼까요? 예: /msg 1-7 안녕하세요'); return; } await openDm(p, args.slice(1).join(' ')); return; }
        case 'group': { const ids = args.map((a) => playerArg(a, ppl)).filter(Boolean) as string[]; if (ids.length < 2) { notice('두 명 이상 적어주세요. 예: /group 1-7 1-13'); return; } const id = await matrix.group(ids.join(', '), ids); setTimeout(() => open(id), 300); return; }
        case 'join': if (args[0]) await joinAlias(args[0]); return;
        case 'leave': if (r && await ask('대화방 나가기', `${r.name}에서 나갈까요? 다시 들어오려면 참여해야 합니다.`, '나가기', 'jeok')) { await matrix.leave(r.id); open(sorted()[0]?.id ?? null); } return;
        case 'topic': notice(r?.topic ? `주제: ${r.topic}` : '이 방에는 주제가 없습니다.'); return;
        case 'who': { const list = r ? await matrix.members(r.id) : []; notice(`참여자 ${list.length}명: ${list.map((m) => `${m.name} (${localpart(m.id)})`).join(', ')}`); return; }
        case 'whois': { const id = playerArg(args[0] ?? '', ppl) ?? args[0]; if (!id) return; const c = await resolveRef(id); if (!c) { notice(`${id}: 찾을 수 없습니다.`); return; } notice(`${c.title} · ${c.subtitle}\n${c.rows.map(([k, v]) => `${k} ${v}`).join(' · ')}`); return; }
        case 'share': if (args[0]) share({ kind: 'object', id: args[0] }); else notice('공유할 ID를 적어주세요. 예: /share 2-14'); return;
        case 'pay': { const p = playerArg(args[0] ?? '', ppl); void openTransfer({ to: p ?? undefined, amount: Number(args[1]) || undefined }); return; }
        case 'rent': { const c = args[0] ? await resolveRef(args[0]) : null; if (c?.provider) openRent(c.provider); else notice('공급자 ID를 적어주세요. 예: /rent 10-3'); return; }
        case 'sim': go(`/sim${args[0] ? `?vs=${encodeURIComponent(playerArg(args[0], ppl) ?? args[0])}` : ''}`); return;
        case 'duel': {
          // In a DM the other person is who you mean.
          const id = args[0] ? playerArg(args[0], ppl) ?? args[0] : r?.direct ? ppl.find((p) => p.uid !== matrix.me)?.id : undefined;
          if (!id || !/^1-\d{1,9}$/.test(id)) { notice('대전할 플레이어를 적어주세요. 예: /duel 1-7'); return; }
          go(`/sim?duel=${id}`); return;
        }
        case 'base': { const s = await baseSituation(pid!); if (s) share({ kind: 'situation', s }); return; }
        case 'search': searchTerm = rest; side = 'search'; paintHead(); paintSide(); void runSearch(); return;
      }
    }

    async function deliver(text: string, force = false) {
      const r = room();
      const p = parse(text);
      if (p.kind === 'unknown') { notice(`모르는 명령어입니다: /${p.name} · /help로 목록을 보세요. (슬래시로 시작하는 글은 //로 쓰세요)`); return; }
      if (p.kind === 'cmd') { input.value = ''; autosize(); remember(text); try { await command(p.name, p.args, p.rest); } catch (e) { toast('명령 실패: ' + (e as Error).message, 4000); } return; }
      if (!r || !p.body.trim()) return;
      if (!force && looksLikePhrase(p.body)) { guard = true; paintCompose(); return; }
      input.value = ''; autosize(); remember(text);
      matrix.typing(r.id, false);
      if (editing) { const e = editing; editing = null; paintCompose(); await matrix.edit(r.id, e.id, p.body).catch((err2) => toast('수정 실패: ' + (err2 as Error).message)); return; }
      const rt = replyTo?.id; replyTo = null; paintCompose();
      stick = true;
      sfx.play('click');
      await matrix.send(r.id, p.body, { replyTo: rt }).catch((e) => toast('전송 실패: ' + (e as Error).message, 4000));
    }
    const remember = (t: string) => { sent.unshift(t); sent.splice(50); histAt = -1; };

    form.addEventListener('submit', (e) => { e.preventDefault(); void deliver(input.value); });
    root.querySelector('[data-plus]')!.addEventListener('click', async () => {
      const s = await baseSituation(pid); if (s) share({ kind: 'situation', s });
    });
    input.addEventListener('input', () => {
      autosize(); comp = null; paintComp();
      if (active && input.value && !input.value.startsWith('/')) matrix.typing(active, true);
      if (active && !input.value) matrix.typing(active, false);
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Tab' && !e.ctrlKey && !e.metaKey) {
        if (!comp) {
          const c = complete(input.value, input.selectionStart ?? input.value.length, people().map((p) => p.name), allIds());
          if (!c) return;
          comp = { ...c, i: -1 };
        }
        e.preventDefault();
        comp.i = (comp.i + (e.shiftKey ? -1 : 1) + comp.options.length) % comp.options.length;
        const pick = comp.options[comp.i];
        input.value = input.value.slice(0, comp.start) + pick + ' ' + input.value.slice(comp.end);
        comp.end = comp.start + pick.length + 1;
        input.setSelectionRange(comp.end, comp.end);
        paintComp();
        return;
      }
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); comp = null; paintComp(); void deliver(input.value); return; }
      if (e.key === 'ArrowUp' && (!input.value || histAt >= 0) && sent.length) { e.preventDefault(); histAt = Math.min(sent.length - 1, histAt + 1); input.value = sent[histAt]; autosize(); return; }
      if (e.key === 'ArrowDown' && histAt >= 0) { e.preventDefault(); histAt--; input.value = histAt >= 0 ? sent[histAt] : ''; autosize(); return; }
      if (e.key === 'ArrowUp' && !input.value) { const mine = [...(room()?.events ?? [])].reverse().find((m) => m.mine && !m.pending && !m.redacted); if (mine) { e.preventDefault(); editing = mine; input.value = mine.body; paintCompose(); } }
    });
    // Escape backs out one step: picker → delete → reply/edit → side panel.
    const onKey = (e: KeyboardEvent) => {
      if (!root.isConnected) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); railEl.querySelector<HTMLInputElement>('.comms-filter')?.focus(); return; }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') { e.preventDefault(); side = 'search'; paintHead(); paintSide(); sideEl.querySelector<HTMLInputElement>('input[name=q]')?.focus(); return; }
      if (e.key !== 'Escape' || document.querySelector('.sheet-back')) return;
      if (picker || confirmDelete) { picker = null; confirmDelete = null; paintRoom(); e.stopImmediatePropagation(); return; }
      if (replyTo || editing || guard) { if (editing) input.value = ''; replyTo = null; editing = null; guard = false; paintCompose(); e.stopImmediatePropagation(); return; }
      if (filter && document.activeElement?.classList.contains('comms-filter')) { filter = ''; paintRail(); e.stopImmediatePropagation(); return; }
      if (side && innerWidth < 1280) { side = null; paintHead(); paintSide(); e.stopImmediatePropagation(); }
    };
    addEventListener('keydown', onKey, true);

    const paintAll = () => { paintRail(); paintRoom(); paintSide(); paintCompose(); };
    paintAll();

    let first = true, lastHeard = '';
    const initialOpen = () => {
      first = false;
      const want = params.get('room'), dm = params.get('dm'), draft = params.get('draft');
      const byAlias = want ? [...matrix.rooms.values()].find((r) => r.alias === want || r.id === want || r.alias?.startsWith(want + ':')) : null;
      // A link may open what we already have; anything that changes chat state (joining a room,
      // inviting someone to a new DM) asks first — links come from other people.
      const known = dm && /^1-\d+$/.test(dm) ? matrix.findDm(dm) : null;
      open(known ?? byAlias?.id ?? tabs.find((t) => matrix.rooms.has(t)) ?? sorted().find(isPinnedRoom)?.id ?? sorted()[0]?.id ?? null);
      if (draft) { input.value = draft; autosize(); }
      if (dm && /^1-\d+$/.test(dm) && !known) void ask('새 대화', `${dm}에게 다이렉트 메시지를 열까요? 상대에게 초대가 갑니다.`, '대화 열기').then((y) => { if (y) void openDm(dm, draft ?? ''); });
      if (want && !byAlias) void ask('대화방 참여', `${want} 대화방에 참여할까요?`, '참여').then((y) => { if (y) void joinAlias(want); });
      const term = params.get('search');
      if (term) { searchTerm = term; searchAll = true; side = 'search'; paintHead(); paintSide(); void runSearch(); }
    };
    const off = matrix.onChange(() => {
      if (!root.isConnected) return;
      if (first && matrix.rooms.size) { initialOpen(); return; }
      const r = room();
      const newest = r?.events.filter((m) => !m.pending && !m.notice).at(-1);
      if (newest && newest.id !== lastHeard && lastHeard && !newest.mine) sfx.play('tick');
      lastHeard = newest?.id ?? lastHeard;
      if (r && document.hasFocus() && !document.hidden) { r.unread = 0; r.highlight = 0; const last = r.events.filter((m) => !m.pending && !m.notice).at(-1); if (last && last.sender !== matrix.me) void matrix.read(r.id, last.id); }
      paintRail(); paintRoom(); if (side === 'people') paintSide();
    });
    try { await matrix.signIn(); matrix.start(); } catch (e) {
      // A guild without the Matrix route answers 404: say so plainly rather than echo the API.
      err = e instanceof ApiError && e.code === 'missing' ? '이 길드는 아직 통신(채팅)을 열지 않았습니다.' : '채팅 로그인 실패: ' + (e as Error).message;
      paintAll();
    }
    // Already synced (came back to this screen): open at once.
    if (matrix.rooms.size && first) initialOpen();
    return () => { off(); follow.disconnect(); removeEventListener('keydown', onKey, true); if (active) drafts.set(active, input.value); };
  },
};
export default screen;
