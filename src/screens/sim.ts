/* 전투 시뮬레이터: structsd's combat rules run locally (src/sim/chain.ts, ported from
 * structs-xyz/structs-universe), so nothing is sent anywhere. The fight plays on the game's own
 * battle board (src/game/map) with the official attack, impact and destroy animations; a block is
 * only produced once the last one's animations have played, so every shot can be followed.
 * The daily engagement and its ladder come from the guild (REQ-SIM-1); until then the daily is
 * seeded from today's date.
 *
 * 실시간 대전 (?duel=<player> to host, ?join=<match>&room=<room> to answer): the other fleet is a
 * person's. The host's loop is the chain's clock and plays the guest's moves in place of the computer;
 * the guest replays the host's blocks on its own chain (src/sim/live.ts over src/chat/duel.ts) and sees
 * the battle from its own side, its fleet on the left as `me`. */
import type { Screen } from '../router';
import { share } from '../social/share';
import { href, go, current } from '../router';
import { html, mount, n, raw, toast, type Safe } from '../ui/dom';
import { Chain, type Msg, type AttackDetail, type SimStruct, type Block } from '../sim/chain';
import { Ai, type Difficulty } from '../sim/ai';
import { CPU, YOU, MAX_CHARGE, chainSetup, dailyScenario, layout, encodeReplay, decodeReplay, fits, unitId, GAUNTLET_ROUNDS, gauntletEnemy, reinforcementOffers, FLEET_TYPES, type Preset, type Unit } from '../sim/fleets';
import { daily } from '../api/planned';
import { STRUCT_TYPE, AMBIT } from '../i18n/ko';
import { COMMAND_SHIP_ID, TYPES_BY_ID, AMBITS, AMBIT_FLAG, type WeaponSystem, type Ambit } from '../data/catalogue';
import { spriteHtml } from '../game/map/art';
import { Board, type BoardStruct } from '../game/map/board';
import { career } from '../game/progress';
import { sfx } from '../game/sfx';
import { banner, notify, callout } from '../game/fx';
import { keys } from '../game/keys';
import { demo, withAllies } from '../game/demo';
import { MISSIONS, missionUnits, recordClear, unlocked } from '../game/campaign';
import { DIFFICULTY_KO } from './sim-labels';
import { rivalFleet, raidSeed } from './galaxy';
import { music } from '../game/music';
import { estimateOdds } from '../game/odds';
import { DAILY_CHARGE, TWIST_KO, dailyNo, encodeDaily, kstDay, nameKo, playDaily, playable, type DailyResult } from '../sim/daily';
import { dailySim } from '../game/dailysim';
import { webRoot } from '../core/desktop';
import { session } from '../api/session';
import { guildApi, type StructRow } from '../api/guild';
import { GuestLink, HostLink, LIVE_BLOCK_MS, OFFER_TTL_MS, PING_MS, battleOf, bothReady, guestLobby, hostLobby, lobbyFrame, lobbyStep, openBattle, toLocal, toWinner, type Battle, type EndWhy, type Frame, type Lobby, type Peer, type Role } from '../sim/live';
import { h2h, joinDuel, offerDuel, recordH2H, statusOf, type DuelLink, type H2H } from '../chat/duel';

type Phase = 'setup' | 'deploy' | 'battle' | 'debrief';
interface Side { lost: number; attacks: number; damage: number; evaded: number; blocked: number; counter: number }
const zero = (): Side => ({ lost: 0, attacks: 0, damage: 0, evaded: 0, blocked: 0, counter: 0 });

const MODES: [string, string, string][] = [
  ['single', '단판', '내 함대 대 컴퓨터 함대 단판 승부.'],
  ['daily', '일일 교전', '모든 사령관이 같은 시드로 겨룹니다.'],
  ['gauntlet', '연전', '5연전. 살아남은 함대가 피해를 안고 다음 전투로 갑니다. 승리마다 증원 1기.'],
];
const ROUND_KO = ['초계', '정찰대', '매복', '봉쇄', '대함대'];
const cost = (type: number) => TYPES_BY_ID[type]?.buildDifficulty ?? 0;
const pixel = (type: number, size = 48): Safe => raw(spriteHtml(type, size));
const PRESET_KO: Record<Preset, string> = { easy: '4기', difficult: '8기', hard: '12기', random: '무작위 6–16' };
const DIFF_KO = DIFFICULTY_KO;
const DIFF_XP: Record<Difficulty, number> = { easy: 40, difficult: 80, hard: 140 };
const WHY_KO: Record<EndWhy, string> = { fleet: '지휘함 격파', stall: '잔여 내구도 판정', forfeit: '기권', gone: '응답 없음' };
const LOBBY_WHY_KO: Record<NonNullable<Lobby['why']>, string> = { declined: '상대가 신청을 거절했습니다.', taken: '다른 사령관이 먼저 입장했습니다.', left: '상대가 대기실을 나갔습니다.', cancelled: '상대가 대전을 취소했습니다.' };
/** A live match on this screen: which side, the link, the lobby, and the chain link once it is on. */
interface Duel {
  role: Role; phase: 'lobby' | 'battle' | 'over'; lobby: Lobby | null; link: DuelLink | null;
  me: Peer; peer: Peer | null; fleet: 'mirror' | 'random' | 'from';
  host?: HostLink; guest?: GuestLink; why?: EndWhy; note?: string; h2h?: H2H; resentAt?: number;
}

/* `mine`: which side is drawn on the left as yours (the guest of a live duel plays `computer`). */
const fromUnit = (u: Unit, mine: Unit['side'] = 'player'): BoardStruct => {
  const t = TYPES_BY_ID[u.type];
  return { id: u.id, typeId: u.type, ambit: u.ambit, slot: u.slot, side: u.side === mine ? 'defender' : 'attacker', category: 'fleet', isCommand: u.type === COMMAND_SHIP_ID, health: u.health ?? t.maxHealth, maxHealth: t.maxHealth, protects: u.protects };
};
const fromSim = (c: Chain, s: SimStruct, me = YOU.id): BoardStruct => ({
  id: s.id, typeId: s.typeId, ambit: s.ambit, slot: s.slot, side: s.owner === me ? 'defender' : 'attacker', category: 'fleet', hidden: c.isHidden(s),
  isCommand: s.typeId === COMMAND_SHIP_ID, health: c.isDestroyed(s) ? 0 : s.health, maxHealth: c.typeOf(s).maxHealth, protects: s.protectedStructId,
});

const screen: Screen = {
  render(root, params) {
    // Vassals are under your protection: no strikes on them from here.
    // Not your vassal, not your ally.
    const raidOn = !demo.on ? null : params.get('raid') === 'void' ? demo.boss : demo.rivals().find((r) => r.id === params.get('raid') && r.vassal == null && r.id !== demo.ally?.id) ?? null;
    const mission = MISSIONS.find((m) => m.id === params.get('mission') && unlocked(m)) ?? null;
    let raidIds: Record<string, string> = {}, loot: { ore: number; alpha?: number; promoted?: { id: string; type: number; rank: number; name?: string }[] } | null = null;
    // The war room's estimate for this strike: wins out of plays, filled in a battle at a time.
    let odds: { won: number; played: number } | null = null, stopOdds: (() => void) | null = null;
    /** ?vs=<player>: a forecast against a real commander's fleet, with yours. */
    let vsInfo: { id: string; name: string } | null = null;
    /** ?from=<replay>: the same fleets and seed, played fresh; the debrief compares with theirs. */
    let rival: { title: string; winner?: string; blocks?: number } | null = null;
    /** 실시간 대전: the match, and whose side this screen sees the battle from (the guest's is `computer`). */
    let duel: Duel | null = null, meId = YOU.id, foeId = CPU.id, mySide: Unit['side'] = 'player';
    let duelTimer: ReturnType<typeof setInterval> | null = null, wake: (() => void) | null = null, forfeitArmed = false, fromTitle: string | undefined;
    let phase: Phase = 'setup', mode = 'single', preset: Preset = 'difficult', diff: Difficulty = 'difficult';
    let blockMs = 2000, charge = 10, seed = 'KR-' + Math.random().toString(36).slice(2, 7).toUpperCase();
    let units: Unit[] = [];
    let chain: Chain | null = null, ai: Ai | null = null, auto: Ai | null = null;
    let running = false, paused = false, autopilot = false, mult = 1, quiet = 0;
    let log: { h: number; text: string; tone: string }[] = [];
    let stats = { player: zero(), computer: zero() }, blocks = 0, winner: 'player' | 'computer' | 'draw' | null = null, stars = 0, xpWon = 0;
    // Kill streaks: kills within 6 blocks (about one weapon charge) of each other chain; each link is worth a little XP.
    let streak = 0, lastKill = -99, streakXp = 0;
    // Who did the work on your side: damage and kills by unit (chain id → its type), for the MVP.
    let ace: Record<string, { type: number; dmg: number; kills: number; id?: string }> = {};
    let picked: string | null = null, ws: WeaponSystem = 'primaryWeapon', queued: Msg | null = null, guard = false, moving = false;
    let ladder: Awaited<ReturnType<typeof daily>> | null = null;
    // 일일 교전: which day (today unless the daily screen sent a past one), and the scored result.
    let dailyDay: string | null = null, dailyRes: (DailyResult & { code: string; best: boolean }) | null = null;
    const theDay = () => dailyDay ?? kstDay();
    let board: Board | null = null;
    /* Every order, by the block it lands in: the battle replays exactly from these (chain is seeded). */
    let orders: { height: number; signer: string; msg: Msg }[] = [];
    let replaying = false, replayOrders: typeof orders = [];
    let idMap: Record<string, string> = {};
    let run: { round: number; fleet: Unit[]; seed: string; offers: { type: number; ambit: Ambit; slot: number }[] | null; over: boolean; won: boolean } | null = null;
    let editing: { ambit: Ambit; slot: number; unit: Unit | null } | null = null;
    /** The enemy fleet's value plus 15% commander's discretion. */
    const budget = () => Math.round(units.filter((u) => u.side === 'computer').reduce((a, u) => a + cost(u.type), 0) * 1.15);
    const spent = () => units.filter((u) => u.side === 'player').reduce((a, u) => a + cost(u.type), 0);

    const side = (owner: string) => (owner === meId ? 'player' : 'computer');
    const toBoard = (u: Unit) => fromUnit(u, mySide);
    const simBoard = (c: Chain) => Object.values(c.structs).map((s) => fromSim(c, s, meId));
    /** A live duel's battle is on (not a replay of it). */
    const battling = () => !replaying && duel?.phase === 'battle';
    const typeName = (id: string) => { const s = chain?.get(id); return s ? STRUCT_TYPE[s.typeId] ?? String(s.typeId) : id; };
    const newBoard = () => {
      board?.dispose();
      board = new Board({
        speed: (blockMs < 4000 ? 1.6 : 1.2) * mult, label: '전투 시뮬레이터', maxHeight: () => innerHeight - 250,
        onPick: (id, s) => (phase === 'deploy' ? deployPick(id, s) : s === 'defender' ? pick(id) : target(id)),
        onTile: (key, ambit, s) => {
          if (phase === 'battle' && moving && picked && s === 'defender' && chain && !replaying) {
            const [kind, , , slot] = key.split('|');
            order({ '@type': '/structs.structs.MsgStructMove', structId: picked, locationType: 'fleet', ambit, slot: kind === 'cmd' ? 0 : Number(slot) });
            sfx.play('confirm'); notify('이동 명령', `${typeName(picked)} → ${AMBIT[ambit]}${kind === 'cmd' ? '' : ' ' + (Number(slot) + 1)} · 다음 블록`, 'cheong', null);
            moving = false; board?.markTiles([]); paint();
            return;
          }
          if (phase !== 'deploy' || mode !== 'single' || raidOn || mission || duel || s !== 'defender' || !key.startsWith('fleet|')) return;
          editing = { ambit, slot: Number(key.split('|')[3]), unit: null }; paint();
        },
      });
      return board;
    };

    /** My order for the next block. A duel's guest sends it to the host now: it lands in the host's next block. */
    const order = (m: Msg) => { queued = m; if (battling() && duel!.guest && duel!.link) duel!.link.send(duel!.guest.move(m)); };

    /* ── 실시간 대전 ── */
    const peerName = () => duel?.peer?.name ?? '상대';
    const nameOf = async (id: string) => (await guildApi.player(id).catch(() => null))?.username || id;
    /** The battle the lobby agreed on: fleets, seed, charge and block time. */
    const adopt = (b: Battle) => {
      const o = openBattle(b);
      if (!o) return;
      const same = seed === o.seed && JSON.stringify(units) === JSON.stringify(o.units);
      units = o.units; seed = o.seed; charge = o.charge; blockMs = o.blockMs;
      if (!same && phase === 'deploy') newBoard().setStructs(units.map(toBoard));
    };
    /** Silence becomes a forfeit: checked every second while someone should be talking. */
    const watchDuel = () => {
      if (duelTimer) clearInterval(duelTimer);
      let shown: number | null = null;
      duelTimer = setInterval(() => {
        const d = duel;
        if (!d?.link || !root.isConnected) return;
        const now = Date.now(), fighting = d.phase === 'battle' && !replaying;
        const waiting = d.phase === 'lobby' && !!d.lobby && (d.lobby.state === 'joined' || (d.role === 'guest' && d.lobby.state === 'offered'));
        if (!fighting && !waiting) return;
        if (d.link.dog.gone(now)) {
          if (fighting) { log.unshift({ h: chain?.height ?? 0, text: `${peerName()} 응답 없음 · 기권 처리`, tone: 'c-warn' }); finish('player', 'gone'); return; }
          d.link.close(); d.link = null;
          d.lobby = d.lobby ? { ...d.lobby, state: 'cancelled', why: 'left' } : null;
          d.note = d.role === 'guest' && !d.peer ? '상대가 대전 화면에 없습니다. 신청이 만료되었을 수 있습니다.' : `${peerName()} 님이 응답하지 않습니다.`;
          paint();
          return;
        }
        const c = d.link.dog.countdown(now);
        if (c !== shown) { shown = c; paint(); }
      }, 1000);
    };
    const linkChip = (): Safe | string => {
      const l = duel?.link;
      if (!l) return '';
      const now = Date.now(), c = l.dog.countdown(now);
      return c != null ? html`<span class="chip jeok mono">${peerName()} 응답 없음 · ${c}초 후 기권</span>`
        : l.dog.quiet(now) > PING_MS * 1.5 || l.failing ? html`<span class="chip hwang mono">연결 지연</span>` : html`<span class="chip cheong mono">연결됨</span>`;
    };
    /** The host, both ready: the fleets go and the battle begins on both sides. */
    const beginHost = () => {
      const d = duel!;
      d.link!.send({ kind: 'start', battle: d.lobby!.battle! });
      start();
    };
    const onDuelFrame = (f: Frame, sender: string) => {
      const d = duel;
      if (!d?.link) return;
      switch (f.kind) {
        case 'ping': return;
        case 'tick': {
          if (!d.guest) return;
          d.guest.receive(f);
          // A block went missing on the way: ask for it again (not more than every few seconds).
          const gap = d.guest.gap();
          if (gap != null && Date.now() - (d.resentAt ?? 0) > 3000) { d.resentAt = Date.now(); d.link.send({ kind: 'resend', from: gap }); }
          wake?.();
          return;
        }
        case 'move': d.host?.move(f); return;
        case 'resend': if (d.host) for (const r of d.host.resend(f.from)) d.link.send(r); return;
      }
      if (d.phase === 'battle') {
        if (f.kind === 'leave') { log.unshift({ h: chain?.height ?? 0, text: `${peerName()} 기권`, tone: 'c-warn' }); finish('player', 'forfeit'); }
        else if (f.kind === 'end' && d.role === 'guest') finish(toLocal(f.winner, 'guest'), f.why);
        return;
      }
      if (d.phase !== 'lobby' || !d.lobby) return;
      const before = d.lobby, next = lobbyStep(before, f);
      d.lobby = next;
      if (d.role === 'host') {
        if (f.kind === 'accept' && next.state === 'joined' && next.guest?.id === f.guest.id) {
          d.link.peer = sender; d.peer = next.guest;
          if (before.state !== 'joined') { sfx.play('confirm'); notify('대전 입장', `${f.guest.name} 님이 들어왔습니다 · 준비하세요`, 'hwang', null); }
        }
        // The seat, the fleets and who is ready, after every change (and to a guest asking again).
        if (next !== before || f.kind === 'accept') d.link.send(lobbyFrame(next));
      } else {
        if (!d.link.peer) d.link.peer = sender;
        if (next.host) d.peer = next.host;
        if (next.battle) adopt(next.battle);
      }
      if (next.state === 'cancelled') { d.link.close(); d.link = null; if (duelTimer) { clearInterval(duelTimer); duelTimer = null; } }
      else if (d.role === 'guest' && next.state === 'live') { adopt(next.battle!); start(); return; }
      else if (d.role === 'host' && bothReady(next)) { beginHost(); return; }
      paint();
    };
    /** ?duel=<player>: this side hosts. The fleets are mirrored unless ?from= brought a battle's. */
    const hostDuel = async (to: string, from: { units: Unit[]; seed: string; charge: number } | null) => {
      const pid = session.playerId;
      if (!pid) { toast('실시간 대전은 로그인 후에 할 수 있습니다', 4000); paint(); return; }
      if (to === pid) { toast('자기 자신에게는 대전을 신청할 수 없습니다', 4000); paint(); return; }
      const [mine, theirs] = await Promise.all([nameOf(pid), nameOf(to)]);
      duel = { role: 'host', phase: 'lobby', lobby: null, link: null, me: { id: pid, name: mine }, peer: { id: to, name: theirs }, fleet: from ? 'from' : 'mirror', h2h: h2h(to) };
      if (from) { units = from.units; seed = from.seed; charge = from.charge; }
      else { seed = 'DUEL-' + Math.random().toString(36).slice(2, 7).toUpperCase(); units = layout('difficult', seed); charge = 10; }
      blockMs = 4000; run = null; chain = null; phase = 'deploy';
      newBoard().setStructs(units.map(toBoard));
      paint();
    };
    /** ?join=<match>&room=<room>: this side answers. It plays the `computer` fleet, drawn as its own. */
    const guestDuel = async (match: string, room: string) => {
      const pid = session.playerId;
      if (!pid) { toast('실시간 대전은 로그인 후에 할 수 있습니다', 4000); paint(); return; }
      meId = CPU.id; foeId = YOU.id; mySide = 'computer';
      const me: Peer = { id: pid, name: await nameOf(pid) };
      const d: Duel = { role: 'guest', phase: 'lobby', lobby: guestLobby(match, me), link: null, me, peer: null, fleet: 'from', note: '대기실에 들어가는 중…' };
      duel = d;
      units = []; chain = null; run = null; phase = 'deploy';
      newBoard().setStructs([]);
      paint();
      try {
        const { link, offer } = await joinDuel(match, room);
        if (duel !== d) { link.close(); return; }
        const st = statusOf(match);
        const stale = st === 'live' ? '이미 진행 중인 대전입니다.' : st === 'ended' || st === 'cancelled' ? '이미 끝난 대전입니다.'
          : offer && offer.frame.to && offer.frame.to !== pid ? '다른 사령관에게 온 신청입니다.' : offer && Date.now() - offer.frame.at > OFFER_TTL_MS ? '만료된 신청입니다.' : null;
        if (stale) { link.close(); d.lobby = { ...d.lobby!, state: 'cancelled' }; d.note = stale; paint(); return; }
        d.link = link;
        link.onFrame(onDuelFrame);
        if (offer) { d.lobby = lobbyStep(d.lobby!, offer.frame); d.peer = offer.frame.host; adopt(offer.frame.battle); }
        d.h2h = d.peer ? h2h(d.peer.id) : undefined;
        link.send({ kind: 'accept', guest: me });
        d.note = undefined;
        watchDuel();
      } catch (e) { d.note = (e as Error).message; d.lobby = { ...d.lobby!, state: 'cancelled' }; }
      paint();
    };
    /* A duel's result: the head-to-head record and a little XP for beating a person. No stars, no ladder. */
    const settleDuel = (w: 'player' | 'computer' | 'draw', why: EndWhy) => {
      const d = duel!;
      stars = 0; dailyRes = null;
      career.bump('simBattles');
      career.bump('kills', stats.computer.lost);
      if (d.peer) d.h2h = recordH2H(d.peer.id, w === 'player' ? 'w' : w === 'computer' ? 'l' : 'd');
      xpWon = (w === 'player' ? 120 : 0) + stats.computer.lost * 5 + streakXp;
      if (w === 'player') {
        career.bump('simWins');
        sfx.play('victory');
        banner({ kicker: `${blocks}블록 · ${WHY_KO[why]}`, title: '대전 승리', sub: `${peerName()} 님을 꺾었습니다`, tone: 'gold', ms: 3000 });
      } else {
        sfx.play('defeat');
        banner({ kicker: `${blocks}블록 · ${WHY_KO[why]}`, title: w === 'computer' ? '대전 패배' : '무승부', sub: w === 'computer' ? `${peerName()} 님의 승리` : '양측 모두 버텼습니다', tone: 'jeok', ms: 2600 });
      }
      if (xpWon) setTimeout(() => career.award(xpWon, `실시간 대전 · ${peerName()}`), 1200);
      phase = 'debrief';
      paint();
    };

    const pick = (id: string) => {
      if (!chain || phase !== 'battle' || replaying) return;
      const s = chain.get(id);
      if (!s || chain.isDestroyed(s)) return;
      // Guard mode: the selected struct takes up defense of the one clicked (MsgStructDefenseSet).
      if (guard && picked && picked !== id) {
        const d = chain.get(picked)!;
        if (!chain.canDefend(d)) { sfx.play('error'); notify('방어 불가', `${typeName(picked)}은(는) 방어를 맡을 수 없습니다`, 'jeok', null); return; }
        order({ '@type': '/structs.structs.MsgStructDefenseSet', defenderStructId: picked, protectedStructId: id });
        sfx.play('shield');
        notify('방어 지정', `${typeName(picked)} → ${typeName(id)} 보호 · 다음 블록`, 'cheong', null);
        guard = false; markTargets(); paint();
        return;
      }
      picked = picked === id ? null : id;
      guard = false; moving = false; board?.markTiles([]);
      board?.select(picked);
      markTargets();
      paint();
    };
    const markTargets = () => {
      if (!board || !chain) return;
      const me = picked ? chain.get(picked) : null;
      if (guard && me) { board.markTargets(Object.values(chain.structs).filter((t) => t.owner === meId && t.id !== me.id && !chain!.isDestroyed(t) && chain!.isProtecting(me, t)).map((t) => t.id)); return; }
      board.markTargets(me ? Object.values(chain.structs).filter((t) => t.owner === foeId && !chain!.isDestroyed(t) && !chain!.canAttack(me, t, ws)).map((t) => t.id) : []);
    };
    const target = (id: string) => {
      if (!chain || !picked || phase !== 'battle' || replaying) return;
      const why = chain.canAttack(chain.get(picked)!, chain.get(id)!, ws);
      if (why) { sfx.play('error'); log.unshift({ h: chain.height, text: `공격 불가: ${why}`, tone: 'c-warn' }); paint(); return; }
      order({ '@type': '/structs.structs.MsgStructAttack', operatingStructId: picked, targetStructId: [id], weaponSystem: ws });
      sfx.play('confirm');
      notify('사격 명령', `${typeName(picked)} → ${typeName(id)} · 다음 블록`, 'cheong', null);
      paint();
    };

    const deployPick = (id: string, s: string) => {
      if (mode !== 'single' || raidOn || mission || duel || s !== 'defender') return;
      const u = units.find((x) => x.id === id);
      if (!u) return;
      if (u.type === COMMAND_SHIP_ID) { notify('지휘함', '지휘함은 교체할 수 없습니다. 잃으면 패배합니다.', 'hwang', 'error'); return; }
      editing = { ambit: u.ambit, slot: u.slot, unit: u }; paint();
    };
    const syncDeploy = () => board?.setStructs(units.map(toBoard));

    const start = () => {
      // A replay plays the fleets as they were recorded, whatever today's budget says.
      if (!replaying && mode === 'single' && !raidOn && !mission && !duel && spent() > budget()) { sfx.play('error'); notify('편성 초과', `함대 점수 ${spent()} / ${budget()} — 유닛을 줄이세요`, 'jeok', null); return; }
      editing = null; stopOdds?.();
      if (raidOn?.id === 'void' && !replaying) {
        // It may have moved on while you were deploying.
        if (!demo.boss) { sfx.play('error'); notify('공허 함대', '이미 떠났습니다', 'jeok', null); go('/galaxy'); return; }
        demo.holdBoss();
      }
      if (!replaying) orders = [];
      const cs = chainSetup(units, seed, { player: charge, computer: charge });
      const setup = cs.setup; idMap = cs.idMap;
      chain = new Chain(setup);
      ai = new Ai(foeId, diff, seed); auto = new Ai(meId, 'hard', seed + ':you');
      // A live duel: the host's blocks go out as they are made; the guest's come in instead of being made.
      if (duel && !replaying) {
        duel.phase = 'battle';
        if (duel.role === 'host') duel.host = new HostLink(duel.lobby!.match, chain); else duel.guest = new GuestLink(duel.lobby!.match, chain);
      }
      log = []; stats = { player: zero(), computer: zero() }; blocks = 0; quiet = 0; winner = null; picked = null; queued = null; paused = false; stars = 0; xpWon = 0; streak = 0; lastKill = -99; streakXp = 0; ace = {};
      phase = 'battle';
      newBoard().setStructs(simBoard(chain));
      sfx.play('alarm');
      banner({ kicker: duel && !replaying ? `실시간 대전 · ${duel.peer?.name ?? '상대'}` : `시드 ${seed}`, title: '교전 개시', sub: '내 유닛 → 적 유닛 순서로 눌러 사격', tone: 'jeok', ms: 1800 });
      paint();
      running = true;
      music.setMode('battle');
      void loop(++runGen);
    };

    /* One block per beat, but never ahead of the animations: the board is the clock. */
    // Each battle's loop knows its generation: a rematch started while the last loop sleeps ends it.
    let runGen = 0;
    const loop = async (gen: number) => {
      const live = () => running && gen === runGen && root.isConnected;
      while (live()) {
        // A duel's guest moves when the host's next block is here, not on its own clock.
        if (battling() && duel!.guest) await new Promise<void>((r) => { wake = r; setTimeout(r, 1000); });
        else await sleep(blockMs / (duel && !replaying ? 1 : mult));
        wake = null;
        if (!live()) return;
        if (paused && !battling()) continue;
        await board?.idle();
        if (!live()) return;
        tick();
      }
    };

    const tick = () => {
      if (!chain || winner) return;
      // The animations have landed; the chain's state is the truth again.
      const g = battling() ? duel!.guest : undefined, h = battling() ? duel!.host : undefined;
      board?.setStructs(simBoard(chain));
      let b: Block;
      if (g) {
        const r = g.next();
        if (!r) return;
        b = r.block;
        for (const x of r.subs) orders.push({ height: b.height, signer: x.signer, msg: x.msg });
        if (!r.ok && g.desync === b.height) log.unshift({ h: b.height, text: '동기화 경고 · 상대 체인과 상태가 다릅니다', tone: 'c-warn' });
        // My order made it into a block: nothing waits any more.
        if (!g.pending) queued = null;
      } else {
        if (replaying) {
          for (const o of replayOrders.filter((x) => x.height === chain!.height + 1)) chain.submit(o.signer, o.msg);
        }
        const mine = replaying ? null : autopilot ? auto!.decide(chain) : queued;
        queued = null;
        if (h) {
          // The host: my order and the guest's latest, one block, and the tick that tells the guest.
          const r = h.step(mine);
          b = r.block;
          for (const x of r.subs) orders.push({ height: b.height, signer: x.signer, msg: x.msg });
          duel!.link?.send(r.frame);
        } else {
          if (mine) { orders.push({ height: chain.height + 1, signer: YOU.id, msg: mine }); chain.submit(YOU.id, mine); }
          const theirs = replaying ? null : ai!.decide(chain);
          if (theirs) { orders.push({ height: chain.height + 1, signer: CPU.id, msg: theirs }); chain.submit(CPU.id, theirs); }
          b = chain.produceBlock();
        }
      }
      blocks++; quiet++;
      for (const tx of b.txs) {
        const who = side(tx.signer);
        if (!tx.ok) { if (who === 'player') log.unshift({ h: b.height, text: `명령 거부: ${tx.error}`, tone: 'c-warn' }); continue; }
        if (tx.msg['@type'] === '/structs.structs.MsgStructMove') log.unshift({ h: b.height, text: `${who === 'player' ? '아군' : '적'} ${typeName(tx.msg.structId)} → ${AMBIT[tx.msg.ambit]} 이동`, tone: who === 'player' ? 'c-cheong' : 'c-jeok' });
        if (tx.msg['@type'] === '/structs.structs.MsgStructStealthActivate' || tx.msg['@type'] === '/structs.structs.MsgStructStealthDeactivate') log.unshift({ h: b.height, text: `${who === 'player' ? '아군' : '적'} ${typeName(tx.msg.structId)} ${tx.msg['@type'].endsWith('Activate') ? '은신' : '은신 해제'}`, tone: 'c-warn' });
        if (tx.msg['@type'] === '/structs.structs.MsgStructDefenseSet') log.unshift({ h: b.height, text: `${who === 'player' ? '아군' : '적'} ${typeName(tx.msg.defenderStructId)} → ${typeName(tx.msg.protectedStructId)} 방어 지정`, tone: who === 'player' ? 'c-cheong' : 'c-jeok' });
        for (const ev of tx.events) {
          if (ev.category !== 'struct_attack') continue;
          const d = ev.detail as AttackDetail;
          quiet = 0;
          board?.playAttack(d);
          stats[who].attacks++;
          for (const shot of d.eventAttackShotDetail || []) {
            const dmg = Math.max(0, (shot.targetHealthBefore ?? 0) - (shot.targetHealthAfter ?? 0));
            const them = side(shot.targetPlayerId);
            stats[who].damage += dmg;
            if (who === 'player') { const a = (ace[d.attackerStructId] ??= { type: chain.get(d.attackerStructId)?.typeId ?? 0, dmg: 0, kills: 0, id: d.attackerStructId }); a.dmg += dmg; if (shot.targetDestroyed) a.kills++; }
            if (shot.evaded) stats[them].evaded++;
            if (shot.blocked) stats[them].blocked++;
            if (shot.targetDestroyed) stats[them].lost++;
            if (shot.targetDestroyed && who === 'player' && !replaying) {
              streak = b.height - lastKill <= 6 ? streak + 1 : 1; lastKill = b.height;
              if (streak >= 2) {
                streakXp += 10 * (streak - 1);
                const n = streak, t = n === 2 ? '더블 격파!' : n === 3 ? '트리플 격파!' : `연쇄 격파 ×${n}!`;
                void board?.idle().then(() => { if (root.isConnected) { callout(t, n >= 4 ? 'jeok' : 'gold'); sfx.play(n >= 3 ? 'levelup' : 'coin'); } });
              }
            }
            // The target's own counter and its death blast can destroy the attacker too: a kill for the target.
            // (A blocker's death blast is the blocker's kill, not the struct it shielded.)
            const credit = (sid: string | undefined, dmg: number) => {
              if (!sid) return;
              stats[who].lost++;
              if (them === 'player' && !replaying) { const a = (ace[sid] ??= { type: chain!.get(sid)?.typeId ?? 0, dmg: 0, kills: 0, id: sid }); a.kills++; a.dmg += dmg; }
            };
            if (shot.targetCounterDestroyedAttacker) credit(shot.targetStructId, shot.targetCounteredDamage ?? 0);
            else if (shot.postDestructionDamageDestroyedAttacker) credit(shot.blocked ? shot.blockedByStructId : shot.targetStructId, shot.postDestructionDamage ?? 0);
            for (const c of shot.eventAttackDefenderCounterDetail || []) {
              stats[them].counter += c.counterDamage || 0;
              // A guard's counter that kills the attacker is a kill for the guard (MVP and veterancy too).
              if (c.counterDestroyedAttacker) stats[who].lost++;
              if (them === 'player' && !replaying) { const a = (ace[c.counterByStructId] ??= { type: chain.get(c.counterByStructId)?.typeId ?? 0, dmg: 0, kills: 0, id: c.counterByStructId }); a.dmg += c.counterDamage || 0; if (c.counterDestroyedAttacker) a.kills++; }
            }
            const what = shot.evaded ? '회피' : shot.blocked ? `차단 (${STRUCT_TYPE[chain.get(shot.blockedByStructId!)?.typeId ?? 0] ?? '방어자'})` : shot.targetDestroyed ? '격파!' : `피해 ${dmg}`;
            log.unshift({ h: b.height, text: `${who === 'player' ? '아군' : '적'} ${typeName(d.attackerStructId)} → ${typeName(shot.targetStructId)} · ${what}`, tone: shot.targetDestroyed ? 'c-hwang' : who === 'player' ? 'c-cheong' : 'c-jeok' });
          }
        }
      }
      log = log.slice(0, 40);
      // The guest's autopilot answers each block it sees, as the host's does when it makes one.
      if (g && autopilot && !winner) { const m = auto!.decide(chain); if (m) order(m); }
      if (picked && chain.isDestroyed(chain.get(picked)!)) { picked = null; board?.select(null); }
      markTargets();
      // Moves and stealth show as soon as this block's animations have played.
      const settled = chain;
      void board?.idle().then(() => { if (chain === settled && board) board.setStructs(simBoard(settled)); });
      const fleets = chain.fleetsAtBattle();
      if (fleets.length < 2) finish(fleets.includes(chain.players[meId].fleetId) ? 'player' : fleets.includes(chain.players[foeId].fleetId) ? 'computer' : 'draw', 'fleet');
      // A duel's stalemate is the host's to call (its `end` says how it went).
      else if (!g && (blocks > 400 || quiet > 40)) {
        // A stalled fight is decided on hull, as in structs-xyz: the fleet with more of itself left wins.
        const me = hull(meId), them = hull(foeId);
        const a = me.hp / Math.max(1, me.max), b = them.hp / Math.max(1, them.max);
        const w = Math.abs(a - b) < 0.02 ? 'draw' : a > b ? 'player' : 'computer';
        log.unshift({ h: chain.height, text: `${quiet > 40 ? '교착' : '시간 초과'} · 잔여 내구도 판정 ${Math.round(a * 100)}% 대 ${Math.round(b * 100)}%`, tone: 'c-warn' });
        finish(w, 'stall');
      }
      paint();
    };

    const finish = (w: 'player' | 'computer' | 'draw', why: EndWhy = 'fleet') => {
      if (winner) return;
      running = false;
      music.setMode('calm');
      winner = w;
      const wasLive = battling();
      if (wasLive && duel) {
        duel.phase = 'over'; duel.why = why;
        // The host calls it for both; either way this side's link has done its work.
        if (duel.role === 'host') duel.link?.send({ kind: 'end', winner: toWinner(w, 'host'), why, height: chain?.height ?? 0 });
        duel.link?.close();
        if (duelTimer) { clearInterval(duelTimer); duelTimer = null; }
      }
      // Settle after the last explosion, but never later than a few seconds: a board disposed by
      // leaving mid-animation must not swallow the result (the clear, the loot, the XP).
      void Promise.race([board?.idle() ?? Promise.resolve(), sleep(4000)]).then(() => {
        const p = stats.player;
        stars = w !== 'player' ? 0 : 1 + (p.lost <= units.filter((u) => u.side === mySide).length / 3 ? 1 : 0) + (blocks < 60 ? 1 : 0);
        // A replay is for watching: no records, rewards or settlements.
        if (replaying) { replaying = false; sfx.play(w === 'player' ? 'victory' : 'defeat'); phase = 'debrief'; paint(); return; }
        if (wasLive && duel) { settleDuel(w, why); return; }
        career.bump('simBattles');
        career.bump('kills', stats.computer.lost);
        if (mode === 'daily' && !mission && !raidOn) {
          career.bump('dailyPlays');
          // Score it the way anyone who opens the link will: replay your orders on a fresh chain.
          const day = theDay();
          const mine = orders.filter((o) => o.signer === YOU.id).map((o) => ({ height: o.height, msg: o.msg }));
          const r = playDaily(day, mine);
          if (r) {
            if (r.winner !== w) console.warn('daily replay disagrees with the live battle', r.winner, w);
            const code = encodeDaily({ day, name: dailySim.name, orders: mine });
            const best = dailySim.record(r, code);
            dailyRes = { ...r, code, best };
            stars = r.stars;
          }
        } else dailyRes = null;
        if (w === 'player') {
          career.bump('simWins');
          if (stars > career.stats.simStars) career.bump('simStars', stars - career.stats.simStars);
          if (stars === 3) career.bump('perfect');
          sfx.play('victory');
          banner({ kicker: `${blocks}블록 · 격파 ${stats.computer.lost}`, title: stars === 3 ? '완벽한 승리' : '승리', sub: '★'.repeat(stars) + '☆'.repeat(3 - stars), tone: 'gold', ms: 3000 });
          xpWon = DIFF_XP[diff] + stars * 20 + stats.computer.lost * 5 + streakXp;
          setTimeout(() => career.award(xpWon, `모의전 승리 · ${DIFF_KO[diff]}`), 1200);
        } else {
          sfx.play('defeat');
          banner({ kicker: `${blocks}블록`, title: w === 'computer' ? '패배' : '무승부', sub: w === 'computer' ? '지휘함을 잃었습니다' : '양측 모두 버텼습니다', tone: 'jeok', ms: 2600 });
          xpWon = stats.computer.lost * 5 + streakXp;
          if (xpWon) setTimeout(() => career.award(xpWon, '교전 경험'), 1200);
        }
        if (mission && w === 'player') {
          if (recordClear(mission.id, stars)) {
            setTimeout(() => career.award(mission.xp, `작전 ${mission.no} 완료 · ${mission.title}`), 1800);
            // A first clear also pays the demo base's treasury: the war chest grows with the campaign.
            if (demo.on) { const g = Math.round(mission.xp / 10); demo.grant(g, `작전 ${mission.no} 전리품`); setTimeout(() => notify('전리품', `작전 ${mission.no} 첫 승리 · 기지 금고 +${g} α`, 'hwang', 'coin'), 2600); }
          }
        }
        if (raidOn) {
          const hp: Record<string, number> = {};
          for (const u of units.filter((x) => x.side === 'player')) {
            const cs = chain?.get(idMap[u.id]);
            if (raidIds[u.id]) hp[raidIds[u.id]] = !cs || chain!.isDestroyed(cs) ? 0 : cs.health;
          }
          // Kills scored by your own ships stay with them (veterancy); an ally's don't.
          const kills: Record<string, number> = {};
          for (const [uid, sid] of Object.entries(raidIds)) { const k = ace[idMap[uid]]?.kills; if (k) kills[sid] = k; }
          loot = demo.settleRaid(raidOn.id, w === 'player', hp, kills);
          // A ship that went down in this raid keeps its record; its promotion says it needs repair.
          for (const v of loot.promoted ?? []) setTimeout(() => notify('베테랑 진급', `${v.name ? `「${v.name}」 ` : ''}${STRUCT_TYPE[v.type] ?? v.type} ${'★'.repeat(v.rank)}${hp[v.id] === 0 ? ' · 대파, 수리 필요' : ''}`, 'hwang', 'levelup'), 2400);
          if (w === 'player') setTimeout(() => career.award(80 + raidOn.fleet * 10, `${raidOn.name} 습격 성공`), 1600);
        }
        if (run) {
          if (w === 'player') {
            run.fleet = units.filter((u) => u.side === 'player').flatMap((u) => {
              const cs = chain?.get(idMap[u.id]);
              return !cs || chain!.isDestroyed(cs) ? [] : [{ ...u, health: cs.health, protects: null }];
            });
            if (run.round >= GAUNTLET_ROUNDS.length) {
              run.over = true; run.won = true; career.bump('gauntlets');
              setTimeout(() => { sfx.play('levelup'); banner({ kicker: '연전 5/5', title: '연전 제패', sub: '대함대를 꺾었습니다', tone: 'gold', ms: 3600 }); career.award(500, '연전 제패'); }, 3200);
            } else run.offers = reinforcementOffers(run.fleet, run.seed + ':r' + run.round);
          } else run.over = true;
        }
        phase = 'debrief';
        paint();
      });
    };

    const hull = (owner: string) => {
      if (!chain) return { hp: 0, max: 1, alive: 0, total: 0 };
      const mine = Object.values(chain.structs).filter((s) => s.owner === owner);
      return { hp: mine.reduce((a, s) => a + (chain!.isDestroyed(s) ? 0 : s.health), 0), max: mine.reduce((a, s) => a + chain!.typeOf(s).maxHealth, 0), alive: mine.filter((s) => !chain!.isDestroyed(s)).length, total: mine.length };
    };
    const strength = (who: 'you' | 'cpu'): Safe => {
      const h = hull(who === 'you' ? meId : foeId);
      const ch = chain?.chargeOf(who === 'you' ? meId : foeId) ?? 0;
      const pct = Math.round((h.hp / Math.max(1, h.max)) * 100);
      return html`<div class="bt-side ${who}">
        <div class="bt-name"><b>${who === 'you' ? '내 함대' : duel ? `${duel.peer?.name ?? '상대'} 함대` : `컴퓨터 · ${DIFF_KO[diff]}`}</b><span class="mono">${h.alive}/${h.total}기</span></div>
        <div class="bt-hull" role="meter" aria-label="함대 내구도" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><i style="width:${pct}%"></i><span class="mono">${h.hp} / ${h.max}</span></div>
        <div class="bt-charge" aria-label="충전 ${ch}">${Array.from({ length: 10 }, (_, i) => html`<i class="${i < Math.min(10, ch) ? 'on' : ''}"></i>`)}<span class="mono">충전 ${ch}</span></div>
      </div>`;
    };

    const pills = (list: [string, string][], cur: string, act: string) => html`<div style="display:flex;flex-wrap:wrap;gap:6px">${list.map(([v, l]) => html`<button class="pill ${cur === v ? 'on' : ''}" data-act="${act}" data-v="${v}">${l}</button>`)}</div>`;

    const views: Record<Phase, () => Safe> = {
      setup: () => html`<div class="g2">
        <section class="card game-panel"><div class="card-head"><h1 style="font-size:30px">교전 설정</h1><span class="end chip hwang">승리 시 최대 +${DIFF_XP.hard + 60} XP</span></div>
          <div class="field"><span>모드</span>${pills(MODES.map(([v, l]) => [v, l]), mode, 'mode')}<span class="dim" style="font-size:13px">${MODES.find((m) => m[0] === mode)![2]}</span></div>
          ${mode === 'single' ? html`
          <div class="field"><span>난이도 · 기본 보상 <b class="c-hwang mono">+${DIFF_XP[diff]} XP</b></span>${pills((Object.keys(DIFF_KO) as Difficulty[]).map((d) => [d, DIFF_KO[d]]), diff, 'diff')}</div>
          <div class="field"><span>적 규모</span>${pills((Object.keys(PRESET_KO) as Preset[]).map((p) => [p, PRESET_KO[p]]), preset, 'preset')}</div>` : ''}
          <div class="field"><span>블록 시간</span>${pills([['2000', '2초 · 훈련'], ['6000', '6초 · 체인']], String(blockMs), 'block')}</div>
          ${mode === 'daily' ? html`<p class="note">일일 교전은 양측 모두 충전 ${DAILY_CHARGE}에서 시작하고 자동 조종을 쓸 수 없습니다. <a href="${href('/daily')}">오늘의 작전 보기 →</a></p>` : html`<label class="field"><span>시작 충전량 · <b class="mono c-cheong">${charge}</b> / ${MAX_CHARGE}</span><input type="range" min="0" max="${MAX_CHARGE}" value="${charge}" aria-label="시작 충전량" data-act="charge" style="accent-color:var(--cheong);min-height:32px"></label>`}
          ${mode === 'single' ? html`<label class="field"><span>시드</span><input class="input" value="${seed}" aria-label="시드" data-act="seed"></label>` : ''}
          <button class="btn primary lg" data-act="toDeploy">배치 단계로 <kbd>Enter</kbd></button>
        </section>
        <section class="card game-panel"><h2><a href="${href('/daily')}">오늘의 일일 교전</a> <span class="mono dim" style="font-size:14px">#${dailyNo(kstDay())} · ${kstDay()}</span></h2>
          <p class="note">작전 「${nameKo(dailyScenario(kstDay()))}」 · ${TWIST_KO[dailyScenario(kstDay()).twist.id].name} · ${DIFF_KO[dailyScenario(kstDay()).difficulty]}</p>
          ${ladder?.ladder.length ? html`<ol class="log" style="padding:0">${ladder.ladder.map((r, i) => html`<li style="display:flex;justify-content:space-between;padding:8px 10px;background:${i === 0 ? 'var(--hwang-bg)' : 'var(--bg-raised)'}"><span>${i + 1} · ${r.username}</span><span>${'★'.repeat(r.stars)}${'☆'.repeat(3 - r.stars)} · ${r.blocks}블록</span></li>`)}</ol>`
            : html`<p class="empty">아직 오늘의 기록이 없습니다.</p>`}
          <div class="g3" style="gap:8px">
            ${[['전적', `${career.stats.simWins}승 / ${career.stats.simBattles}전`], ['최고 별', '★'.repeat(career.stats.simStars) || '—'], ['누적 격파', String(career.stats.kills)]].map(([k, v]) => html`<div class="stat"><small>${k}</small><strong>${v}</strong></div>`)}
          </div>
          <p class="note">함대는 본거지 밖에서 만나므로 행성 구조체는 없습니다. CMD 함선이 파괴되면 전투가 끝납니다.</p>
        </section></div>`,
      deploy: () => html`<section class="card game-panel" style="gap:12px"><div class="card-head"><h1 style="font-size:26px">${duel ? `실시간 대전 · ${peerName()}` : rival ? `도전 · ${rival.title}` : vsInfo ? `실전 예측 · ${vsInfo.name}` : mission ? `작전 ${mission.no} · ${mission.title}` : raidOn ? `습격 · ${raidOn.name}` : run ? `연전 ${run.round}/5 · ${ROUND_KO[run.round - 1]}` : mode === 'daily' ? `일일 교전 #${dailyNo(theDay())} · 「${nameKo(dailyScenario(theDay()))}」` : '함대 편성'}</h1><span class="mono dim">${units.length} 유닛 · 시드 ${seed}</span>
          ${raidOn ? (() => {
            const hpOf = (side: string) => units.filter((u) => u.side === side).reduce((t, u) => t + (u.health ?? TYPES_BY_ID[u.type].maxHealth), 0);
            const mine = hpOf('player'), theirs = hpOf('computer');
            const pct = odds && odds.played ? Math.round((odds.won / odds.played) * 100) : null;
            const b = demo.bounty?.target === raidOn.id ? demo.bountyPayout() : 0;
            return html`<span class="chip hwang mono">${raidOn.id === 'void' ? `격파 전리품 ${demo.boss?.reward ?? 0} α · ${demo.boss?.left ?? 0}블록 남음` : `노획 예상 광석 ${n(Math.floor(raidOn.ore * 0.6))}${b ? ` + 현상금 ${b} α` : ''}`}</span><span class="chip ${mine < theirs * 0.7 ? 'jeok' : 'cheong'} mono">전력 ${mine} vs ${theirs}${mine < theirs * 0.7 ? ' · 열세!' : ''}</span>
              <span class="chip ${pct == null ? '' : pct >= 60 ? 'cheong' : pct >= 35 ? 'hwang' : 'jeok'} mono odds" title="자동 지휘(어려움) 기준 모의 교전">${pct == null ? '승률 계산 중…' : `예상 승률 ${pct}%`}${odds && odds.played < 16 ? ` · ${odds.played}/16` : ''}</span>`;
          })() : ''}
          ${vsInfo ? (() => { const pct = odds && odds.played ? Math.round((odds.won / odds.played) * 100) : null; return html`<span class="chip hwang mono">실제 함대 · ${vsInfo!.id}</span><span class="chip ${pct == null ? '' : pct >= 60 ? 'cheong' : pct >= 35 ? 'hwang' : 'jeok'} mono odds" title="자동 지휘(어려움) 기준 모의 교전">${pct == null ? '승률 계산 중…' : `예상 승률 ${pct}%`}${odds && odds.played < 16 ? ` · ${odds.played}/16` : ''}</span>`; })() : ''}
          ${duel ? linkChip() : ''}
          ${mode === 'single' && !raidOn && !mission && !vsInfo && !duel ? html`<span class="chip ${spent() > budget() ? 'jeok' : 'cheong'} mono">편성 점수 ${n(spent())} / ${n(budget())}</span>` : ''}
          <span class="end" style="display:flex;gap:8px;flex-wrap:wrap">${run || raidOn || mission || vsInfo || rival || duel ? '' : html`<button class="btn ghost" data-act="reroll">다시 뽑기 <kbd>R</kbd></button>`}<button class="btn ghost" data-act="toSetup">설정으로</button>${duel ? '' : html`<button class="btn danger lg" data-act="start">전투 시작 <kbd>Enter</kbd></button>`}</span></div>
        <div class="bt-legend"><span class="c-cheong">◀ 내 함대</span><span class="c-jeok">${duel ? `${peerName()} 함대` : `컴퓨터 함대 · ${DIFF_KO[diff]}`} ▶</span></div>
        ${duel ? lobbyPanel() : ''}
        ${mission ? html`<div class="briefing"><span class="label c-jeok">작전 브리핑 · ${mission.place}</span><p>${mission.brief}</p><p class="mc-lesson">전술 · ${mission.lesson}</p></div>` : ''}
        ${raidOn ? html`<p class="note">데모 함대가 그대로 출격합니다. 입은 피해는 기지로 돌아가서도 남습니다 — 함교에서 수리하세요. 약탈한 광석은 정제하기 전까지 다시 빼앗길 수 있습니다.</p>` : ''}
        ${mode === 'single' && !raidOn && !mission && !duel ? html`<p class="note">내 칸을 눌러 유닛을 바꾸거나 빈 칸에 배치하세요. 적 함대 점수(건설 난이도 합)의 115%까지 쓸 수 있습니다.</p>` : ''}
        ${run ? html`<div class="run-track">${GAUNTLET_ROUNDS.map((_, i) => html`<span class="${i + 1 < run!.round ? 'done' : i + 1 === run!.round ? 'now' : ''}">${i + 1} · ${ROUND_KO[i]}</span>`)}</div>` : ''}
        ${editing ? editor() : ''}
        <div id="bd-host"></div></section>`,
      battle: () => html`<div class="row">
        <section class="card grow game-panel bt-stage" style="padding:0;gap:0">
          <div class="bt-top">${strength('you')}<div class="bt-mid"><span class="label">블록</span><strong class="mono">#${chain?.height ?? 0}</strong><span class="mono faint">${blockMs / 1000}초</span>${battling() ? linkChip() : ''}</div>${strength('cpu')}</div>
          <div id="bd-host"></div>
          <div class="bt-bar">
            <span class="bt-hint">${replaying ? '▶ 리플레이 재생 중 · F로 배속' : autopilot ? '자동 조종 중 — A로 해제' : picked && guard ? raw(`<b>${typeName(picked)}</b> 방어 지정 · 지킬 아군을 누르세요`) : picked ? raw(`<b>${typeName(picked)}</b> 선택 · 깜빡이는 적을 누르세요 · D로 방어 지정`) : '내 유닛을 눌러 선택하세요'}${queued ? (battling() && duel!.guest ? ' · 호스트에게 보냄, 다음 블록에 발사' : ' · 다음 블록에 발사') : ''}</span>
            <span class="end" style="display:flex;gap:6px;flex-wrap:wrap">
              <button class="pill ${ws === 'primaryWeapon' ? 'on' : ''}" data-act="ws" data-v="primaryWeapon">주무기 <kbd>1</kbd></button>
              <button class="pill ${ws === 'secondaryWeapon' ? 'on' : ''}" data-act="ws" data-v="secondaryWeapon">보조무기 <kbd>2</kbd></button>
              <button class="pill ${guard ? 'on' : ''}" data-act="guard" ${picked ? '' : 'disabled'}>방어 지정 <kbd>D</kbd></button>
              <button class="pill ${moving ? 'on' : ''}" data-act="move" ${picked && chain && chain.typeOf(chain.get(picked)!).movable ? '' : 'disabled'} title="지휘함만 전장을 옮길 수 있습니다">이동 <kbd>M</kbd></button>
              <button class="pill" data-act="stealth" ${picked && chain && chain.typeOf(chain.get(picked)!).unitDefenses === 'stealthMode' ? '' : 'disabled'}>${picked && chain?.isHidden(chain.get(picked)!) ? '은신 해제' : '은신'} <kbd>S</kbd></button>
              ${mode === 'daily' ? '' : html`<button class="pill ${autopilot ? 'on' : ''}" data-act="autopilot">자동 <kbd>A</kbd></button>`}
              ${battling() ? html`<button class="pill ${forfeitArmed ? 'on' : ''}" data-act="forfeit" style="${forfeitArmed ? 'border-color:var(--jeok);color:var(--jeok)' : ''}">${forfeitArmed ? '정말 기권?' : '기권'}</button>` : html`
              <button class="pill ${mult > 1 ? 'on' : ''}" data-act="speed">${mult}× <kbd>F</kbd></button>
              <button class="pill" data-act="pause">${paused ? '재개' : '일시정지'} <kbd>Space</kbd></button>`}</span>
          </div>
        </section>
        <section class="side game-panel" style="background:var(--sunken);border:2px solid var(--line);display:flex;flex-direction:column;max-height:calc(100vh - 180px)">
          <h2 style="padding:12px 16px;border-bottom:1px solid var(--line);font-size:18px">전투 기록</h2>
          <ol class="log" style="overflow-y:auto">${log.map((l) => html`<li><span class="faint">#${l.h}</span> <span class="${l.tone}">${l.text}</span></li>`)}</ol>
        </section></div>`,
      debrief: () => {
        const p = stats.player, c = stats.computer;
        return html`<div class="row">
          <section class="card side game-panel debrief ${winner === 'player' ? 'win' : 'loss'}" style="align-items:center;text-align:center;justify-content:center">
            <span class="label">DEBRIEF</span>
            <strong class="debrief-title">${winner === 'player' ? '승리' : winner === 'computer' ? '패배' : '무승부'}</strong>
            <span class="debrief-stars" aria-label="별 3개 중 ${stars}개">${'★'.repeat(stars)}${'☆'.repeat(3 - stars)}</span>
            <span class="mono">${blocks}블록 · 격파 ${c.lost} · 손실 ${p.lost}</span>
            ${xpWon ? html`<span class="chip hwang mono" style="font-size:16px">+${xpWon} XP</span>` : ''}
            ${dailyRes ? html`<div class="dl-result"><span class="label c-hwang">일일 교전 #${dailyNo(dailyRes.day)}${dailyRes.best ? ' · 오늘의 최고 기록!' : ''}</span><strong class="mono">${dailyRes.score.toLocaleString('ko-KR')}점</strong>
              <a class="btn gold" href="${href('/daily/' + dailyRes.day + '/' + dailyRes.code)}">결과 공유하기</a></div>` : ''}
            ${(() => { const own = raidOn ? new Set(Object.keys(raidIds).map((u) => idMap[u])) : null; const best = Object.values(ace).filter((a) => !own || own.has(a.id ?? '')).sort((a, z) => z.kills * 10 + z.dmg - (a.kills * 10 + a.dmg))[0]; return best && (best.dmg || best.kills) ? html`<div class="mvp">${pixel(best.type, 56)}<div><span class="label c-hwang">최우수 함선</span><b>${(() => { const uid = Object.keys(idMap).find((u) => idMap[u] === best.id); const nm = uid && raidIds[uid] ? demo.state.structs.find((x) => x.id === raidIds[uid])?.name : undefined; return nm ? `「${nm}」 ${STRUCT_TYPE[best.type] ?? best.type}` : STRUCT_TYPE[best.type] ?? best.type; })()}</b><span class="mono">피해 ${best.dmg} · 격파 ${best.kills}</span></div></div>` : ''; })()}
            ${duel && duel.phase === 'over' ? (() => {
              const d = duel!, r = d.h2h;
              return html`<div class="chal-compare ${winner === 'player' ? 'win' : 'loss'}"><span class="label c-hwang">실시간 대전 · ${d.me.name} 대 ${peerName()}</span>
                <div><span>결과</span><b>${winner === 'player' ? '승리' : winner === 'computer' ? '패배' : '무승부'} · ${WHY_KO[d.why ?? 'fleet']}</b></div>
                <div><span>상대 전적</span><b>${r ? `${r.w}승 ${r.l}패${r.d ? ` ${r.d}무` : ''}` : '—'}</b></div>
                <div><span>내 역할</span><b>${d.role === 'host' ? '호스트 · 블록 생산' : '게스트'}</b></div>
                <div><span>격파 / 손실</span><b class="mono">${stats.computer.lost} / ${stats.player.lost}</b></div></div>`;
            })() : ''}
            ${rival ? (() => { const theirWin = rival.winner === 'player', mineWin = winner === 'player'; const beat = mineWin && (!theirWin || (rival.blocks != null && blocks < rival.blocks)); return html`<div class="chal-compare ${beat ? 'win' : 'loss'}"><span class="label c-hwang">도전 결과</span><div><span>상대</span><b>${theirWin ? '승리' : rival.winner === 'computer' ? '패배' : '—'}${rival.blocks != null ? ` · ${rival.blocks}블록` : ''}</b></div><div><span>나</span><b>${mineWin ? '승리' : winner === 'computer' ? '패배' : '무승부'} · ${blocks}블록</b></div><strong>${beat ? '기록을 넘었습니다!' : mineWin && theirWin ? '이겼지만 더 느렸습니다' : '아직 못 넘었습니다'}</strong></div>`; })() : ''}
            ${mission && winner === 'player' ? (() => { const next = MISSIONS[mission.no]; return next ? html`<a class="btn danger" href="${href('/sim?mission=' + next.id)}">다음 작전 · ${next.title}</a>` : html`<span class="chip hwang">작전 완수 · 붉은 연합 격파</span>`; })() : ''}
            ${mission ? html`<a class="btn ghost" href="${href('/campaign')}">작전 지도</a>` : ''}
            ${raidOn && loot ? html`<span class="chip ${loot.ore || loot.alpha ? 'hwang' : 'jeok'} mono" style="font-size:16px">${loot.alpha ? `전리품 +${n(loot.alpha)} α` : loot.ore ? `노획 광석 +${n(loot.ore)}` : '노획 없음'}</span><a class="btn gold" href="${href('/console')}">함교로 귀환</a>` : ''}
            ${run?.offers ? html`<div class="offers"><span class="label c-hwang">증원 선택 · 1기</span>${run.offers.map((o, i) => html`<button class="offer" data-act="reinforce" data-i="${i}">${pixel(o.type, 56)}<b>${STRUCT_TYPE[o.type]}</b><span class="mono faint">${AMBIT[o.ambit]} ${o.slot + 1} · HP ${TYPES_BY_ID[o.type].maxHealth}</span></button>`)}</div>` : ''}
            ${run?.over ? html`<span class="chip ${run.won ? 'hwang' : 'jeok'}">${run.won ? '연전 제패!' : `연전 종료 · ${run.round}라운드`}</span>` : ''}
            <div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:center">${run && !run.over ? '' : html`<button class="btn primary" data-act="again">${duel?.peer ? '재대결 신청' : run ? '새 연전' : '재도전'} <kbd>Enter</kbd></button>`}<button class="btn ghost" data-act="toSetup">설정으로</button><button class="btn gold" data-act="shareBattle">통신에 전투 공유</button></div>
          </section>
          <section class="card grow game-panel"><h2>전투 통계</h2>
            <div class="scroll-x"><table class="t" style="min-width:420px"><thead><tr><th>항목</th><th class="r c-cheong">나</th><th class="r c-jeok">${duel ? peerName() : '컴퓨터'}</th></tr></thead><tbody>
              ${([['손실', 'lost'], ['공격', 'attacks'], ['피해', 'damage'], ['회피', 'evaded'], ['차단', 'blocked'], ['반격 피해', 'counter']] as [string, keyof Side][]).map(([l, k]) => html`<tr><td>${l}</td><td class="r mono">${p[k]}</td><td class="r mono">${c[k]}</td></tr>`)}
            </tbody></table></div>
            <div id="bd-host"></div>
            <div class="replay-row"><button class="btn primary" data-act="replay">▶ 전투 다시 보기</button>
              <input class="input" readonly value="${replayLink()}" aria-label="리플레이 공유 링크" style="flex:1 1 220px;font-size:12px"><button class="btn ghost" data-act="copyReplay">링크 복사</button></div>
          </section></div>`;
      },
    };

    /* The duel's lobby, in the deploy view: what is offered, who sits where, who is ready. */
    const lobbyPanel = (): Safe => {
      const d = duel!, l = d.lobby;
      const record = d.h2h && d.h2h.w + d.h2h.l + d.h2h.d ? html`<span class="chip mono">상대 전적 ${d.h2h.w}승 ${d.h2h.l}패${d.h2h.d ? ` ${d.h2h.d}무` : ''}</span>` : '';
      const box = (body: Safe | string) => html`<div class="briefing duel-lobby"><span class="label c-hwang">실시간 대전 대기실 ${record}</span>${body}</div>`;
      if (l?.state === 'cancelled') {
        return box(html`<p>${d.note ?? (l.why ? LOBBY_WHY_KO[l.why] : '대전이 열리지 않았습니다.')}</p>
          <div class="chal-acts">${d.role === 'host' ? html`<button class="btn primary" data-act="duelReset">다시 신청하기</button>` : d.peer ? html`<a class="btn primary" href="${href('/sim?duel=' + d.peer.id)}">내가 ${d.peer.name} 님에게 신청</a>` : ''}<a class="btn ghost" href="${href('/sim')}">시뮬레이터로</a></div>`);
      }
      if (d.role === 'host' && !d.link) {
        return box(html`<p>${d.peer?.name} 님에게 실시간 대전을 신청합니다. 신청은 통신 DM에 카드로 가고, 상대가 들어와 둘 다 준비하면 시작합니다. 내 함대가 왼쪽, ${d.peer?.name} 님은 오른쪽 함대를 지휘합니다.</p>
          <div class="field"><span>함대</span>${pills(d.fleet === 'from' ? [['from', '공유된 전투의 함대']] : [['mirror', '대칭 · 9기 대 9기'], ['random', '무작위']], d.fleet, 'duelFleet')}</div>
          <div class="field"><span>블록 시간</span>${pills(LIVE_BLOCK_MS.map((ms) => [String(ms), `${ms / 1000}초${ms === 4000 ? ' · 권장' : ''}`]), String(blockMs), 'duelBlock')}</div>
          ${d.note ? html`<p class="note">${d.note}</p>` : ''}
          <div class="chal-acts"><button class="btn danger lg" data-act="duelOffer"><i class="si icon-raid"></i> 대전 신청 보내기</button></div>`);
      }
      if (!l || l.state === 'offered') {
        return box(html`<p>${d.note ?? (d.role === 'host' ? `신청을 보냈습니다. ${peerName()} 님이 통신에서 카드를 눌러 들어오기를 기다리는 중…` : `${peerName()} 님의 대기실에 들어가는 중…`)}</p>
          <div class="chal-acts"><button class="btn ghost" data-act="duelLeave">${d.role === 'host' ? '신청 취소' : '나가기'}</button></div>`);
      }
      const mine = d.role === 'host' ? l.ready.host : l.ready.guest;
      const seat = (p: Peer | null, ready: boolean, me: boolean) => html`<li class="${ready ? 'on' : ''}"><b>${p?.name ?? '빈 자리'}</b>${me ? html` <span class="chip cheong">나</span>` : ''}<span class="mono ${ready ? 'c-cheong' : 'faint'}">${ready ? '준비 완료' : '준비 중'}</span></li>`;
      return box(html`<ul class="duel-seats">${seat(l.host, l.ready.host, d.role === 'host')}${seat(l.guest, l.ready.guest, d.role === 'guest')}</ul>
        <p class="note">블록 ${blockMs / 1000}초 · 시작 충전 ${charge} · 블록은 호스트가 만들고, 30초 동안 응답이 없는 쪽은 기권패합니다.</p>
        <div class="chal-acts"><button class="btn ${mine ? 'ghost' : 'danger lg'}" data-act="duelReady">${mine ? '준비 취소' : '준비 완료'}</button><button class="btn ghost" data-act="duelLeave">나가기</button></div>`);
    };

    const editor = (): Safe => {
      const e = editing!;
      const options = FLEET_TYPES.filter((t) => t.id !== COMMAND_SHIP_ID && fits(t.id, e.ambit));
      const free = budget() - spent() + (e.unit ? cost(e.unit.type) : 0);
      return html`<div class="editor"><div class="card-head"><b>${AMBIT[e.ambit]} ${e.slot + 1}번 칸</b><span class="mono dim">남은 점수 ${n(free)}</span>
        <span class="end" style="display:flex;gap:6px">${e.unit && e.unit.type !== COMMAND_SHIP_ID ? html`<button class="btn outline-danger" data-act="remove">제거</button>` : ''}<button class="btn ghost" data-act="closeEdit">닫기</button></span></div>
        <div class="build-grid">${options.map((t) => html`<button class="build-opt ${e.unit?.type === t.id ? 'on' : ''}" data-act="place" data-type="${t.id}" ${cost(t.id) > free ? 'disabled' : ''}>${pixel(t.id, 40)}<b>${STRUCT_TYPE[t.id]}</b><span class="mono faint">${n(cost(t.id))}점 · HP ${t.maxHealth}</span></button>`)}</div></div>`;
    };
    const replayLink = () => webRoot() + '/sim/' + encodeReplay({ units, seed, start: 1000, charge, txs: orders, title: mission ? mission.title : undefined, winner: winner ?? undefined });
    const watch = (o: typeof orders) => { replaying = true; replayOrders = o; autopilot = false; start(); };
    const steps = (): Safe => html`<nav aria-label="시뮬레이션 단계" class="tabs steps">${(['setup', 'deploy', 'battle', 'debrief'] as Phase[]).map((p, i) => html`<span class="tab ${phase === p ? 'on' : ''}" aria-current="${phase === p ? 'step' : 'false'}">${i + 1} · ${{ setup: '설정', deploy: '배치', battle: '전투', debrief: '결과' }[p]}</span>`)}</nav>`;
    const paint = () => {
      if (!root.isConnected) return;
      mount(root, html`<h1 class="sr">전투 시뮬레이터</h1>${steps()}${views[phase]()}`, handlers);
      const host = root.querySelector('#bd-host');
      if (host && board) board.attach(host);
    };
    const toDeploy = () => {
      editing = null; vsInfo = null; rival = null;
      if (mission) {
        run = null; units = missionUnits(mission); diff = mission.difficulty; charge = mission.charge; seed = 'MISSION-' + mission.id;
        phase = 'deploy'; newBoard().setStructs(units.map(toBoard)); paint();
        return;
      }
      if (raidOn) {
        run = null;
        const f = demo.fleetUnits();
        raidIds = f.ids;
        const size = raidOn.fleet;
        diff = size <= 4 ? 'easy' : size <= 7 ? 'difficult' : 'hard';
        // The same fleet scouting showed (src/screens/galaxy.ts).
        seed = raidSeed(raidOn);
        const enemy = rivalFleet(raidOn);
        // An ally's ships fly beside yours, in whatever slots you've left free (they aren't yours to lose).
        units = [...withAllies(f.units), ...enemy];
        phase = 'deploy';
        newBoard().setStructs(units.map(toBoard));
        stopOdds?.(); odds = null;
        stopOdds = estimateOdds(units, diff, 16, (won, played) => { odds = { won, played }; if (root.isConnected && phase === 'deploy') paint(); });
        paint();
        return;
      }
      if (mode === 'daily') { run = null; const d = dailyScenario(theDay()); units = d.units; seed = d.seed; diff = d.difficulty; charge = DAILY_CHARGE; autopilot = false; }
      else if (mode === 'gauntlet') {
        if (!run || run.over) run = { round: 1, fleet: layout('difficult', seed).filter((u) => u.side === 'player'), seed, offers: null, over: false, won: false };
        diff = GAUNTLET_ROUNDS[run.round - 1].difficulty;
        units = [...run.fleet, ...gauntletEnemy(run.round, run.seed, run.fleet.length)];
      } else { run = null; units = layout(preset, seed); }
      chain = null; phase = 'deploy';
      newBoard().setStructs(units.map(toBoard));
      paint();
    };
    const handlers = {
      mode: (el: HTMLElement) => { mode = el.dataset.v!; paint(); },
      diff: (el: HTMLElement) => { diff = el.dataset.v as Difficulty; paint(); },
      preset: (el: HTMLElement) => { preset = el.dataset.v as Preset; paint(); },
      block: (el: HTMLElement) => { blockMs = Number(el.dataset.v); paint(); },
      charge: (el: HTMLElement) => { charge = Number((el as HTMLInputElement).value); paint(); },
      seed: (el: HTMLElement) => { seed = (el as HTMLInputElement).value || seed; },
      toSetup: () => { if (duel) { go('/sim'); return; } running = false; chain = null; board?.dispose(); board = null; phase = 'setup'; paint(); },
      duelFleet: (el: HTMLElement) => {
        if (!duel || duel.link || duel.fleet === 'from') return;
        duel.fleet = el.dataset.v === 'random' ? 'random' : 'mirror';
        seed = 'DUEL-' + Math.random().toString(36).slice(2, 7).toUpperCase();
        units = layout(duel.fleet === 'random' ? 'random' : 'difficult', seed);
        board?.setStructs(units.map(toBoard)); paint();
      },
      duelBlock: (el: HTMLElement) => { if (duel && !duel.link) { blockMs = Number(el.dataset.v); paint(); } },
      duelOffer: async () => {
        const d = duel;
        if (!d || d.role !== 'host' || d.link || !d.peer || d.note === '신청을 보내는 중…') return;
        const battle = battleOf(units, seed, charge, blockMs, fromTitle ?? `${d.me.name} 대 ${d.peer.name}`);
        d.note = '신청을 보내는 중…'; paint();
        try {
          const link = await offerDuel(d.me, d.peer, battle);
          if (duel !== d) { link.send({ kind: 'leave' }); link.close(); return; }
          d.link = link; d.lobby = hostLobby(link.match, d.me, battle, d.peer.id); d.note = undefined;
          link.onFrame(onDuelFrame);
          watchDuel();
          sfx.play('confirm'); notify('대전 신청', `${d.peer.name} 님에게 보냈습니다`, 'hwang', null);
        } catch (e) { d.note = '신청을 보내지 못했습니다: ' + (e as Error).message; }
        paint();
      },
      duelReady: () => {
        const d = duel, l = d?.lobby;
        if (!d?.link || !l || l.state !== 'joined') return;
        sfx.play('click');
        if (d.role === 'host') {
          d.lobby = { ...l, ready: { ...l.ready, host: !l.ready.host } };
          d.link.send(lobbyFrame(d.lobby));
          if (bothReady(d.lobby)) { beginHost(); return; }
        } else {
          d.lobby = { ...l, ready: { ...l.ready, guest: !l.ready.guest } };
          d.link.send({ kind: 'ready', on: d.lobby.ready.guest });
        }
        paint();
      },
      duelLeave: () => {
        const d = duel;
        if (!d) return;
        d.link?.send({ kind: 'leave' }); d.link?.close(); d.link = null;
        if (duelTimer) { clearInterval(duelTimer); duelTimer = null; }
        if (d.role === 'guest') { go('/sim'); return; }
        d.lobby = null; d.note = undefined; paint();
      },
      duelReset: () => { if (duel?.role === 'host') { duel.lobby = null; duel.note = undefined; duel.link = null; paint(); } },
      forfeit: () => {
        if (!battling() || !duel) return;
        if (!forfeitArmed) { forfeitArmed = true; paint(); setTimeout(() => { if (forfeitArmed) { forfeitArmed = false; paint(); } }, 3000); return; }
        forfeitArmed = false;
        // The guest says so; the host's `end` (sent from finish) says it for both.
        if (duel.role === 'guest') duel.link?.send({ kind: 'leave' });
        log.unshift({ h: chain?.height ?? 0, text: '기권했습니다', tone: 'c-warn' });
        finish('computer', 'forfeit');
      },
      toDeploy,
      replay: () => watch(orders.slice()),
      shareBattle: () => {
        const p = stats.player, c = stats.computer;
        const code = replayLink().split('/sim/')[1] ?? '';
        share({ kind: 'situation', s: {
          t: 'replay', title: `${mission ? mission.title + ' · ' : ''}${winner === 'player' ? '승리' : winner === 'computer' ? '패배' : '무승부'} ${'★'.repeat(stars)}${'☆'.repeat(3 - stars)}`, sub: '같은 함대, 같은 시드로 도전해 보세요. 더 빨리 이기면 기록을 넘습니다.',
          lines: [['전투 시간', `${blocks}블록`], ['격파', String(c.lost)], ['손실', String(p.lost)], ['가한 피해', String(p.damage)], ['회피', String(p.evaded)], ['차단', String(p.blocked)]],
          go: code.length < 1800 ? `/sim?from=${code}` : '/sim', tone: winner === 'player' ? 'cheong' : 'jeok', at: Date.now(),
        } });
      },
      copyReplay: () => { void navigator.clipboard?.writeText(replayLink()).then(() => { sfx.play('confirm'); notify('복사됨', '리플레이 링크를 붙여넣어 공유하세요', 'cheong', null); }).catch(() => toast('복사하지 못했습니다')); },
      again: () => { if (duel?.peer) { go('/sim?duel=' + duel.peer.id); return; } if (mission) { start(); return; } if (raidOn) { go('/console'); return; } if (run?.over) { run = null; seed = 'KR-' + Math.random().toString(36).slice(2, 7).toUpperCase(); toDeploy(); } else start(); },
      reinforce: (el: HTMLElement) => {
        if (!run?.offers) return;
        const o = run.offers[Number(el.dataset.i)];
        run.fleet.push({ id: unitId('player', o.type, o.ambit, o.slot), side: 'player', type: o.type, ambit: o.ambit, slot: o.slot, protects: null });
        run.offers = null; run.round++;
        sfx.play('build'); notify('증원 합류', `${STRUCT_TYPE[o.type]} · ${AMBIT[o.ambit]}`, 'cheong', null);
        toDeploy();
      },
      place: (el: HTMLElement) => {
        if (!editing) return;
        const type = Number(el.dataset.type), e = editing;
        const gone = units.filter((u) => u.side === 'player' && u.type !== COMMAND_SHIP_ID && u.ambit === e.ambit && u.slot === e.slot).map((u) => u.id);
        units = units.filter((u) => !gone.includes(u.id)).map((u) => (u.protects && gone.includes(u.protects) ? { ...u, protects: null } : u));
        units.push({ id: unitId('player', type, e.ambit, e.slot), side: 'player', type, ambit: e.ambit, slot: e.slot, protects: null });
        sfx.play('build'); editing = null; syncDeploy(); paint();
      },
      remove: () => { if (!editing?.unit) return; const u = editing.unit; units = units.filter((x) => x !== u).map((x) => (x.protects === u.id ? { ...x, protects: null } : x)); sfx.play('click'); editing = null; syncDeploy(); paint(); },
      closeEdit: () => { editing = null; paint(); },
      reroll: () => { seed = 'KR-' + Math.random().toString(36).slice(2, 7).toUpperCase(); units = layout(preset, seed); board?.setStructs(units.map(toBoard)); paint(); },
      start,
      ws: (el: HTMLElement) => { ws = el.dataset.v as WeaponSystem; markTargets(); paint(); },
      autopilot: () => { if (mode === 'daily' && !mission && !raidOn) return; autopilot = !autopilot; paint(); },
      guard: () => { if (!picked) return; guard = !guard; moving = false; board?.markTiles([]); markTargets(); paint(); },
      move: () => {
        if (!picked || !chain) return;
        const s = chain.get(picked)!, t = chain.typeOf(s);
        if (!t.movable) { sfx.play('error'); notify('이동 불가', `${typeName(picked)}은(는) 움직일 수 없습니다`, 'jeok', null); return; }
        moving = !moving; guard = false;
        // Open slots this hull can hold (a command ship only changes battlefield).
        const keys: string[] = [];
        if (moving) for (const a of AMBITS) {
          if ((AMBIT_FLAG[a] & t.possibleAmbit) === 0) continue;
          if (s.typeId === COMMAND_SHIP_ID) { if (a !== s.ambit) keys.push(`cmd|defender|${a}`); continue; }
          for (let slot = 0; slot < 4; slot++) if (!Object.values(chain.structs).some((o) => o.owner === meId && o.typeId !== COMMAND_SHIP_ID && o.ambit === a && o.slot === slot && !chain!.isDestroyed(o))) keys.push(`fleet|defender|${a}|${slot}`);
        }
        board?.markTiles(keys); markTargets(); paint();
      },
      stealth: () => {
        if (!picked || !chain) return;
        const s = chain.get(picked)!;
        if (chain.typeOf(s).unitDefenses !== 'stealthMode') { sfx.play('error'); notify('은신 불가', `${typeName(picked)}에는 은신 장치가 없습니다`, 'jeok', null); return; }
        const on = chain.isHidden(s);
        order({ '@type': on ? '/structs.structs.MsgStructStealthDeactivate' : '/structs.structs.MsgStructStealthActivate', structId: picked });
        sfx.play('evade'); notify(on ? '은신 해제' : '은신', `${typeName(picked)} · 다음 블록`, 'cheong', null); paint();
      },
      speed: () => { if (battling()) return; mult = mult >= 4 ? 1 : mult * 2; if (board) board.speed = (blockMs < 4000 ? 1.6 : 1.2) * mult; paint(); },
      pause: () => { if (battling()) return; paused = !paused; paint(); },
    };
    const offKeys = keys.scope({
      z: () => board?.toggleZoom(),
      Enter: () => (phase === 'setup' ? toDeploy() : phase === 'deploy' ? (duel ? undefined : start()) : phase === 'debrief' && !(run && !run.over) ? handlers.again() : undefined),
      r: () => phase === 'deploy' && !run && !raidOn && !mission && !vsInfo && !rival && !duel && handlers.reroll(),
      ' ': () => phase === 'battle' && handlers.pause(),
      a: () => phase === 'battle' && handlers.autopilot(),
      f: () => phase === 'battle' && handlers.speed(),
      d: () => phase === 'battle' && handlers.guard(),
      m: () => phase === 'battle' && handlers.move(),
      s: () => phase === 'battle' && handlers.stealth(),
      '1': () => { if (phase === 'battle') { ws = 'primaryWeapon'; markTargets(); paint(); } },
      '2': () => { if (phase === 'battle') { ws = 'secondaryWeapon'; markTargets(); paint(); } },
      Escape: () => { if (picked) { picked = null; guard = false; moving = false; board?.markTiles([]); board?.select(null); markTargets(); paint(); } },
    });
    // /sim/R… is the canonical replay link; /sim?replay=R… is how older links say it.
    const replayCode = params.get('replay') ?? (current().split('/')[2] || null);
    const shared = replayCode ? decodeReplay(replayCode) : null;
    const dailyParam = params.get('daily');
    if (dailyParam && !shared) {
      mode = 'daily';
      if (playable(dailyParam)) dailyDay = dailyParam; else toast('그날의 작전은 없습니다', 3000);
    }
    if (shared) {
      units = shared.units; seed = shared.seed; charge = shared.charge ?? 10;
      notify('리플레이', shared.title ? `${shared.title} 다시 보기` : '공유된 전투를 재생합니다', 'cheong', null);
      watch(shared.txs);
    } else if (replayCode) { toast('리플레이 링크를 읽지 못했습니다', 4000); paint(); }
    else if (dailyParam) toDeploy();
    else if (mission) toDeploy();
    else if (raidOn) {
      if (!demo.fleetUnits().units.some((u) => u.type === COMMAND_SHIP_ID)) { mount(root, html`<section class="card game-panel" style="max-width:560px;margin:40px auto"><h1 style="font-size:28px">출격 불가</h1><p class="note">지휘함이 없습니다. 함교에서 지휘함을 수리한 뒤 출격하세요.</p><a class="btn primary" href="${href('/console')}">함교로</a></section>`); return () => offKeys(); }
      toDeploy();
    } else paint();
    const loadVs = async (vs: string) => {
      const me = session.playerId;
      if (!me) { toast('실전 예측은 로그인 후에 할 수 있습니다', 4000); paint(); return; }
      mount(root, html`<div class="card"><div class="skeleton" style="height:120px"></div><span class="sr">함대 정찰 중…</span></div>`);
      const [mine, theirs, them] = await Promise.all([guildApi.structsOf(me).catch(() => [] as StructRow[]), guildApi.structsOf(vs).catch(() => [] as StructRow[]), guildApi.player(vs).catch(() => null)]);
      const toUnits = (rows: StructRow[], side: 'player' | 'computer'): Unit[] => {
        const seen = new Set<string>(), out: Unit[] = [];
        for (const x of rows) {
          if (x.is_destroyed || x.type > 13 || x.location_type !== 'fleet') continue;
          const ambit = (x.type === COMMAND_SHIP_ID ? 'space' : x.operating_ambit) as Ambit;
          if (x.type !== COMMAND_SHIP_ID && !fits(x.type, ambit)) continue;
          const id = unitId(side, x.type, ambit, x.slot ?? 0);
          if (seen.has(id)) continue;
          seen.add(id);
          out.push({ id, side, type: x.type, ambit, slot: x.slot ?? 0, protects: null, health: Math.max(1, Number(x.health) || TYPES_BY_ID[x.type].maxHealth) });
        }
        // Every fleet flies a command ship; a roster without one gets a fresh one to fight around.
        if (!out.some((u) => u.type === COMMAND_SHIP_ID)) out.unshift({ id: unitId(side, COMMAND_SHIP_ID, 'space', 0), side, type: COMMAND_SHIP_ID, ambit: 'space', slot: 0, protects: null });
        return out;
      };
      vsInfo = { id: vs, name: them?.username || vs };
      units = [...toUnits(mine, 'player'), ...toUnits(theirs, 'computer')];
      seed = 'VS-' + vs; diff = 'hard'; run = null; chain = null; phase = 'deploy';
      newBoard().setStructs(units.map(toBoard));
      stopOdds?.(); odds = null;
      stopOdds = estimateOdds(units, diff, 16, (won, played) => { odds = { won, played }; if (root.isConnected && phase === 'deploy') paint(); });
      notify('실전 예측', `${vsInfo.name}의 실제 함대와 내 함대로 모의 교전`, 'cheong', null);
      paint();
    };
    const fromParam = params.get('from');
    const fromCode = fromParam ? decodeReplay(fromParam) : null;
    const duelParam = params.get('duel'), joinParam = params.get('join'), roomParam = params.get('room');
    const plain = !shared && !dailyParam && !mission && !raidOn;
    if (plain && duelParam && /^1-\d{1,9}$/.test(duelParam)) {
      // A live duel: ?from= brings a shared battle's fleets to it instead of a challenge against its record.
      fromTitle = fromCode?.title;
      void hostDuel(duelParam, fromCode ? { units: fromCode.units, seed: fromCode.seed, charge: fromCode.charge ?? 10 } : null);
    } else if (plain && joinParam && /^[A-Za-z0-9]{8,32}$/.test(joinParam) && roomParam) void guestDuel(joinParam, roomParam);
    else if (fromCode && !shared && !dailyParam && !mission && !raidOn) {
      units = fromCode.units; seed = fromCode.seed; charge = fromCode.charge ?? 10; diff = 'hard';
      rival = { title: fromCode.title || '공유된 전투', winner: fromCode.winner, blocks: fromCode.end != null ? fromCode.end - fromCode.start : undefined };
      run = null; chain = null; phase = 'deploy';
      newBoard().setStructs(units.map(toBoard));
      notify('도전', `${rival.title} · 같은 함대, 같은 시드로 겨룹니다`, 'hwang', null);
      paint();
    } else if (fromParam) toast('도전 링크를 읽지 못했습니다', 4000);
    const vsParam = params.get('vs');
    if (vsParam && /^1-\d+$/.test(vsParam) && !shared && !dailyParam && !mission && !raidOn && !duel && !duelParam && !joinParam) void loadVs(vsParam);
    void daily().then((d) => { ladder = d; if (phase === 'setup') paint(); }).catch(() => null);
    return () => {
      running = false; stopOdds?.(); music.setMode('calm'); offKeys(); board?.dispose();
      // Leaving mid-match is a forfeit (or a cancelled lobby); the other side hears it.
      if (duel?.link) { if (duel.phase !== 'over') duel.link.send({ kind: 'leave' }); duel.link.close(); }
      if (duelTimer) clearInterval(duelTimer);
    };
  },
};
export default screen;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
