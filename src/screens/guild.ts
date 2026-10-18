/* 길드: who you fight beside. Signed in, the real guild from the Guild API (roster with portraits,
 * members' alpha, the guild bank). On the demo base, three NPC guilds with their own perks: join
 * one, pool alpha, and every level lifts everyone's mining. */
import type { Screen } from '../router';
import { href } from '../router';
import { html, mount, n, micro, raw, toast, type Safe } from '../ui/dom';
import { needSession, errorCard, loading } from '../ui/gate';
import { setTiles } from '../ui/shell';
import { guildApi, type GuildRow, type RosterRow, type BankRow } from '../api/guild';
import { demo, DEMO_ID, GUILDS, GUILD_LEVELS, type GuildId } from '../game/demo';
import { portraitHtml, seededPfp, myPfp } from '../game/portrait';
import { sfx } from '../game/sfx';
import { banner, float } from '../game/fx';

const screen: Screen = {
  render(root) {
    const pid = needSession(root, '길드', { demo: true });
    if (!pid) return;
    return pid === DEMO_ID ? demoGuild(root) : realGuild(root, pid);
  },
};
export default screen;

/* 길드 전: this season's standings, blocks left, and how you add to your guild's score. */
function raceCard(mine: string): Safe {
  const r = demo.race;
  if (!r) return html``;
  const top = Math.max(1, r.order[0][1]);
  return html`<section class="card game-panel race"><div class="card-head"><h2>길드 전</h2><span class="end mono ${r.left < 60 ? 'c-jeok' : 'dim'}">시즌 종료까지 ${r.left}블록</span></div>
    <ol class="race-rows">${r.order.map(([id, pts], i) => { const gd = GUILDS.find((x) => x.id === id)!; return html`<li class="${id === mine ? 'me' : ''}"><span class="rk mono">${i + 1}</span><b>${gd.name}</b><div class="race-bar"><i class="${id}" style="width:${(pts / top) * 100}%"></i></div><span class="mono">${n(Math.round(pts))}</span></li>`; })}</ol>
    <p class="note">시즌 시작 전부터 있던 우승 길드원은 알파 20 g과 XP를 받습니다. 기부 1 g = 4점 · 습격 격퇴 15점 · 현상금 25점. 우승 ${r.wins}회.</p></section>`;
}

function demoGuild(root: HTMLElement): () => void {
  const view = (): Safe => {
    const g = demo.guild;
    if (!g) return html`
      <div class="card-head"><h1 style="font-size:28px">길드</h1><span class="label c-hwang">GUILD</span></div>
      <p class="note">혼자서는 버틸 수 없습니다. 길드를 고르세요 — 길드마다 다른 이점이 있고, 레벨이 오를수록 모두의 채굴이 빨라집니다.</p>
      <div class="guild-pick">${GUILDS.map((x) => html`<article class="guild-card ${x.id}">
        <div class="guild-crest">${x.tag}</div><h2>${x.name}</h2><p class="motto">“${x.motto}”</p><p class="perk">${x.perk}</p>
        <div class="guild-faces">${x.members.map((m) => raw(portraitHtml(seededPfp(x.id + m), 36, m)))}</div>
        <button class="btn primary" data-act="join" data-id="${x.id}">가입</button></article>`)}</div>`;
    const lo = GUILD_LEVELS[g.level - 1], hi = GUILD_LEVELS[g.level] ?? lo;
    const pct = hi > lo ? Math.min(100, ((g.xp - lo) / (hi - lo)) * 100) : 100;
    return html`
      <div class="card-head"><h1 style="font-size:28px">${g.name}</h1><span class="chip hwang mono">${g.tag}</span><span class="end mono c-hwang">레벨 ${g.level} · 채굴 +${3 * g.level}%</span></div>
      <div class="guild-wrap">
        <section class="card game-panel guild-${g.id}"><div class="guild-banner"><div class="guild-crest big">${g.tag}</div><div><h2>“${g.motto}”</h2><p class="perk">${g.perk}</p></div></div>
          <div class="plate-xp big"><i style="width:${pct}%"></i></div>
          <span class="mono dim">${g.level < GUILD_LEVELS.length ? `${Math.floor(g.xp)} / ${hi} XP → 레벨 ${g.level + 1}` : '최고 레벨'} · 내 기부 ${n(g.donated, 1)} g</span>
          <div style="display:flex;gap:8px;flex-wrap:wrap">${[1, 5, 10].map((v) => html`<button class="btn gold" data-act="donate" data-g="${v}" ${demo.state.alpha >= v ? '' : 'disabled'}>알파 ${v} g 기부</button>`)}</div>
          <p class="note">기부한 알파는 길드 레벨로 돌아옵니다. 길드원들도 매 블록 조금씩 보탭니다.</p>
        </section>
        ${raceCard(g.id)}
        <section class="card game-panel"><h2>길드원</h2>
          <ol class="standings">${[{ name: '나 · 한빛 IV', face: myPfp(), me: true, d: g.donated }, ...g.members.map((m, i) => ({ name: m, face: seededPfp(g.id + m), me: false, d: Math.max(0, g.xp / (i + 2.5) - i) }))]
            .sort((a, b) => b.d - a.d).map((m, i) => html`<li class="${m.me ? 'me' : ''}"><span class="rk mono">${i + 1}</span>${raw(portraitHtml(m.face, 32))}<div><b>${m.name}</b><small class="mono">기여 ${n(m.d, 1)} g</small></div>${m.me ? html`<span class="chip cheong">나</span>` : ''}</li>`)}</ol>
          <p class="note">다른 길드로 옮기려면 <b>알파 5 g</b>가 들고, 쌓은 레벨은 사라집니다.</p>
          <div style="display:flex;gap:6px;flex-wrap:wrap">${GUILDS.filter((x) => x.id !== g.id).map((x) => html`<button class="btn ghost" data-act="join" data-id="${x.id}">${x.name}(으)로 이적</button>`)}</div>
        </section>
      </div>`;
  };
  const paint = () => {
    if (!root.isConnected) return;
    mount(root, view(), handlers);
    const g = demo.guild;
    setTiles([{ label: '알파 매터', value: '', num: demo.state.alpha, fmt: (v) => n(v, 2) + ' g', tone: 'var(--hwang)' }, { label: '길드', value: g ? `${g.tag} · Lv ${g.level}` : '무소속', tone: 'var(--cheong-hi)' }]);
  };
  const handlers = {
    join: (el: HTMLElement) => {
      const id = el.dataset.id as GuildId;
      if (demo.guild && !confirm('길드를 옮기면 알파 5 g가 들고 길드 레벨이 초기화됩니다. 옮길까요?')) return;
      const m = demo.joinGuild(id);
      if (m) { sfx.play('error'); toast(m); return; }
      const g = demo.guild!;
      sfx.play('levelup'); banner({ kicker: '길드 가입', title: g.name, sub: g.perk, tone: 'gold' });
      paint();
    },
    donate: (el: HTMLElement) => {
      const v = Number(el.dataset.g);
      const m = demo.donate(v);
      if (m) { sfx.play('error'); toast(m); return; }
      sfx.play('coin'); float(el, `+${v} XP`, 'var(--hwang)', true);
      paint();
    },
  };
  paint();
  const off = demo.onBlock(paint);
  return () => { off(); setTiles([]); };
}

async function realGuild(root: HTMLElement, pid: string): Promise<() => void> {
  mount(root, loading('길드 불러오는 중…'));
  let guild: GuildRow | null = null, roster: RosterRow[] = [], bank: BankRow[] = [], count = 0;
  try {
    const me = await guildApi.player(pid);
    const soft = <T,>(p: Promise<T>, d: T) => p.catch(() => d);
    [guild, roster, bank, count] = await Promise.all([
      soft(guildApi.guild(me.guild_id), null), soft(guildApi.roster(me.guild_id), [] as RosterRow[]), soft(guildApi.bank(), [] as BankRow[]),
      soft(guildApi.memberCount(me.guild_id).then((c) => c.count), 0),
    ]);
  } catch (e) { mount(root, errorCard(e)); return () => undefined; }
  const sorted = [...roster].sort((a, b) => Number(b.alpha) - Number(a.alpha));
  const myBank = bank.find((b) => b.guild_id === guild?.id);
  mount(root, html`
    <div class="card-head"><h1 style="font-size:28px">${guild?.name ?? '길드'}</h1>${guild?.tag ? html`<span class="chip hwang mono">${guild.tag}</span>` : ''}<span class="end mono dim">길드원 ${n(count || roster.length)}명</span></div>
    <div class="guild-wrap">
      <section class="card game-panel"><h2>길드 정보</h2>
        ${guild?.description ? html`<p class="note">${guild.description}</p>` : ''}
        <div class="g2" style="gap:8px">
          <div class="stat"><small>주 리액터</small><strong class="mono">${guild?.primary_reactor_id ?? '—'}</strong></div>
          <div class="stat"><small>가입 변전소</small><strong class="mono">${guild?.entry_substation_id ?? '—'}</strong></div>
          <div class="stat"><small>기본 수수료</small><strong>${guild?.default_commission ? n(Number(guild.default_commission) * 100, 1) + '%' : '—'}</strong></div>
          <div class="stat"><small>길드 은행 담보율</small><strong class="c-cheong">${myBank ? n(myBank.ratio, 3) : '—'}</strong></div>
        </div>
        <a class="btn ghost" href="${href('/chat')}">길드 통신 열기</a>
      </section>
      <section class="card game-panel"><h2>길드원 · 알파 순</h2>
        <ol class="standings">${sorted.slice(0, 20).map((m, i) => html`<li class="${m.id === pid ? 'me' : ''}"><span class="rk mono">${i + 1}</span>${raw(portraitHtml(m.pfp, 32))}<div><b>${m.username || m.id}</b><small class="mono">알파 ${micro(m.alpha_p ?? m.alpha, 1)} g</small></div>${m.id === pid ? html`<span class="chip cheong">나</span>` : ''}</li>`)}</ol>
        ${sorted.length ? '' : html`<p class="empty">길드원 정보가 없습니다.</p>`}
      </section>
    </div>`);
  setTiles([{ label: '길드원', value: n(count || roster.length) }, { label: '담보율', value: myBank ? n(myBank.ratio, 3) : '—', tone: 'var(--cheong-hi)' }]);
  return () => setTiles([]);
}
