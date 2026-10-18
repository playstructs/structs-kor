/* 전투 시뮬레이터: structsd's combat rules run locally (src/sim/chain.ts, ported from
 * structs-xyz/structs-universe), so nothing is sent anywhere. The fight plays on the game's own
 * battle board (src/game/map) with the official attack, impact and destroy animations; a block is
 * only produced once the last one's animations have played, so every shot can be followed.
 * The daily engagement and its ladder come from the guild (REQ-SIM-1); until then the daily is
 * seeded from today's date. */
import type { Screen } from '../router';
import { href, go } from '../router';
import { html, mount, n, raw, toast, type Safe } from '../ui/dom';
import { Chain, type Msg, type AttackDetail, type SimStruct } from '../sim/chain';
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

const fromUnit = (u: Unit): BoardStruct => {
  const t = TYPES_BY_ID[u.type];
  return { id: u.id, typeId: u.type, ambit: u.ambit, slot: u.slot, side: u.side === 'player' ? 'defender' : 'attacker', category: 'fleet', isCommand: u.type === COMMAND_SHIP_ID, health: u.health ?? t.maxHealth, maxHealth: t.maxHealth, protects: u.protects };
};
const fromSim = (c: Chain, s: SimStruct): BoardStruct => ({
  id: s.id, typeId: s.typeId, ambit: s.ambit, slot: s.slot, side: s.owner === YOU.id ? 'defender' : 'attacker', category: 'fleet', hidden: c.isHidden(s),
  isCommand: s.typeId === COMMAND_SHIP_ID, health: c.isDestroyed(s) ? 0 : s.health, maxHealth: c.typeOf(s).maxHealth, protects: s.protectedStructId,
});

const screen: Screen = {
  render(root, params) {
    // Vassals are under your protection: no strikes on them from here.
    // Not your vassal, not your ally.
    const raidOn = !demo.on ? null : params.get('raid') === 'void' ? demo.boss : demo.rivals().find((r) => r.id === params.get('raid') && r.vassal == null && r.id !== demo.ally?.id) ?? null;
    const mission = MISSIONS.find((m) => m.id === params.get('mission') && unlocked(m)) ?? null;
    let raidIds: Record<string, string> = {}, loot: { ore: number; alpha?: number } | null = null;
    // The war room's estimate for this strike: wins out of plays, filled in a battle at a time.
    let odds: { won: number; played: number } | null = null, stopOdds: (() => void) | null = null;
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
    let ace: Record<string, { type: number; dmg: number; kills: number }> = {};
    let picked: string | null = null, ws: WeaponSystem = 'primaryWeapon', queued: Msg | null = null, guard = false, moving = false;
    let ladder: Awaited<ReturnType<typeof daily>> | null = null;
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

    const side = (owner: string) => (owner === YOU.id ? 'player' : 'computer');
    const typeName = (id: string) => { const s = chain?.get(id); return s ? STRUCT_TYPE[s.typeId] ?? String(s.typeId) : id; };
    const newBoard = () => {
      board?.dispose();
      board = new Board({
        speed: (blockMs < 4000 ? 1.6 : 1.2) * mult, label: '전투 시뮬레이터', maxHeight: () => innerHeight - 250,
        onPick: (id, s) => (phase === 'deploy' ? deployPick(id, s) : s === 'defender' ? pick(id) : target(id)),
        onTile: (key, ambit, s) => {
          if (phase === 'battle' && moving && picked && s === 'defender' && chain && !replaying) {
            const [kind, , , slot] = key.split('|');
            queued = { '@type': '/structs.structs.MsgStructMove', structId: picked, locationType: 'fleet', ambit, slot: kind === 'cmd' ? 0 : Number(slot) };
            sfx.play('confirm'); notify('이동 명령', `${typeName(picked)} → ${AMBIT[ambit]}${kind === 'cmd' ? '' : ' ' + (Number(slot) + 1)} · 다음 블록`, 'cheong', null);
            moving = false; board?.markTiles([]); paint();
            return;
          }
          if (phase !== 'deploy' || mode !== 'single' || raidOn || mission || s !== 'defender' || !key.startsWith('fleet|')) return;
          editing = { ambit, slot: Number(key.split('|')[3]), unit: null }; paint();
        },
      });
      return board;
    };

    const pick = (id: string) => {
      if (!chain || phase !== 'battle' || replaying) return;
      const s = chain.get(id);
      if (!s || chain.isDestroyed(s)) return;
      // Guard mode: the selected struct takes up defense of the one clicked (MsgStructDefenseSet).
      if (guard && picked && picked !== id) {
        const d = chain.get(picked)!;
        if (!chain.canDefend(d)) { sfx.play('error'); notify('방어 불가', `${typeName(picked)}은(는) 방어를 맡을 수 없습니다`, 'jeok', null); return; }
        queued = { '@type': '/structs.structs.MsgStructDefenseSet', defenderStructId: picked, protectedStructId: id };
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
      if (guard && me) { board.markTargets(Object.values(chain.structs).filter((t) => t.owner === YOU.id && t.id !== me.id && !chain!.isDestroyed(t) && chain!.isProtecting(me, t)).map((t) => t.id)); return; }
      board.markTargets(me ? Object.values(chain.structs).filter((t) => t.owner === CPU.id && !chain!.isDestroyed(t) && !chain!.canAttack(me, t, ws)).map((t) => t.id) : []);
    };
    const target = (id: string) => {
      if (!chain || !picked || phase !== 'battle' || replaying) return;
      const why = chain.canAttack(chain.get(picked)!, chain.get(id)!, ws);
      if (why) { sfx.play('error'); log.unshift({ h: chain.height, text: `공격 불가: ${why}`, tone: 'c-warn' }); paint(); return; }
      queued = { '@type': '/structs.structs.MsgStructAttack', operatingStructId: picked, targetStructId: [id], weaponSystem: ws };
      sfx.play('confirm');
      notify('사격 명령', `${typeName(picked)} → ${typeName(id)} · 다음 블록`, 'cheong', null);
      paint();
    };

    const deployPick = (id: string, s: string) => {
      if (mode !== 'single' || raidOn || mission || s !== 'defender') return;
      const u = units.find((x) => x.id === id);
      if (!u) return;
      if (u.type === COMMAND_SHIP_ID) { notify('지휘함', '지휘함은 교체할 수 없습니다. 잃으면 패배합니다.', 'hwang', 'error'); return; }
      editing = { ambit: u.ambit, slot: u.slot, unit: u }; paint();
    };
    const syncDeploy = () => board?.setStructs(units.map(fromUnit));

    const start = () => {
      // A replay plays the fleets as they were recorded, whatever today's budget says.
      if (!replaying && mode === 'single' && !raidOn && !mission && spent() > budget()) { sfx.play('error'); notify('편성 초과', `함대 점수 ${spent()} / ${budget()} — 유닛을 줄이세요`, 'jeok', null); return; }
      editing = null; stopOdds?.();
      if (raidOn?.id === 'void') {
        // It may have moved on while you were deploying.
        if (!demo.boss) { sfx.play('error'); notify('공허 함대', '이미 떠났습니다', 'jeok', null); go('/galaxy'); return; }
        demo.holdBoss();
      }
      if (!replaying) orders = [];
      const cs = chainSetup(units, seed, { player: charge, computer: charge });
      const setup = cs.setup; idMap = cs.idMap;
      chain = new Chain(setup);
      ai = new Ai(CPU.id, diff, seed); auto = new Ai(YOU.id, 'hard', seed + ':you');
      log = []; stats = { player: zero(), computer: zero() }; blocks = 0; quiet = 0; winner = null; picked = null; queued = null; paused = false; stars = 0; xpWon = 0; streak = 0; lastKill = -99; streakXp = 0; ace = {};
      phase = 'battle';
      newBoard().setStructs(Object.values(chain.structs).map((s) => fromSim(chain!, s)));
      sfx.play('alarm');
      banner({ kicker: `시드 ${seed}`, title: '교전 개시', sub: '내 유닛 → 적 유닛 순서로 눌러 사격', tone: 'jeok', ms: 1800 });
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
        await sleep(blockMs / mult);
        if (!live()) return;
        if (paused) continue;
        await board?.idle();
        if (!live()) return;
        tick();
      }
    };

    const tick = () => {
      if (!chain || winner) return;
      // The animations have landed; the chain's state is the truth again.
      board?.setStructs(Object.values(chain.structs).map((s) => fromSim(chain!, s)));
      if (replaying) {
        for (const o of replayOrders.filter((x) => x.height === chain!.height + 1)) chain.submit(o.signer, o.msg);
      }
      const mine = replaying ? null : autopilot ? auto!.decide(chain) : queued;
      if (mine) { orders.push({ height: chain.height + 1, signer: YOU.id, msg: mine }); chain.submit(YOU.id, mine); }
      queued = null;
      const theirs = replaying ? null : ai!.decide(chain);
      if (theirs) { orders.push({ height: chain.height + 1, signer: CPU.id, msg: theirs }); chain.submit(CPU.id, theirs); }
      const b = chain.produceBlock();
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
            if (who === 'player') { const a = (ace[d.attackerStructId] ??= { type: chain.get(d.attackerStructId)?.typeId ?? 0, dmg: 0, kills: 0 }); a.dmg += dmg; if (shot.targetDestroyed) a.kills++; }
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
            for (const c of shot.eventAttackDefenderCounterDetail || []) stats[them].counter += c.counterDamage || 0;
            const what = shot.evaded ? '회피' : shot.blocked ? `차단 (${STRUCT_TYPE[chain.get(shot.blockedByStructId!)?.typeId ?? 0] ?? '방어자'})` : shot.targetDestroyed ? '격파!' : `피해 ${dmg}`;
            log.unshift({ h: b.height, text: `${who === 'player' ? '아군' : '적'} ${typeName(d.attackerStructId)} → ${typeName(shot.targetStructId)} · ${what}`, tone: shot.targetDestroyed ? 'c-hwang' : who === 'player' ? 'c-cheong' : 'c-jeok' });
          }
        }
      }
      log = log.slice(0, 40);
      if (picked && chain.isDestroyed(chain.get(picked)!)) { picked = null; board?.select(null); }
      markTargets();
      // Moves and stealth show as soon as this block's animations have played.
      const settled = chain;
      void board?.idle().then(() => { if (chain === settled && board) board.setStructs(Object.values(settled.structs).map((x) => fromSim(settled, x))); });
      const fleets = chain.fleetsAtBattle();
      if (fleets.length < 2) finish(fleets.includes(YOU.fleetId) ? 'player' : fleets.includes(CPU.fleetId) ? 'computer' : 'draw');
      else if (blocks > 400 || quiet > 40) {
        // A stalled fight is decided on hull, as in structs-xyz: the fleet with more of itself left wins.
        const me = hull(YOU.id), them = hull(CPU.id);
        const a = me.hp / Math.max(1, me.max), b = them.hp / Math.max(1, them.max);
        const w = Math.abs(a - b) < 0.02 ? 'draw' : a > b ? 'player' : 'computer';
        log.unshift({ h: chain.height, text: `${quiet > 40 ? '교착' : '시간 초과'} · 잔여 내구도 판정 ${Math.round(a * 100)}% 대 ${Math.round(b * 100)}%`, tone: 'c-warn' });
        finish(w);
      }
      paint();
    };

    const finish = (w: 'player' | 'computer' | 'draw') => {
      running = false;
      music.setMode('calm');
      winner = w;
      // Settle after the last explosion, but never later than a few seconds: a board disposed by
      // leaving mid-animation must not swallow the result (the clear, the loot, the XP).
      void Promise.race([board?.idle() ?? Promise.resolve(), sleep(4000)]).then(() => {
        const p = stats.player;
        stars = w !== 'player' ? 0 : 1 + (p.lost <= units.filter((u) => u.side === 'player').length / 3 ? 1 : 0) + (blocks < 60 ? 1 : 0);
        // A replay is for watching: no records, rewards or settlements.
        if (replaying) { replaying = false; sfx.play(w === 'player' ? 'victory' : 'defeat'); phase = 'debrief'; paint(); return; }
        career.bump('simBattles');
        career.bump('kills', stats.computer.lost);
        if (mode === 'daily') career.bump('dailyPlays');
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
          loot = demo.settleRaid(raidOn.id, w === 'player', hp);
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
      const h = hull(who === 'you' ? YOU.id : CPU.id);
      const ch = chain?.chargeOf(who === 'you' ? YOU.id : CPU.id) ?? 0;
      const pct = Math.round((h.hp / Math.max(1, h.max)) * 100);
      return html`<div class="bt-side ${who}">
        <div class="bt-name"><b>${who === 'you' ? '내 함대' : `컴퓨터 · ${DIFF_KO[diff]}`}</b><span class="mono">${h.alive}/${h.total}기</span></div>
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
          <label class="field"><span>시작 충전량 · <b class="mono c-cheong">${charge}</b> / ${MAX_CHARGE}</span><input type="range" min="0" max="${MAX_CHARGE}" value="${charge}" data-act="charge" style="accent-color:var(--cheong);min-height:32px"></label>
          ${mode === 'single' ? html`<label class="field"><span>시드</span><input class="input" value="${seed}" data-act="seed"></label>` : ''}
          <button class="btn primary lg" data-act="toDeploy">배치 단계로 <kbd>Enter</kbd></button>
        </section>
        <section class="card game-panel"><h2>오늘의 일일 교전 ${ladder ? html`<span class="mono dim" style="font-size:14px">${ladder.date}</span>` : ''}</h2>
          <p class="note">${dailyScenario().name} · ${DIFF_KO[dailyScenario().difficulty]}</p>
          ${ladder?.ladder.length ? html`<ol class="log" style="padding:0">${ladder.ladder.map((r, i) => html`<li style="display:flex;justify-content:space-between;padding:8px 10px;background:${i === 0 ? 'var(--hwang-bg)' : 'var(--bg-raised)'}"><span>${i + 1} · ${r.username}</span><span>${'★'.repeat(r.stars)}${'☆'.repeat(3 - r.stars)} · ${r.blocks}블록</span></li>`)}</ol>`
            : html`<p class="empty">아직 오늘의 기록이 없습니다.</p>`}
          <div class="g3" style="gap:8px">
            ${[['전적', `${career.stats.simWins}승 / ${career.stats.simBattles}전`], ['최고 별', '★'.repeat(career.stats.simStars) || '—'], ['누적 격파', String(career.stats.kills)]].map(([k, v]) => html`<div class="stat"><small>${k}</small><strong>${v}</strong></div>`)}
          </div>
          <p class="note">함대는 본거지 밖에서 만나므로 행성 구조체는 없습니다. CMD 함선이 파괴되면 전투가 끝납니다.</p>
        </section></div>`,
      deploy: () => html`<section class="card game-panel" style="gap:12px"><div class="card-head"><h1 style="font-size:26px">${mission ? `작전 ${mission.no} · ${mission.title}` : raidOn ? `습격 · ${raidOn.name}` : run ? `연전 ${run.round}/5 · ${ROUND_KO[run.round - 1]}` : '함대 편성'}</h1><span class="mono dim">${units.length} 유닛 · 시드 ${seed}</span>
          ${raidOn ? (() => {
            const hpOf = (side: string) => units.filter((u) => u.side === side).reduce((t, u) => t + (u.health ?? TYPES_BY_ID[u.type].maxHealth), 0);
            const mine = hpOf('player'), theirs = hpOf('computer');
            const pct = odds && odds.played ? Math.round((odds.won / odds.played) * 100) : null;
            const b = demo.bounty?.target === raidOn.id ? demo.bountyPayout() : 0;
            return html`<span class="chip hwang mono">${raidOn.id === 'void' ? `격파 전리품 ${demo.boss?.reward ?? 0} α · ${demo.boss?.left ?? 0}블록 남음` : `노획 예상 광석 ${n(Math.floor(raidOn.ore * 0.6))}${b ? ` + 현상금 ${b} α` : ''}`}</span><span class="chip ${mine < theirs * 0.7 ? 'jeok' : 'cheong'} mono">전력 ${mine} vs ${theirs}${mine < theirs * 0.7 ? ' · 열세!' : ''}</span>
              <span class="chip ${pct == null ? '' : pct >= 60 ? 'cheong' : pct >= 35 ? 'hwang' : 'jeok'} mono odds" title="자동 지휘(어려움) 기준 모의 교전">${pct == null ? '승률 계산 중…' : `예상 승률 ${pct}%`}${odds && odds.played < 16 ? ` · ${odds.played}/16` : ''}</span>`;
          })() : ''}
          ${mode === 'single' && !raidOn && !mission ? html`<span class="chip ${spent() > budget() ? 'jeok' : 'cheong'} mono">편성 점수 ${n(spent())} / ${n(budget())}</span>` : ''}
          <span class="end" style="display:flex;gap:8px;flex-wrap:wrap">${run || raidOn || mission ? '' : html`<button class="btn ghost" data-act="reroll">다시 뽑기 <kbd>R</kbd></button>`}<button class="btn ghost" data-act="toSetup">설정으로</button><button class="btn danger lg" data-act="start">전투 시작 <kbd>Enter</kbd></button></span></div>
        <div class="bt-legend"><span class="c-cheong">◀ 내 함대</span><span class="c-jeok">컴퓨터 함대 · ${DIFF_KO[diff]} ▶</span></div>
        ${mission ? html`<div class="briefing"><span class="label c-jeok">작전 브리핑 · ${mission.place}</span><p>${mission.brief}</p><p class="mc-lesson">전술 · ${mission.lesson}</p></div>` : ''}
        ${raidOn ? html`<p class="note">데모 함대가 그대로 출격합니다. 입은 피해는 기지로 돌아가서도 남습니다 — 함교에서 수리하세요. 약탈한 광석은 정제하기 전까지 다시 빼앗길 수 있습니다.</p>` : ''}
        ${mode === 'single' && !raidOn && !mission ? html`<p class="note">내 칸을 눌러 유닛을 바꾸거나 빈 칸에 배치하세요. 적 함대 점수(건설 난이도 합)의 115%까지 쓸 수 있습니다.</p>` : ''}
        ${run ? html`<div class="run-track">${GAUNTLET_ROUNDS.map((_, i) => html`<span class="${i + 1 < run!.round ? 'done' : i + 1 === run!.round ? 'now' : ''}">${i + 1} · ${ROUND_KO[i]}</span>`)}</div>` : ''}
        ${editing ? editor() : ''}
        <div id="bd-host"></div></section>`,
      battle: () => html`<div class="row">
        <section class="card grow game-panel bt-stage" style="padding:0;gap:0">
          <div class="bt-top">${strength('you')}<div class="bt-mid"><span class="label">블록</span><strong class="mono">#${chain?.height ?? 0}</strong><span class="mono faint">${blockMs / 1000}초</span></div>${strength('cpu')}</div>
          <div id="bd-host"></div>
          <div class="bt-bar">
            <span class="bt-hint">${replaying ? '▶ 리플레이 재생 중 · F로 배속' : autopilot ? '자동 조종 중 — A로 해제' : picked && guard ? raw(`<b>${typeName(picked)}</b> 방어 지정 · 지킬 아군을 누르세요`) : picked ? raw(`<b>${typeName(picked)}</b> 선택 · 깜빡이는 적을 누르세요 · D로 방어 지정`) : '내 유닛을 눌러 선택하세요'}${queued ? ' · 다음 블록에 발사' : ''}</span>
            <span class="end" style="display:flex;gap:6px;flex-wrap:wrap">
              <button class="pill ${ws === 'primaryWeapon' ? 'on' : ''}" data-act="ws" data-v="primaryWeapon">주무기 <kbd>1</kbd></button>
              <button class="pill ${ws === 'secondaryWeapon' ? 'on' : ''}" data-act="ws" data-v="secondaryWeapon">보조무기 <kbd>2</kbd></button>
              <button class="pill ${guard ? 'on' : ''}" data-act="guard" ${picked ? '' : 'disabled'}>방어 지정 <kbd>D</kbd></button>
              <button class="pill ${moving ? 'on' : ''}" data-act="move" ${picked && chain && chain.typeOf(chain.get(picked)!).movable ? '' : 'disabled'} title="지휘함만 전장을 옮길 수 있습니다">이동 <kbd>M</kbd></button>
              <button class="pill" data-act="stealth" ${picked && chain && chain.typeOf(chain.get(picked)!).unitDefenses === 'stealthMode' ? '' : 'disabled'}>${picked && chain?.isHidden(chain.get(picked)!) ? '은신 해제' : '은신'} <kbd>S</kbd></button>
              <button class="pill ${autopilot ? 'on' : ''}" data-act="autopilot">자동 <kbd>A</kbd></button>
              <button class="pill ${mult > 1 ? 'on' : ''}" data-act="speed">${mult}× <kbd>F</kbd></button>
              <button class="pill" data-act="pause">${paused ? '재개' : '일시정지'} <kbd>Space</kbd></button></span>
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
            ${(() => { const best = Object.values(ace).sort((a, z) => z.kills * 10 + z.dmg - (a.kills * 10 + a.dmg))[0]; return best && (best.dmg || best.kills) ? html`<div class="mvp">${pixel(best.type, 56)}<div><span class="label c-hwang">최우수 전투원</span><b>${STRUCT_TYPE[best.type] ?? best.type}</b><span class="mono">피해 ${best.dmg} · 격파 ${best.kills}</span></div></div>` : ''; })()}
            ${mission && winner === 'player' ? (() => { const next = MISSIONS[mission.no]; return next ? html`<a class="btn danger" href="${href('/sim?mission=' + next.id)}">다음 작전 · ${next.title}</a>` : html`<span class="chip hwang">작전 완수 · 붉은 연합 격파</span>`; })() : ''}
            ${mission ? html`<a class="btn ghost" href="${href('/campaign')}">작전 지도</a>` : ''}
            ${raidOn && loot ? html`<span class="chip ${loot.ore || loot.alpha ? 'hwang' : 'jeok'} mono" style="font-size:16px">${loot.alpha ? `전리품 +${n(loot.alpha)} α` : loot.ore ? `노획 광석 +${n(loot.ore)}` : '노획 없음'}</span><a class="btn gold" href="${href('/console')}">함교로 귀환</a>` : ''}
            ${run?.offers ? html`<div class="offers"><span class="label c-hwang">증원 선택 · 1기</span>${run.offers.map((o, i) => html`<button class="offer" data-act="reinforce" data-i="${i}">${pixel(o.type, 56)}<b>${STRUCT_TYPE[o.type]}</b><span class="mono faint">${AMBIT[o.ambit]} ${o.slot + 1} · HP ${TYPES_BY_ID[o.type].maxHealth}</span></button>`)}</div>` : ''}
            ${run?.over ? html`<span class="chip ${run.won ? 'hwang' : 'jeok'}">${run.won ? '연전 제패!' : `연전 종료 · ${run.round}라운드`}</span>` : ''}
            <div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:center">${run && !run.over ? '' : html`<button class="btn primary" data-act="again">${run ? '새 연전' : '재도전'} <kbd>Enter</kbd></button>`}<button class="btn ghost" data-act="toSetup">설정으로</button><a class="btn gold" href="${href('/chat')}">채팅에 도전 공유</a></div>
          </section>
          <section class="card grow game-panel"><h2>전투 통계</h2>
            <div class="scroll-x"><table class="t" style="min-width:420px"><thead><tr><th>항목</th><th class="r c-cheong">나</th><th class="r c-jeok">컴퓨터</th></tr></thead><tbody>
              ${([['손실', 'lost'], ['공격', 'attacks'], ['피해', 'damage'], ['회피', 'evaded'], ['차단', 'blocked'], ['반격 피해', 'counter']] as [string, keyof Side][]).map(([l, k]) => html`<tr><td>${l}</td><td class="r mono">${p[k]}</td><td class="r mono">${c[k]}</td></tr>`)}
            </tbody></table></div>
            <div id="bd-host"></div>
            <div class="replay-row"><button class="btn primary" data-act="replay">▶ 전투 다시 보기</button>
              <input class="input" readonly value="${replayLink()}" aria-label="리플레이 공유 링크" style="flex:1 1 220px;font-size:12px"><button class="btn ghost" data-act="copyReplay">링크 복사</button></div>
          </section></div>`;
      },
    };

    const editor = (): Safe => {
      const e = editing!;
      const options = FLEET_TYPES.filter((t) => t.id !== COMMAND_SHIP_ID && fits(t.id, e.ambit));
      const free = budget() - spent() + (e.unit ? cost(e.unit.type) : 0);
      return html`<div class="editor"><div class="card-head"><b>${AMBIT[e.ambit]} ${e.slot + 1}번 칸</b><span class="mono dim">남은 점수 ${n(free)}</span>
        <span class="end" style="display:flex;gap:6px">${e.unit && e.unit.type !== COMMAND_SHIP_ID ? html`<button class="btn outline-danger" data-act="remove">제거</button>` : ''}<button class="btn ghost" data-act="closeEdit">닫기</button></span></div>
        <div class="build-grid">${options.map((t) => html`<button class="build-opt ${e.unit?.type === t.id ? 'on' : ''}" data-act="place" data-type="${t.id}" ${cost(t.id) > free ? 'disabled' : ''}>${pixel(t.id, 40)}<b>${STRUCT_TYPE[t.id]}</b><span class="mono faint">${n(cost(t.id))}점 · HP ${t.maxHealth}</span></button>`)}</div></div>`;
    };
    const replayLink = () => location.origin + href('/sim?replay=') + encodeReplay({ units, seed, start: 1000, charge, txs: orders, title: mission ? mission.title : undefined, winner: winner ?? undefined });
    const watch = (o: typeof orders) => { replaying = true; replayOrders = o; autopilot = false; start(); };
    const steps = (): Safe => html`<nav aria-label="시뮬레이션 단계" class="tabs steps">${(['setup', 'deploy', 'battle', 'debrief'] as Phase[]).map((p, i) => html`<span class="tab ${phase === p ? 'on' : ''}" aria-current="${phase === p ? 'step' : 'false'}">${i + 1} · ${{ setup: '설정', deploy: '배치', battle: '전투', debrief: '결과' }[p]}</span>`)}</nav>`;
    const paint = () => {
      if (!root.isConnected) return;
      mount(root, html`<h1 class="sr">전투 시뮬레이터</h1>${steps()}${views[phase]()}`, handlers);
      const host = root.querySelector('#bd-host');
      if (host && board) board.attach(host);
    };
    const toDeploy = () => {
      editing = null;
      if (mission) {
        run = null; units = missionUnits(mission); diff = mission.difficulty; charge = mission.charge; seed = 'MISSION-' + mission.id;
        phase = 'deploy'; newBoard().setStructs(units.map(fromUnit)); paint();
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
        newBoard().setStructs(units.map(fromUnit));
        stopOdds?.(); odds = null;
        stopOdds = estimateOdds(units, diff, 16, (won, played) => { odds = { won, played }; if (root.isConnected && phase === 'deploy') paint(); });
        paint();
        return;
      }
      if (mode === 'daily') { run = null; const d = dailyScenario(); units = d.units; seed = d.seed; diff = d.difficulty; }
      else if (mode === 'gauntlet') {
        if (!run || run.over) run = { round: 1, fleet: layout('difficult', seed).filter((u) => u.side === 'player'), seed, offers: null, over: false, won: false };
        diff = GAUNTLET_ROUNDS[run.round - 1].difficulty;
        units = [...run.fleet, ...gauntletEnemy(run.round, run.seed, run.fleet.length)];
      } else { run = null; units = layout(preset, seed); }
      chain = null; phase = 'deploy';
      newBoard().setStructs(units.map(fromUnit));
      paint();
    };
    const handlers = {
      mode: (el: HTMLElement) => { mode = el.dataset.v!; paint(); },
      diff: (el: HTMLElement) => { diff = el.dataset.v as Difficulty; paint(); },
      preset: (el: HTMLElement) => { preset = el.dataset.v as Preset; paint(); },
      block: (el: HTMLElement) => { blockMs = Number(el.dataset.v); paint(); },
      charge: (el: HTMLElement) => { charge = Number((el as HTMLInputElement).value); paint(); },
      seed: (el: HTMLElement) => { seed = (el as HTMLInputElement).value || seed; },
      toSetup: () => { running = false; chain = null; board?.dispose(); board = null; phase = 'setup'; paint(); },
      toDeploy,
      replay: () => watch(orders.slice()),
      copyReplay: () => { void navigator.clipboard?.writeText(replayLink()).then(() => { sfx.play('confirm'); notify('복사됨', '리플레이 링크를 붙여넣어 공유하세요', 'cheong', null); }).catch(() => toast('복사하지 못했습니다')); },
      again: () => { if (mission) { start(); return; } if (raidOn) { go('/console'); return; } if (run?.over) { run = null; seed = 'KR-' + Math.random().toString(36).slice(2, 7).toUpperCase(); toDeploy(); } else start(); },
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
      reroll: () => { seed = 'KR-' + Math.random().toString(36).slice(2, 7).toUpperCase(); units = layout(preset, seed); board?.setStructs(units.map(fromUnit)); paint(); },
      start,
      ws: (el: HTMLElement) => { ws = el.dataset.v as WeaponSystem; markTargets(); paint(); },
      autopilot: () => { autopilot = !autopilot; paint(); },
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
          for (let slot = 0; slot < 4; slot++) if (!Object.values(chain.structs).some((o) => o.owner === YOU.id && o.typeId !== COMMAND_SHIP_ID && o.ambit === a && o.slot === slot && !chain!.isDestroyed(o))) keys.push(`fleet|defender|${a}|${slot}`);
        }
        board?.markTiles(keys); markTargets(); paint();
      },
      stealth: () => {
        if (!picked || !chain) return;
        const s = chain.get(picked)!;
        if (chain.typeOf(s).unitDefenses !== 'stealthMode') { sfx.play('error'); notify('은신 불가', `${typeName(picked)}에는 은신 장치가 없습니다`, 'jeok', null); return; }
        const on = chain.isHidden(s);
        queued = { '@type': on ? '/structs.structs.MsgStructStealthDeactivate' : '/structs.structs.MsgStructStealthActivate', structId: picked };
        sfx.play('evade'); notify(on ? '은신 해제' : '은신', `${typeName(picked)} · 다음 블록`, 'cheong', null); paint();
      },
      speed: () => { mult = mult >= 4 ? 1 : mult * 2; if (board) board.speed = (blockMs < 4000 ? 1.6 : 1.2) * mult; paint(); },
      pause: () => { paused = !paused; paint(); },
    };
    const offKeys = keys.scope({
      z: () => board?.toggleZoom(),
      Enter: () => (phase === 'setup' ? toDeploy() : phase === 'deploy' ? start() : phase === 'debrief' && !(run && !run.over) ? handlers.again() : undefined),
      r: () => phase === 'deploy' && !run && !raidOn && !mission && handlers.reroll(),
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
    const shared = params.get('replay') ? decodeReplay(params.get('replay')!) : null;
    if (shared) {
      units = shared.units; seed = shared.seed; charge = shared.charge ?? 10;
      notify('리플레이', shared.title ? `${shared.title} 다시 보기` : '공유된 전투를 재생합니다', 'cheong', null);
      watch(shared.txs);
    } else if (params.get('replay')) { toast('리플레이 링크를 읽지 못했습니다', 4000); paint(); }
    else if (mission) toDeploy();
    else if (raidOn) {
      if (!demo.fleetUnits().units.some((u) => u.type === COMMAND_SHIP_ID)) { mount(root, html`<section class="card game-panel" style="max-width:560px;margin:40px auto"><h1 style="font-size:28px">출격 불가</h1><p class="note">지휘함이 없습니다. 함교에서 지휘함을 수리한 뒤 출격하세요.</p><a class="btn primary" href="${href('/console')}">함교로</a></section>`); return () => offKeys(); }
      toDeploy();
    } else paint();
    void daily().then((d) => { ladder = d; if (phase === 'setup') paint(); }).catch(() => null);
    return () => { running = false; stopOdds?.(); music.setMode('calm'); offKeys(); board?.dispose(); };
  },
};
export default screen;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
