/* 참모 (the advisor): reads the demo base and the galaxy and names the three moves that matter
 * most right now, most urgent first, each with a button that goes and does something about it. */
import { demo, DOMINION, ENGINE, OUTPOST, OPS, opOdds } from './demo';
import type { Dashboard } from '../api/planned';
import { STRUCT_TYPE } from '../i18n/ko';

export interface Tip { pri: number; tone: 'jeok' | 'hwang' | 'cheong'; text: string; go: string; cta: string }

export function advise(): Tip[] {
  const st = demo.state, tips: Tip[] = [];
  const raid = demo.raid, r = demo.rates();
  if (raid && raid.eta > 0 && st.ore >= 20) tips.push({ pri: 100, tone: 'jeok', text: `${raid.name} 함대 ${raid.eta}블록 후 도착 · 정제되지 않은 광석 ${Math.floor(st.ore)} 단위가 노출되어 있습니다. 정제하거나 팔아 지키세요.`, go: '/market', cta: '거래소' });
  const hurt = st.structs.filter((x) => x.hp > 0 && x.hp < x.max * 0.5).length, dead = st.structs.filter((x) => x.hp <= 0).length;
  if (dead + hurt) tips.push({ pri: raid ? 85 : 60, tone: 'jeok', text: `구조체 ${dead ? `${dead}기 파괴` : ''}${dead && hurt ? ' · ' : ''}${hurt ? `${hurt}기 중파` : ''}. 다음 습격 전에 수리하세요.`, go: '/console', cta: '함교' });
  const NAMES: Record<number, string> = { 14: '광석 추출기', 15: '정제소', 20: '발전기', 16: '방어막 발생기', 19: '방어포' };
  const idle = st.structs.filter((x) => x.hp > 0 && !x.online && x.building == null && NAMES[x.type]);
  if (idle.length) tips.push({ pri: 88, tone: 'jeok', text: `${idle.map((x) => NAMES[x.type]).join(', ')} 꺼짐 · 켜지 않으면 ${idle.some((x) => x.type === 15) ? '광석이 정제되지 않고 쌓여 약탈됩니다' : '생산이 멈춥니다'}. 눌러서 F로 켜세요.`, go: '/console', cta: '함교' });
  const worn = st.structs.filter((x) => x.oc && x.hp > 0 && x.hp <= Math.max(1, x.max * 0.34));
  if (worn.length) tips.push({ pri: 82, tone: 'jeok', text: `과부하 운전 중인 ${worn.map((x) => NAMES[x.type] ?? '구조체').join(', ')} 내구도 위험 · 해제하거나 수리하지 않으면 곧 파괴됩니다.`, go: '/console', cta: '함교' });
  const use = (demo.structsKw() + demo.soldKw()) / Math.max(0.01, demo.capacityKw());
  if (use > 0.92) tips.push({ pri: 80, tone: 'jeok', text: `전력 사용률 ${Math.round(use * 100)}% · 발전기 하나만 잃어도 정전입니다. 리액터에 알파를 주입하세요.`, go: '/energy', cta: '전력망' });
  const hist = demo.priceHist, avg = hist.slice(-30).reduce((a, x) => a + x, 0) / Math.min(30, hist.length);
  if (demo.price > avg * 1.15 && demo.sellableKw() >= 0.5) tips.push({ pri: 70, tone: 'cheong', text: `전력 가격이 평균보다 ${Math.round((demo.price / avg - 1) * 100)}% 높습니다. 여유 ${demo.sellableKw().toFixed(1)} kW를 팔 때입니다.`, go: '/market', cta: '판매' });
  else if (demo.price < avg * 0.8) tips.push({ pri: 45, tone: 'hwang', text: `전력 가격 바닥 (평균의 ${Math.round((demo.price / avg) * 100)}%). 사서 건설을 서두를 때입니다.`, go: '/market', cta: '구매' });
  if (r.ore > 0.3 && st.ore > 60) tips.push({ pri: 55, tone: 'hwang', text: `광석이 정제보다 빨리 쌓입니다 (+${r.ore.toFixed(1)}/블록). 정제소를 늘리면 약탈 손실이 줄어듭니다.`, go: '/console', cta: '건설' });
  for (const x of demo.rivals()) {
    if (x.vassal != null && demo.loyalty(x) <= 0.25) tips.push({ pri: 75, tone: 'jeok', text: `속국 ${x.name}의 함대가 ${x.fleet}기로 늘었습니다. 반란 전에 함선을 해체시키세요 (${DOMINION.disarmCost} g).`, go: '/galaxy', cta: '은하 지도' });
    else if (x.vassal == null && x.raided >= DOMINION.raidsToSubjugate && st.alpha >= DOMINION.cost) tips.push({ pri: 65, tone: 'hwang', text: `${x.name}을(를) ${x.raided}번 약탈했습니다. 이제 복속을 요구할 수 있습니다.`, go: '/galaxy', cta: '복속' });
  }
  const loan = demo.loan;
  if (loan && loan.left < 40) tips.push({ pri: st.alpha >= loan.owed ? 66 : 92, tone: st.alpha >= loan.owed ? 'hwang' : 'jeok', text: st.alpha >= loan.owed ? `청룡 상단 대출 ${loan.left}블록 뒤 만기 · 금고에서 ${loan.owed.toFixed(1)} α가 나갑니다.` : `대출 만기 ${loan.left}블록 · ${loan.owed.toFixed(1)} α가 필요한데 부족합니다! 광석 압류와 습격이 옵니다.`, go: '/market', cta: '거래소' });
  // An outpost within reach.
  const site = demo.outposts.filter((o) => !o.mine).sort((a, z) => z.odds - a.odds)[0];
  if (site && site.odds >= 0.5 && st.alpha >= OUTPOST.claim) tips.push({ pri: 47, tone: 'cheong', text: `${site.name} 공략 성공률 ${Math.round(site.odds * 100)}% · 장악하면 ${site.perk}.`, go: '/galaxy', cta: '거점' });
  const v = demo.boss;
  if (v) tips.push({ pri: 86, tone: 'jeok', text: `공허 함대 출현 · ${v.left}블록 뒤 누군가를 덮칩니다. 요격하면 ${v.reward} α.`, go: '/sim?raid=void', cta: '요격' });
  const b = demo.bounty, bt = b && demo.rivals().find((x) => x.id === b.target);
  if (b && bt && bt.vassal == null) tips.push({ pri: 68, tone: 'hwang', text: `${bt.name}에게 현상금 ${demo.bountyPayout()} α · ${b.left}블록 남음. 습격에 이기면 노획과 함께 받습니다.`, go: `/sim?raid=${bt.id}`, cta: '습격' });
  // A small fleet can't strike back: building warships is free, it only takes power.
  const ships = st.structs.filter((x) => x.cat === 'fleet' && x.type !== 1 && x.hp > 0).length;
  if (ships < 5 && demo.capacityKw() - demo.structsKw() - demo.soldKw() >= 0.6) tips.push({ pri: 48, tone: 'cheong', text: `함대 ${ships}척 · 여유 전력으로 함대 슬롯에 전함을 건조하면 습격 승률이 오릅니다 (건조는 전력만 듭니다).`, go: '/console', cta: '함교' });
  // The strongest free rival pulling away: slow it down.
  const lead = demo.rivals().filter((x) => x.vassal == null).sort((a, z) => demo.rivalWorth(z) - demo.rivalWorth(a))[0];
  if (lead && demo.rivalWorth(lead) > demo.netWorth() * 1.3 && !((lead.sabotaged ?? 0) > st.height) && st.alpha >= OPS.sabotage.cost * 2) tips.push({ pri: 42, tone: 'hwang', text: `${lead.name}이(가) 앞서 나갑니다 (세력 ${Math.round(demo.rivalWorth(lead))}). 사보타주로 성장을 절반으로 늦출 수 있습니다 (${OPS.sabotage.cost} g, ${Math.round(opOdds('sabotage') * 100)}%).`, go: '/galaxy', cta: '공작' });
  const weak = demo.rivals().filter((x) => x.vassal == null && demo.pactLeft(x.id) === 0).sort((a, b) => a.fleet - b.fleet)[0];
  if (weak && weak.fleet <= 4 && weak.ore > 30) tips.push({ pri: 50, tone: 'cheong', text: `${weak.name} 함대가 ${weak.fleet}기로 약합니다. 광석 ${Math.floor(weak.ore)} · 습격 적기입니다.`, go: `/sim?raid=${weak.id}`, cta: '습격' });
  const eng = demo.engine;
  if (!eng.done && st.alpha >= ENGINE.slice(0, eng.stage + 1).reduce((a, x) => a + x.cost, 0) - eng.paid) tips.push({ pri: 40, tone: 'hwang', text: `월드 엔진 ${ENGINE[eng.stage].name}에 필요한 알파가 모였습니다.`, go: '/console', cta: '함교' });
  if (!tips.length) tips.push({ pri: 0, tone: 'cheong', text: `전선 이상 없음. 알파 ${st.alpha.toFixed(1)} g · 블록당 +${r.alpha.toFixed(2)}. 연구로 기지를 키우세요.`, go: '/research', cta: '연구소' });
  return tips.sort((a, b) => b.pri - a.pri).slice(0, 3);
}

/* The same advisor for a signed-in commander, from the guild's dashboard and the proof engine. */

const DESTROYED = 32, ONLINE = 4;
/** `proofs` comes from the bridge (the proof engine and wallet stay out of this module). */
export function adviseReal(d: Dashboard, proofs: { ready: number; stuck: number; hashing: boolean; unlocked: boolean }): Tip[] {
  const tips: Tip[] = [];
  if (d.active_raid) tips.push({ pri: 100, tone: 'jeok', text: `행성 ${d.active_raid.planet_id}에 습격 진행 중 (함대 ${d.active_raid.fleet_id}). 내 구조체를 고른 뒤 적 구조체를 눌러 반격하세요.`, go: '/console', cta: '함교' });
  const alive = d.structs.filter((s) => !(s.status & DESTROYED) && !s.is_destroyed);
  if (!alive.some((s) => s.type === 1)) tips.push({ pri: 90, tone: 'jeok', text: '지휘함이 없습니다. 함대가 움직이지 못하고 습격도 할 수 없습니다.', go: '/console', cta: '함교' });
  const building = new Set((d.work ?? []).filter((w) => w.category === 'BUILD').map((w) => w.object_id));
  const idle = alive.filter((s) => !(s.status & ONLINE) && !building.has(s.id));
  if (idle.length) tips.push({ pri: 80, tone: 'jeok', text: `꺼진 구조체 ${idle.length}기 (${[...new Set(idle.map((s) => STRUCT_TYPE[s.type] ?? s.type))].slice(0, 3).join(', ')}). 구조체를 눌러 켜세요.`, go: '/console', cta: '함교' });
  const cap = Number(d.power?.total_capacity ?? 0), load = Number(d.power?.total_load ?? 0);
  if (cap > 0 && load / cap > 0.92) tips.push({ pri: 78, tone: 'jeok', text: `전력 사용률 ${Math.round((load / cap) * 100)}% · 정전되면 가장 오래된 할당부터 끊깁니다.`, go: '/energy', cta: '전력망' });
  const ore = Number(d.player.ore ?? 0);
  if (ore > 0 && !alive.some((s) => s.type === 15 && s.status & ONLINE)) tips.push({ pri: 70, tone: 'hwang', text: `정제되지 않은 광석 ${ore} · 습격당하면 모두 빼앗깁니다. 정제소를 가동하세요.`, go: '/console', cta: '함교' });
  const { ready, stuck } = proofs;
  if (stuck) tips.push({ pri: 75, tone: 'jeok', text: `작업 증명 ${stuck}건이 세 번 거부되었습니다. 작업 카드에서 다시 제출하세요.`, go: '/console', cta: '함교' });
  if (ready && proofs.unlocked) tips.push({ pri: 72, tone: 'hwang', text: `제출할 수 있는 증명 ${ready}건 · 작업 카드에서 바로 보내세요 (자동 제출이 꺼져 있으면).`, go: '/console', cta: '함교' });
  else if (ready && !proofs.unlocked) tips.push({ pri: 72, tone: 'hwang', text: `제출할 수 있는 증명 ${ready}건 · 지갑 잠금을 해제하면 자동으로 보냅니다.`, go: '/login', cta: '잠금 해제' });
  else if ((d.work ?? []).length && !proofs.hashing) tips.push({ pri: 60, tone: 'cheong', text: `끝내야 할 작업 ${(d.work ?? []).length}건 · 작업 증명을 시작하면 이 브라우저가 해시를 계산합니다.`, go: '/console', cta: '함교' });
  if (!tips.length) tips.push({ pri: 0, tone: 'cheong', text: '전선 이상 없음. 은하 지도에서 다음 목표를 찾아보세요.', go: '/galaxy', cta: '은하 지도' });
  return tips.sort((a, b) => b.pri - a.pri).slice(0, 3);
}
