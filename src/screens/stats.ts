/* 은하 통계: the universe at a glance — how many commanders, planets and structs, whether the chain is
 * keeping up, and the leaderboards (best commanders by alpha, best guilds by collateral, the biggest
 * reactors and providers). Each row opens its card; any leaderboard can be shared.
 * After structs-universe's Game Stats window. Refreshes every 30 s while open. */
import type { Screen } from '../router';
import { href } from '../router';
import { html, mount, n, micro, watts, raw, esc, type Safe } from '../ui/dom';
import { needSession, errorCard, loading } from '../ui/gate';
import { guildApi, type LeaderPlayer, type LeaderGuild, type BlockRow } from '../api/guild';
import { publicSummary, type PublicSummary } from '../api/planned';
import { portraitHtml, seededPfp } from '../game/portrait';
import { share } from '../social/share';
import { setTiles } from '../ui/shell';
import { onGrass, grassState, throttled, type GrassEvent } from '../grass/grass';
import { linkIds } from '../social/ids';
import { activityLabel } from '../i18n/ko';

type Board = 'players' | 'guilds' | 'reactors' | 'providers';
const BOARD: Record<Board, string> = { players: '최고의 사령관', guilds: '최고의 길드', reactors: '리액터', providers: '전력 공급자' };

const screen: Screen = {
  async render(root) {
    const pid = needSession(root, '은하 통계');
    if (!pid) return;
    mount(root, loading('은하를 집계하는 중…'));
    let sum: PublicSummary | null = null, block: BlockRow | null = null, players: LeaderPlayer[] = [], guilds: LeaderGuild[] = [], reactors: Record<string, unknown>[] = [], providers: Record<string, unknown>[] = [];
    let board: Board = 'players';
    type Lane = 'all' | 'war' | 'econ' | 'build';
    const LANE: Record<Lane, string> = { all: '전체', war: '전투', econ: '경제', build: '건설' };
    const laneOf = (c: string): Lane => (/attack|raid|health|destroy|fleet/.test(c) ? 'war' : /build/.test(c) ? 'build' : /ore|refine|mine|infus|agreement|alloc|grid|power/.test(c) ? 'econ' : 'all');
    let streamOn = false, streamState = 'closed', lane: Lane = 'all', events: GrassEvent[] = [], offStream: (() => void) | null = null, offState: (() => void) | null = null;
    const inLane = (e: GrassEvent) => lane === 'all' || laneOf(e.category) === lane;
    const repaintSoon = throttled(() => paint(), 800);
    const heights: [number, number][] = [];

    const bar = (v: number, max: number, tone = 'var(--cheong)') => html`<span class="lb-bar"><i style="width:${max > 0 ? Math.max(2, (v / max) * 100) : 0}%;background:${tone}"></i></span>`;
    const rows = (): Safe => {
      if (board === 'players') {
        const max = Math.max(1, ...players.map((p) => Number(p.alpha_value_p ?? p.alpha_balance_p)));
        return html`${players.map((p, i) => html`<li class="${p.player_id === pid ? 'me' : ''}"><span class="rk mono">${i + 1}</span>${raw(portraitHtml(seededPfp(p.player_id), 30))}<a href="${href(`/o/${p.player_id}`)}"><b>${p.username || p.player_id}</b><small class="mono">${p.player_id}${p.guild_id ? ` · ${p.guild_id}` : ''}</small></a>${bar(Number(p.alpha_value_p ?? p.alpha_balance_p), max, 'var(--hwang)')}<span class="mono c-hwang">${micro(p.alpha_value_p ?? p.alpha_balance_p, 1)} g</span></li>`)}`;
      }
      if (board === 'guilds') {
        const max = Math.max(1, ...guilds.map((g) => Number(g.collateral_p)));
        return html`${guilds.map((g, i) => html`<li><span class="rk mono">${i + 1}</span><span class="guild-crest">${(g.name || '?').slice(0, 3)}</span><a href="${href(`/guild?id=${g.guild_id}`)}"><b>${g.name || g.guild_id}</b><small class="mono">${g.guild_id} · ${n(g.player_count)}명 · 교환 비율 ${n(g.ratio, 3)}</small></a>${bar(Number(g.collateral_p), max, 'var(--cheong)')}<span class="mono">${micro(g.collateral_p, 0)} g</span></li>`)}`;
      }
      const list = board === 'reactors' ? reactors : providers;
      const val = (r: Record<string, unknown>) => Number(r.capacity_p ?? r.capacity ?? r.power_p ?? r.power ?? r.fuel_p ?? r.committed_capacity ?? 0);
      const max = Math.max(1, ...list.map(val));
      return html`${list.map((r, i) => { const id = String(r.reactor_id ?? r.provider_id ?? r.id ?? ''); return html`<li><span class="rk mono">${i + 1}</span><span class="ref-glyph ${board === 'reactors' ? 'reactor' : 'provider'}"><i class="si ${board === 'reactors' ? 'icon-computer' : 'icon-transfers'}"></i></span><a href="${href(`/o/${id}`)}"><b>${id}</b><small class="mono">${String(r.owner ?? r.guild_id ?? '')}</small></a>${bar(val(r), max, 'var(--warn)')}<span class="mono">${watts(val(r))}</span></li>`; })}
        ${list.length ? '' : html`<li class="none">이 길드 API는 아직 이 순위를 주지 않습니다.</li>`}`;
    };
    const view = (): Safe => {
      const lag = block?.lag_blocks ?? 0;
      const rate = heights.length > 1 ? (heights.at(-1)![1] - heights[0][1]) / ((heights.at(-1)![0] - heights[0][0]) / 1000) : null;
      return html`
      <div class="card-head"><h1 style="font-size:28px">은하 통계</h1></div>
      <section class="card game-panel"><h2>우주</h2><div class="stat-grid">
        <div class="stat"><small>사령관</small><strong class="mono">${sum?.players == null ? '—' : n(sum.players)}</strong></div>
        ${sum?.active_players == null ? '' : html`<div class="stat"><small>활동 중</small><strong class="mono c-cheong">${n(sum.active_players)}</strong></div>`}
        <div class="stat"><small>행성</small><strong class="mono">${sum?.planets == null ? '—' : n(sum.planets)}</strong></div>
        ${sum?.structs == null ? '' : html`<div class="stat"><small>구조체</small><strong class="mono">${n(sum.structs)}</strong></div>`}
        <div class="stat"><small>길드</small><strong class="mono">${sum?.guilds == null ? '—' : n(sum.guilds)}</strong></div>
        <div class="stat"><small>블록 높이</small><strong class="mono">${block ? '#' + n(block.height) : '—'}</strong></div>
      </div></section>
      <section class="card game-panel"><h2>은하 생존 신호</h2>
        <div class="live-row"><span class="dot ${!block ? '' : lag > 20 ? 'stalled' : 'live'}"></span><b>${!block ? '알 수 없음' : lag > 20 ? `인덱서가 ${n(lag)}블록 뒤처짐` : '정상 — 은하 정보가 실시간으로 갱신되고 있습니다'}</b>
          <span class="end mono dim">${rate != null ? `${n(rate * 60, 1)} 블록/분` : '측정 중…'} · 지연 ${n(lag)}블록</span></div>
        <div class="spark">${heights.slice(-30).map(([, h], i, a) => { const d = i ? h - a[i - 1][1] : 0; return html`<i style="height:${Math.min(100, 20 + d * 20)}%" title="+${d}"></i>`; })}</div>
      </section>
      <section class="card game-panel"><div class="card-head"><h2>${BOARD[board]}</h2>
        <span class="end" style="display:flex;gap:6px;flex-wrap:wrap">${(Object.keys(BOARD) as Board[]).map((b) => html`<button class="pill ${board === b ? 'on' : ''}" data-act="board" data-b="${b}">${BOARD[b]}</button>`)}<button class="btn ghost sm" data-act="share">공유</button></span></div>
        <ol class="lb">${rows()}</ol></section>
      <section class="card game-panel"><div class="card-head"><h2>실시간 스트림</h2><span class="dot ${streamState === 'live' ? 'live' : streamState === 'connecting' ? 'connecting' : ''}"></span><span class="mono dim" style="font-size:12px">${streamOn ? (streamState === 'live' ? '연결됨' : '연결 중…') : '꺼짐'}</span>
        <span class="end" style="display:flex;gap:6px;flex-wrap:wrap">${streamOn ? (['all', 'war', 'econ', 'build'] as Lane[]).map((l) => html`<button class="pill ${lane === l ? 'on' : ''}" data-act="lane" data-l="${l}">${LANE[l]}</button>`) : ''}<button class="btn ${streamOn ? 'ghost' : 'primary'} sm" data-act="stream">${streamOn ? '끄기' : '켜기'}</button></span></div>
        ${streamOn ? (events.filter(inLane).length ? html`<ol class="newswire stream">${events.filter(inLane).slice(0, 60).map((e) => html`<li class="${laneOf(e.category)}"><span class="mono faint">${new Date(e.at).toLocaleTimeString('ko-KR')}</span> <b>${activityLabel(e.category || e.subject.split('.')[1] || '이벤트')}</b> ${raw(linkIds(esc(e.subject.split('.').slice(2).join(' · ')), href('')))}</li>`)}</ol>` : html`<p class="note">이벤트를 기다리는 중… 은하 어딘가에서 블록마다 일이 일어납니다.</p>`) : html`<p class="note">실시간 소식(습격, 공격, 건설, 채굴, 전력)을 켜면 은하 전체의 움직임이 여기에 흐릅니다.</p>`}
      </section>`;
    };
    const paint = () => { if (root.isConnected) mount(root, view(), handlers); setTiles([{ label: '사령관', value: sum?.players == null ? '—' : n(sum.players) }, { label: '블록', value: block ? n(block.height) : '—', tone: 'var(--cheong-hi)' }]); };
    const handlers = {
      stream: () => {
        streamOn = !streamOn;
        if (streamOn) {
          offState = grassState((st) => { streamState = st; repaintSoon(); });
          offStream = onGrass('structs.>', (e) => { events.unshift(e); if (events.length > 200) events.length = 200; repaintSoon(); });
        } else { offStream?.(); offState?.(); offStream = offState = null; }
        paint();
      },
      lane: (el: HTMLElement) => { lane = el.dataset.l as Lane; paint(); },
      board: (el: HTMLElement) => { board = el.dataset.b as Board; paint(); },
      share: () => {
        const top = board === 'players' ? players.slice(0, 5).map((p, i) => [`${i + 1}위`, `${p.username || p.player_id} · ${micro(p.alpha_value_p ?? p.alpha_balance_p, 0)} g`] as [string, string])
          : board === 'guilds' ? guilds.slice(0, 5).map((g, i) => [`${i + 1}위`, `${g.name || g.guild_id} · ${micro(g.collateral_p, 0)} g`] as [string, string]) : [];
        share({ kind: 'situation', s: { t: 'guild', title: `은하 순위 — ${BOARD[board]}`, sub: block ? `블록 #${n(block.height)}` : undefined, lines: top, ids: board === 'players' ? players.slice(0, 3).map((p) => p.player_id) : guilds.slice(0, 3).map((g) => g.guild_id), go: '/stats', tone: 'hwang', at: Date.now() } });
      },
    };
    const load = async () => {
      const soft = <T,>(p: Promise<T>, d: T) => p.catch(() => d);
      [sum, block, players, guilds, reactors, providers] = await Promise.all([
        soft(publicSummary(), null), soft(guildApi.block(), null), soft(guildApi.leaderboard<LeaderPlayer>('player', 20), []), soft(guildApi.leaderboard<LeaderGuild>('guild', 20), []),
        soft(guildApi.leaderboard<Record<string, unknown>>('reactor', 15), []), soft(guildApi.leaderboard<Record<string, unknown>>('provider', 15), []),
      ]);
      if (block) heights.push([Date.now(), block.height]);
      paint();
    };
    try { await load(); } catch (e) { mount(root, errorCard(e)); return; }
    const t = window.setInterval(() => { if (!document.hidden && root.isConnected) void guildApi.block().then((b) => { block = b; heights.push([Date.now(), b.height]); if (heights.length > 60) heights.shift(); paint(); }).catch(() => null); }, 30_000);
    return () => { clearInterval(t); offStream?.(); offState?.(); setTiles([]); };
  },
};
export default screen;
