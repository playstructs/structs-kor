/* 작전 보드: your own console of live cards, laid out how you play. Workspaces (tabs) hold widgets —
 * any object's card, your base, the market's best offers, guild banks, the armada, raids, unread
 * comms, your planet's feed, the leaderboard, the duty log — each narrow, wide or full. Reorder by
 * drag, by the arrows, or Alt+←/→ on a focused card. Presets lay out a whole board for a way of
 * playing; a board can be shared as a code (or a link) and imported by anyone.
 * After structs-universe's Structs Terminal (workspaces, cards, presets, SHARE / IMPORT). */
import { orderName } from '../i18n/ko';
import type { Screen } from '../router';
import { href } from '../router';
import { html, mount, raw, n, micro, watts, toast, type Safe } from '../ui/dom';
import { needSession } from '../ui/gate';
import { guildApi, type PlayerRow, type ProviderRow, type BankRow, type ActivityRow, type LeaderPlayer, type RaidRow } from '../api/guild';
import { refSlot, resolveRef, isRefId } from '../social/refs';
import { activityLabel, entityOf } from '../i18n/ko';
import { perKwDay } from '../api/rates';
import { matrix } from '../chat/matrix';
import { dutyLog, roster } from '../game/orders';
import { watchlist } from '../social/actions';
import { share } from '../social/share';
import { setTiles } from '../ui/shell';
import { txLog, onTx } from '../api/txlog';
import { sfx } from '../game/sfx';

import { KINDS, encodeBoard, decodeBoard, type Kind, type Card, type Board } from '../social/boardcode';
interface Store { at: number; boards: Board[] }
const PRESETS: Record<string, Board> = {
  지휘관: { name: '지휘관', cards: [{ k: 'me', w: 1 }, { k: 'raids', w: 1 }, { k: 'comms', w: 1 }, { k: 'feed', w: 2 }, { k: 'armada', w: 1 }, { k: 'watch', w: 3 }] },
  트습격대: { name: '트습격대', cards: [{ k: 'market', w: 2 }, { k: 'banks', w: 1 }, { k: 'me', w: 1 }, { k: 'comms', w: 1 }, { k: 'leaders', w: 1 }] },
  '길드 운영': { name: '길드 운영', cards: [{ k: 'banks', w: 1 }, { k: 'leaders', w: 1 }, { k: 'comms', w: 1 }, { k: 'armada', w: 1 }, { k: 'feed', w: 2 }] },
  습격대: { name: '습격대', cards: [{ k: 'raids', w: 1 }, { k: 'leaders', w: 1 }, { k: 'me', w: 1 }, { k: 'feed', w: 3 }] },
  '봇 운영': { name: '봇 운영', cards: [{ k: 'armada', w: 1 }, { k: 'duty', w: 2 }, { k: 'tx', w: 1 }, { k: 'me', w: 1 }, { k: 'market', w: 2 }] },
};
const KEY = 'structs-kor.boards';
const load = (): Store => { try { const s = JSON.parse(localStorage.getItem(KEY) || 'null') as Store | null; if (s?.boards?.length) return s; } catch { /* fresh */ } return { at: 0, boards: [structuredClone(PRESETS['지휘관'])] }; };
const save = (s: Store) => { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* fine */ } };

const screen: Screen = {
  async render(root, params) {
    const pid = needSession(root, '작전 보드');
    if (!pid) return;
    const store = load();
    const imp = params.get('import');
    if (imp) { const b = decodeBoard(imp); if (b) { store.boards.push(b); store.at = store.boards.length - 1; save(store); toast(`보드 "${b.name}"을(를) 가져왔습니다.`); history.replaceState(null, '', href('/board')); } }
    let adding = false, editing = false, drag = -1;
    // Live data, shared by every card that needs it.
    let me: PlayerRow | null = null, offers: ProviderRow[] = [], banks: BankRow[] = [], feed: ActivityRow[] = [], leaders: LeaderPlayer[] = [], myRaid: RaidRow | null = null;
    let reps: { n: number; alpha: number; attention: number } | null = null, watchRaids: { id: string; raid: RaidRow }[] = [];
    const board = () => store.boards[store.at] ?? store.boards[0];

    const body = (c: Card): Safe => {
      switch (c.k) {
        case 'obj': return c.id ? raw(refSlot(c.id, { base: href(''), me: pid })) : html``;
        case 'me': {
          if (!me) return html`<p class="faint">불러오는 중…</p>`;
          const load = Number(me.load) + Number(me.structs_load), cap = Number(me.capacity) + Number(me.connection_capacity);
          return html`<div class="bw-stats"><div><small>알파</small><b class="c-hwang">${micro(me.alpha, 2)} g</b></div><div><small>광석</small><b>${n(me.ore)}</b></div><div><small>전력</small><b style="color:${load > cap ? 'var(--jeok)' : ''}">${watts(load)} / ${watts(cap)}</b></div><div><small>위협</small><b class="${myRaid ? 'c-jeok' : 'c-cheong'}">${myRaid ? '습격 중' : '없음'}</b></div></div>
            <div class="bw-acts"><a class="btn ghost sm" href="${href('/console')}">함교</a>${me.planet_id ? html`<a class="btn ghost sm" href="${href(`/o/${me.planet_id}`)}">행성</a>` : ''}</div>`;
        }
        case 'market': return html`<table class="t bw-t"><thead><tr><th>공급자</th><th class="r">/ kW 하루</th><th class="r">용량</th></tr></thead><tbody>${offers.slice(0, 6).map((p) => html`<tr><td><a href="${href(`/o/${p.id}`)}">${p.id}</a></td><td class="r mono">${micro(perKwDay(p.rate_amount), 2)} ${p.rate_denom === 'ualpha' ? 'g' : '길드 화폐'}</td><td class="r mono">${n(Number(p.capacity_maximum) / 1e6, 1)} kW</td></tr>`)}</tbody></table>${offers.length ? '' : html`<p class="faint">판매 중인 전력이 없습니다.</p>`}<a class="btn ghost sm" href="${href('/market')}">시장</a>`;
        case 'banks': return html`<ul class="bw-list">${banks.map((b) => html`<li><a href="${href(`/o/${b.guild_id}`)}">${b.guild_id}</a><span class="mono" style="color:${Number(b.ratio) < 1 ? 'var(--jeok)' : 'var(--cheong)'}">${n(b.ratio, 3)}</span><small class="mono faint">${micro(b.collateral, 0)} g</small></li>`)}</ul>`;
        case 'armada': return reps ? html`<div class="bw-stats"><div><small>인원</small><b>${n(reps.n)}</b></div><div><small>알파</small><b class="c-hwang">${n(reps.alpha, 2)} g</b></div><div><small>주의</small><b class="${reps.attention ? 'c-warn' : ''}">${n(reps.attention)}</b></div></div><a class="btn ghost sm" href="${href('/replicants')}">함대 편성</a>` : html`<p class="faint">지갑을 열면 레플리칸트를 셉니다.</p>`;
        case 'raids': return html`${myRaid ? html`<div class="notice err">내 행성 습격 중 · 함대 ${myRaid.fleet_id}</div>` : html`<p class="c-cheong">내 행성은 조용합니다.</p>`}
          ${watchRaids.map((w) => html`<p><a href="${href(`/o/${w.id}`)}">${entityOf(w.id)} ${w.id}</a> 습격 중 · ${w.raid.fleet_id}</p>`)}<a class="btn ghost sm" href="${href('/war?tab=raids')}">상황실</a>`;
        case 'comms': {
          const rooms = [...matrix.rooms.values()].filter((r) => r.unread || r.events.length).sort((a, b) => (b.events.at(-1)?.ts ?? 0) - (a.events.at(-1)?.ts ?? 0)).slice(0, 5);
          return rooms.length ? html`<ul class="bw-list">${rooms.map((r) => html`<li><a href="${href(`/chat?room=${encodeURIComponent(r.alias ?? r.id)}`)}">${r.direct ? '@' : '#'}${r.name.replace(/^#/, '').split(':')[0]}</a><small class="faint">${(r.events.at(-1)?.body ?? '').slice(0, 40)}</small>${r.unread ? html`<span class="comms-n ${r.highlight ? 'hi' : ''}">${r.unread}</span>` : ''}</li>`)}</ul>` : html`<p class="faint">${matrix.grant ? '대화가 없습니다.' : '통신에 연결하면 여기에 보입니다.'}</p><a class="btn ghost sm" href="${href('/chat')}">통신</a>`;
        }
        case 'feed': return feed.length ? html`<ol class="newswire bw-feed">${feed.slice(0, 8).map((r) => html`<li><span class="mono faint">${r.block_height ? '#' + n(r.block_height) : ''}</span> <b>${activityLabel(r.category)}</b> ${typeof r.detail === 'string' ? r.detail : ''}</li>`)}</ol>` : html`<p class="faint">기록이 없습니다.</p>`;
        case 'leaders': return html`<ol class="bw-list num">${leaders.slice(0, 6).map((l) => html`<li class="${l.player_id === pid ? 'me' : ''}"><a href="${href(`/o/${l.player_id}`)}">${l.username || l.player_id}</a><span class="mono c-hwang">${micro(l.alpha_value_p ?? l.alpha_balance_p, 0)} g</span></li>`)}</ol>`;
        case 'duty': { const log = dutyLog().slice(0, 6); return log.length ? html`<ol class="newswire duty">${log.map((x) => html`<li class="${x.tone ?? ''}"><span class="mono faint">${new Date(x.at).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}</span> ${x.text}</li>`)}</ol>` : html`<p class="faint">복무 규칙이 아직 아무것도 하지 않았습니다.</p>`; }
        case 'tx': { const t = txLog().slice(0, 8); return t.length ? html`<ul class="bw-list">${t.map((x) => html`<li><b>${({ pending: '대기', ok: '완료', failed: '실패', unknown: '?', refused: '거부' } as Record<string, string>)[x.status]}</b><small>${orderName(x.name)}</small><span class="mono faint">${new Date(x.at).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}</span></li>`)}</ul>` : html`<p class="faint">이번 세션에 보낸 거래가 없습니다.</p>`; }
        case 'watch': { const w = watchlist(); return w.length ? html`<div class="bw-watch">${w.slice(0, 9).map((id) => raw(refSlot(id, { base: href(''), compact: true, me: pid })))}</div>` : html`<p class="faint">카드의 ☆ 감시나 팔레트의 <b>감시 ID</b>로 추가하세요.</p>`; }
      }
    };
    const title = (c: Card) => (c.k === 'obj' ? `${entityOf(c.id ?? '')} ${c.id}` : KINDS[c.k].name);

    const view = (): Safe => {
      const b = board();
      return html`
      <div class="card-head"><h1 style="font-size:28px">작전 보드</h1>
        <span class="end" style="display:flex;gap:6px;flex-wrap:wrap"><button class="btn ghost sm" data-act="edit" aria-pressed="${editing}">${editing ? '편집 끝' : '편집'}</button><button class="btn primary sm" data-act="add">카드 추가</button><button class="btn ghost sm" data-act="shareBoard">보드 공유</button></span></div>
      <div class="board-tabrow"><div class="tabs board-tabs" role="tablist" aria-label="보드">${store.boards.map((x, i) => html`<button class="tab ${i === store.at ? 'on' : ''}" role="tab" aria-selected="${i === store.at}" data-act="ws" data-i="${i}">${x.name}</button>`)}</div><button class="tab" data-act="newWs" title="새 보드" aria-label="새 보드">+</button></div>
      ${editing ? html`<div class="board-edit"><input class="input" name="wsName" value="${b.name}" data-act="rename" data-on="change" aria-label="보드 이름">
        <select class="input" data-act="preset" data-on="change" aria-label="프리셋"><option value="">프리셋 적용…</option>${Object.keys(PRESETS).map((k) => html`<option value="${k}">${k}</option>`)}</select>
        <form class="invite-form" data-act="import" data-on="submit"><input class="input mono" name="code" placeholder="보드 코드 (B…)"><button class="btn ghost sm">가져오기</button></form>
        <button class="btn outline-danger sm" data-act="delWs" ${store.boards.length > 1 ? '' : 'disabled'}>이 보드 삭제</button></div>` : ''}
      ${adding ? html`<div class="board-add">${(Object.keys(KINDS) as Kind[]).filter((k) => k !== 'obj').map((k) => html`<button class="pill" data-act="addKind" data-k="${k}"><i class="si ${KINDS[k].icon}"></i> ${KINDS[k].name}</button>`)}
        <form class="invite-form" data-act="addObj" data-on="submit"><input class="input mono" name="id" placeholder="객체 ID (2-14, 1-7…)" autofocus><button class="btn primary sm">카드 추가</button></form></div>` : ''}
      <div class="board-grid">${b.cards.map((c, i) => html`<section class="card game-panel bw w${c.w} ${drag === i ? 'dragging' : ''}" draggable="${editing}" data-i="${i}">
        <header class="bw-head" tabindex="0" data-i="${i}"><i class="si ${KINDS[c.k].icon}"></i><b>${title(c)}</b>
          ${editing ? html`<span class="bw-tools"><button class="hud-btn" data-act="left" data-i="${i}" aria-label="왼쪽으로" ${i ? '' : 'disabled'}>‹</button><button class="hud-btn" data-act="right" data-i="${i}" aria-label="오른쪽으로" ${i < b.cards.length - 1 ? '' : 'disabled'}>›</button><button class="hud-btn" data-act="width" data-i="${i}" aria-label="너비">${c.w === 1 ? '▭' : c.w === 2 ? '▬' : '█'}</button><button class="hud-btn" data-act="remove" data-i="${i}" aria-label="빼기"><i class="si icon-close"></i></button></span>` : ''}</header>
        <div class="bw-body">${body(c)}</div></section>`)}
        ${b.cards.length ? '' : html`<div class="card"><p class="empty">빈 보드입니다. <b>카드 추가</b>나 프리셋으로 채우세요.</p></div>`}</div>`;
    };
    const paint = () => { if (root.isConnected) { mount(root, view(), handlers); bindDrag(); } setTiles([{ label: '보드', value: board().name }, { label: '카드', value: n(board().cards.length) }]); };
    const commit = () => { save(store); paint(); };
    const move = (i: number, to: number) => { const c = board().cards; if (to < 0 || to >= c.length) return; const [x] = c.splice(i, 1); c.splice(to, 0, x); commit(); root.querySelector<HTMLElement>(`.bw-head[data-i="${to}"]`)?.focus(); };
    const handlers = {
      ws: (el: HTMLElement) => { store.at = Number(el.dataset.i); commit(); void refresh(); },
      newWs: () => { store.boards.push({ name: `보드 ${store.boards.length + 1}`, cards: [] }); store.at = store.boards.length - 1; editing = true; adding = true; commit(); },
      delWs: () => { store.boards.splice(store.at, 1); store.at = 0; commit(); },
      rename: (el: HTMLElement) => { board().name = (el as HTMLInputElement).value.trim().slice(0, 20) || board().name; commit(); },
      preset: (el: HTMLElement) => { const p = PRESETS[(el as HTMLSelectElement).value]; if (p) { store.boards[store.at] = structuredClone(p); commit(); void refresh(); } },
      import: (el: HTMLElement) => { const b = decodeBoard(String(new FormData(el as HTMLFormElement).get('code') || '')); if (!b) { toast('보드 코드가 올바르지 않습니다.'); return; } store.boards.push(b); store.at = store.boards.length - 1; commit(); void refresh(); },
      edit: () => { editing = !editing; adding = false; paint(); },
      add: () => { adding = !adding; paint(); },
      addKind: (el: HTMLElement) => { const k = el.dataset.k as Kind; board().cards.push({ k, w: KINDS[k].w }); adding = false; sfx.play('click'); commit(); void refresh(); },
      addObj: (el: HTMLElement) => { const id = String(new FormData(el as HTMLFormElement).get('id') || '').trim(); if (!isRefId(id)) { toast('객체 ID를 입력하세요 (예: 2-14)'); return; } board().cards.push({ k: 'obj', id, w: 1 }); adding = false; void resolveRef(id); commit(); },
      left: (el: HTMLElement) => move(Number(el.dataset.i), Number(el.dataset.i) - 1),
      right: (el: HTMLElement) => move(Number(el.dataset.i), Number(el.dataset.i) + 1),
      width: (el: HTMLElement) => { const c = board().cards[Number(el.dataset.i)]; c.w = (c.w % 3 + 1) as 1 | 2 | 3; commit(); },
      remove: (el: HTMLElement) => { board().cards.splice(Number(el.dataset.i), 1); commit(); },
      shareBoard: () => {
        const code = encodeBoard(board());
        share({ kind: 'situation', s: { t: 'base', title: `작전 보드 "${board().name}"`, sub: `카드 ${board().cards.length}장 · 열어서 내 보드로 가져가세요`, lines: board().cards.slice(0, 6).map((c, i) => [`${i + 1}`, title(c)] as [string, string]), go: code.length < 1500 ? `/board?import=${code}` : '/board', at: Date.now() } });
        void navigator.clipboard?.writeText(code).then(() => toast('보드 코드를 복사했습니다.')).catch(() => null);
      },
    };
    const bindDrag = () => {
      for (const el of root.querySelectorAll<HTMLElement>('.bw[draggable="true"]')) {
        el.addEventListener('dragstart', (e) => { drag = Number(el.dataset.i); e.dataTransfer?.setData('text/plain', String(drag)); el.classList.add('dragging'); });
        el.addEventListener('dragover', (e) => { e.preventDefault(); el.classList.add('over'); });
        el.addEventListener('dragleave', () => el.classList.remove('over'));
        el.addEventListener('drop', (e) => { e.preventDefault(); const to = Number(el.dataset.i); const from = drag; drag = -1; if (from >= 0 && from !== to) move(from, to); else paint(); });
        el.addEventListener('dragend', () => { drag = -1; el.classList.remove('dragging'); });
      }
    };
    const onKey = (e: KeyboardEvent) => {
      const h = (e.target as HTMLElement)?.closest?.('.bw-head') as HTMLElement | null;
      if (!h || !e.altKey) return;
      const i = Number(h.dataset.i);
      if (e.key === 'ArrowLeft') { e.preventDefault(); move(i, i - 1); } else if (e.key === 'ArrowRight') { e.preventDefault(); move(i, i + 1); }
      else if (e.key === 'Home') { e.preventDefault(); move(i, 0); } else if (e.key === 'End') { e.preventDefault(); move(i, board().cards.length - 1); }
    };
    root.addEventListener('keydown', onKey);

    const need = (k: Kind) => board().cards.some((c) => c.k === k);
    const refresh = async () => {
      const soft = <T,>(p: Promise<T>, d: T) => p.catch(() => d);
      me = await soft(guildApi.player(pid), me);
      await Promise.all([
        need('market') ? soft(guildApi.providerMarket(), []).then((o) => { offers = [...o].sort((a, b) => perKwDay(a.rate_amount) - perKwDay(b.rate_amount)); }) : null,
        need('banks') ? soft(guildApi.bank(), []).then((b) => { banks = b; }) : null,
        need('feed') && me?.planet_id ? soft(guildApi.activity(me.planet_id, 1, 12), []).then((f) => { feed = f; }) : null,
        need('leaders') ? soft(guildApi.leaderboard<LeaderPlayer>('player', 8), []).then((l) => { leaders = l; }) : null,
        (need('raids') || need('me')) && me?.planet_id ? soft(guildApi.activeRaid(me.planet_id), null).then((r) => { myRaid = r; }) : null,
        need('raids') ? Promise.all(watchlist().filter((w) => w.startsWith('2-')).slice(0, 6).map(async (w) => ({ id: w, raid: await soft(guildApi.activeRaid(w), null) }))).then((r) => { watchRaids = r.filter((x): x is { id: string; raid: RaidRow } => !!x.raid); }) : null,
        need('armada') ? soft(roster(pid), []).then((l) => { reps = { n: l.length, alpha: l.reduce((s, r) => s + Number(r.alpha), 0) / 1e6, attention: l.filter((r) => !r.planet_id || Number(r.load) > Number(r.capacity) * 0.95).length }; }) : null,
      ]);
      paint();
    };
    paint();
    await refresh();
    const t = window.setInterval(() => { if (!document.hidden && root.isConnected && !editing) void refresh(); }, 30_000);
    const offChat = matrix.onChange(() => { if (need('comms') && !editing && root.isConnected) paint(); });
    const offTx = onTx(() => { if (need('tx') && !editing && root.isConnected) paint(); });
    return () => { clearInterval(t); offChat(); offTx(); root.removeEventListener('keydown', onKey); setTiles([]); };
  },
};
export default screen;
