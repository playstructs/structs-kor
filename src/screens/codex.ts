/* 교본 (codex): every system of the game on one page, its numbers read from the game itself (so the
 * page can't drift from the rules), each with a link to where it's played. */
import type { Screen } from '../router';
import { href } from '../router';
import { html, mount, raw, type Safe } from '../ui/dom';
import { INVEST, GRUDGE, COALITION, REVENGE, REFITS, BLACK, BLACK_DEALS, JOBS, ABILITIES, EVENTS, ALLY, OUTPOSTS, OUTPOST, DOMINION, HEGEMONY, OC, DOCTRINES, DOCTRINE_SWITCH, BOUNTY, VOID, RACE, LOAN, OPS, REPS, ENGINE, RATE, DECISION, WAR, TEMPER, type OpId } from '../game/demo';
import { spriteHtml } from '../game/map/art';
import { setTiles } from '../ui/shell';

interface Entry { icon: number; title: string; body: Safe; go?: [string, string] }
const pct = (x: number) => `${Math.round(x * 100)}%`;

const SECTIONS: [string, string, Entry[]][] = [
  ['경제', '광석을 캐고, 알파로 정제하고, 전력을 판다.', [
    { icon: 14, title: '채굴과 정제', body: html`추출기가 광석을 캐고(블록당 ${RATE.mine}), 정제소가 알파로 바꿉니다(블록당 ${RATE.refine}). <b>광석은 약탈당하지만 알파는 안전합니다.</b> 습격 전에 정제하세요.`, go: ['/console', '함교'] },
    { icon: 20, title: '전력', body: html`리액터 ${RATE.baseKw} kW와 발전기마다 ${RATE.genKw} kW. 구조체와 판매 계약이 용량을 넘으면 정전: 판매 계약부터 끊기고, 그다음 구조체가 꺼집니다.`, go: ['/energy', '전력망'] },
    { icon: 17, title: '전력 거래', body: html`남는 전력을 블록당 알파에 팝니다. 한 계약 최대 ${RATE.maxDealKw} kW, 시장 전체 ${RATE.marketDepthKw} kW. 큰 판매는 가격을 떨어뜨립니다. 사들인 전력은 되팔 수 없습니다.`, go: ['/market', '거래소'] },
    { icon: 15, title: '과부하 운전', body: html`추출기·정제소 생산 ×${OC.out}, 전력 ×${OC.power}. 발전기는 발전 ×${OC.gen}. 블록마다 ${pct(OC.wear)} 확률로 손상. 구조체를 고르고 <kbd>V</kbd>.`, go: ['/console', '함교'] },
    { icon: 18, title: '의뢰 게시판', body: html`${JOBS.every}블록마다 세력들이 의뢰를 올립니다. 납품: 광석을 정제가보다 10–25% 비싸게 즉시 사 줍니다 (습격 전에 광석을 비우기 좋습니다). 방어: ${JOBS.defendFor}블록 안에 습격을 2번 막으면 보수.`, go: ['/market', '거래소'] },
    { icon: 16, title: '암시장', body: html`약 ${BLACK.every}블록마다 밀수선이 ${BLACK.stays}블록 동안 들어와 세 가지 거래를 한 번씩만 엽니다. 값은 매번 다릅니다: ${Object.values(BLACK_DEALS).map((d) => `${d.name}(${d.what})`).join(' · ')}.`, go: ['/market', '거래소'] },
    { icon: 17, title: '투자', body: html`은하 지도에서 세력에 알파를 맡기면(최대 ${INVEST.max} g) 그 세력 금고에서 블록마다 지분의 ${(INVEST.rate * 100).toFixed(1)}%를 배당받습니다(사보타주 중엔 절반). 지분은 내 세력으로 칩니다. 그 세력을 약탈하면 지분 ${Math.round(INVEST.raidHit * 100)}%를 잃고, 매각하면 ${Math.round(INVEST.fee * 100)}%를 떼입니다. 붉은 연합은 받지 않습니다.`, go: ['/galaxy', '은하 지도'] },
    { icon: 17, title: '대출', body: html`청룡 상단에서 최대 ${LOAN.max} g. ${LOAN.term}블록 뒤 ${pct(LOAN.rate)}를 더해 갚습니다. 불이행하면 광석을 두 배로 압류하고 함대를 보내며, 한동안 다시 빌릴 수 없습니다.`, go: ['/market', '거래소'] },
  ]],
  ['세력', '은하의 다른 세력을 꺾고, 부리고, 늦춘다.', [
    { icon: 3, title: '습격', body: html`은하 지도에서 세력을 고르고 출격. 이기면 비축 광석을 약탈하고 그 세력의 함대가 1기 줄어 다음엔 더 쉬워집니다. 정찰(1 g)하면 맞설 함대와 예상 승률을 볼 수 있습니다.`, go: ['/galaxy', '은하 지도'] },
    { icon: 9, title: '베테랑', body: html`습격과 기지 방어전에서 적을 격파한 내 함선·방어포는 전과가 쌓여 베테랑이 됩니다(방어전이 끝나면 함교에 전투 보고): ★ 3격파 · ★★ 8격파 · ★★★ 15격파. ★★부터 기지 방어 사격 피해 +1. 동맹 함선의 전과는 쌓이지 않습니다.`, go: ['/galaxy', '은하 지도'] },
    { icon: 1, title: '연합 전선', body: html`패권 지수가 ${Math.round(COALITION.at * 100)}%를 넘으면 은하가 뭉칩니다. 습격의 ${Math.round(COALITION.chance * 100)}%가 두 세력의 연합 함대로 오고, 호위함이 ${COALITION.extra}척 많습니다. 막아내면 두 세력 모두 함대를 잃습니다.`, go: ['/console', '함교'] },
    { icon: 3, title: '보복', body: html`습격을 막아내면 그 세력이 ${REVENGE.window}블록 동안 드러납니다. 그 안에 반격해 이기면 노획 +${Math.round((REVENGE.bonus - 1) * 100)}%. 이기든 지든 기회는 한 번입니다.`, go: ['/galaxy', '은하 지도'] },
    { icon: 3, title: '개장', body: html`함대 함선마다 모듈 하나: ${Object.values(REFITS).map((r) => `${r.name}(${r.what}, ${r.cost} α)`).join(' · ')}. 바꾸면 다시 값을 치르고, 함선이 파괴되면 모듈도 사라집니다. 함교에서 함선을 눌러 고릅니다.`, go: ['/console', '함교'] },
    { icon: 1, title: '복속', body: html`${DOMINION.raidsToSubjugate}번 약탈한 세력에게 복속을 요구(${DOMINION.cost} g). 속국은 성장의 ${pct(DOMINION.tribute)}를 공물로 바치고 습격하지 않습니다. 함대가 ${DOMINION.rebelFleet}기가 되면 반란 위험: 함선 해체(${DOMINION.disarmCost} g)로 막으세요.`, go: ['/galaxy', '은하 지도'] },
    { icon: 4, title: '동맹', body: html`${ALLY.cost} g로 한 세력과 ${ALLY.term}블록 동맹. 동맹은 습격·거점 공격·현상금 대상에서 빠지고, 당신의 습격에 빈 슬롯만큼 함선을 최대 ${ALLY.ships.length}척 보냅니다. 공작을 벌이면 깨집니다. 붉은 연합은 동맹을 맺지 않습니다.`, go: ['/galaxy', '은하 지도'] },
    { icon: 6, title: '공작', body: html`${(Object.keys(OPS) as OpId[]).map((k) => `${OPS[k].name} ${OPS[k].cost} g · 성공 ${pct(OPS[k].odds)}(첩보망 연구로 상승) · ${OPS[k].what}`).join(' / ')}. 발각되면 불가침이 깨지고 보복 함대가 옵니다.`, go: ['/galaxy', '은하 지도'] },
    { icon: 2, title: '현상금', body: html`${BOUNTY.every}블록마다 한 세력이 다른 세력에 현상금을 겁니다(지도의 ◆). ${BOUNTY.lasts}블록 안에 그 세력을 습격해 이기면 받습니다.`, go: ['/galaxy', '은하 지도'] },
    { icon: 10, title: '거점', body: html`${OUTPOSTS.map((o) => `${o.name}(${o.perk})`).join(' · ')}. 공략 ${OUTPOST.claim} g · 성공률은 내 전함 대 (기본 수비 + 수비대 레벨×2 + 점령 세력 함대의 절반). 요새화 ${OUTPOST.fortify} g(최대 ${OUTPOST.maxGarrison}). ${OUTPOST.contestEvery}블록마다 경쟁 세력이 빼앗으려 하고, 비어 있는 거점은 먼저 차지해 버립니다. 거점마다 세력 +40.`, go: ['/galaxy', '은하 지도'] },
    { icon: 2, title: '원한', body: html`약탈당한 세력은 잊지 않습니다. 이길 때마다 원한이 1 쌓이고(최대 ${GRUDGE.max}), 원한 하나마다 그 세력이 당신을 습격하러 올 확률이 ${Math.round(GRUDGE.per * 100)}% 오릅니다. ${GRUDGE.fade}블록마다 하나씩 옅어집니다. 한 세력만 털지, 고루 털지 정하세요. 은하 지도의 위협 칸이 다음 습격의 가장 유력한 세력과 확률을 보여 줍니다.`, go: ['/galaxy', '은하 지도'] },
    { icon: 4, title: '세력의 성향', body: html`${Object.entries(TEMPER).map(([, t]) => `${t.name}: ${t.note}`).join(' · ')}. 세력끼리도 ${WAR.every}블록마다 서로 습격합니다.`, go: ['/galaxy', '은하 지도'] },
  ]],
  ['결단과 위기', '은하가 당신에게 선택을 요구한다.', [
    { icon: 16, title: '결단', body: html`약 ${DECISION.every}블록마다 함교에 선택지가 옵니다(밀수, 불가침, 광석 매입, 용병, 최후통첩). ${DECISION.open}블록 안에 <kbd>1</kbd> · <kbd>2</kbd>로 정하세요.`, go: ['/console', '함교'] },
    { icon: 16, title: '은하 사건', body: html`때때로 은하의 날씨가 바뀝니다. ${Object.values(EVENTS).map((e) => `${e.name}: ${e.text}`).join(' / ')}.`, go: ['/console', '함교'] },
    { icon: 2, title: '공허 함대', body: html`${VOID.every}블록마다 나타나 ${VOID.stays}블록 머뭅니다. 요격하면 ${VOID.reward} α부터. 놓아두면 당신이나 경쟁 세력 중 하나를 덮칩니다.`, go: ['/galaxy', '은하 지도'] },
    { icon: 1, title: '지휘관 능력', body: html`함교의 즉발 능력, 계급으로 해금: ${ABILITIES.map((a) => `${a.name} [${a.key}] · ${a.what} · 재사용 ${a.cooldown}블록`).join(' / ')}.`, go: ['/console', '함교'] },
    { icon: 19, title: '방어', body: html`습격 함대는 ${RATE.raidEta}블록 전에 경보가 울립니다. 그동안 태세를 고르세요: 요격(함포 추가 피해 확률 +30%p, 강타당할 확률도 증가) 또는 참호(방어막 차단 확률 1.6배, 강타 확률 절반, 함포 추가 피해 확률 −10%p · 습격 시한이 끝날 때 방어막이 20% + 남은 적 1척당 8% 이상이면 적이 철수: 광석은 지키지만 적 함대도 보복 기회도 없습니다). 요격은 빨리 부수는 쪽, 참호는 버티는 쪽입니다. 경보 막대에는 지금 기지로 이 습격을 태세별로 40번씩 모의한 예상 승률이 나옵니다. 함대와 방어포가 반격하고, 방어막이 공격을 막습니다. 무너지면 정제되지 않은 광석을 모두 잃습니다. 처음 세 번의 습격은 작게 옵니다.`, go: ['/console', '함교'] },
  ]],
  ['성장', '오래 버틴 제국이 강하다.', [
    { icon: 15, title: '연구와 교리', body: html`연구는 영구 강화: 경제·전력·방어, 그리고 장교에게 열리는 패권(첩보망·거점 공병·제국 관료제). 교리는 하나만: ${DOCTRINES.map((d) => `${d.name}(${d.perks.join(', ')})`).join(' · ')}. 첫 선택은 무료, 전환 ${DOCTRINE_SWITCH} g.`, go: ['/research', '연구소'] },
    { icon: 8, title: '레플리칸트', body: html`${REPS.map((r) => `${r.role}(${r.hire} g, 급여 ${r.upkeep} α/블록)`).join(' · ')}. 급여를 못 주면 떠납니다.`, go: ['/replicants', '레플리칸트'] },
    { icon: 18, title: '길드 전', body: html`세 길드가 ${RACE.season}블록 시즌으로 겨룹니다. 기부·격퇴·현상금이 점수. 시즌 시작 전부터 있던 우승 길드원은 ${RACE.prize} α.`, go: ['/guild', '길드'] },
    { icon: 20, title: '패권과 시대', body: html`패권 지수 = 은하 전체 세력 중 내 몫. 칭호: ${HEGEMONY.map((h) => `${h.title} ${pct(h.at)}`).join(' → ')}. 월드 엔진(${ENGINE.map((e) => e.cost).join(' / ')} α)을 완공하면 새 시대를 열어 생산 +15%로 다시 시작합니다. 연구·교리·길드·거점·레플리칸트는 그대로 남습니다.`, go: ['/record', '전적'] },
  ]],
];

const screen: Screen = {
  render(root) {
    mount(root, html`
      <div class="card-head"><h1 style="font-size:28px">교본</h1><span class="label c-cheong">CODEX</span><span class="end note">모든 수치는 게임에서 그대로 읽어 옵니다</span></div>
      ${SECTIONS.map(([name, sub, entries]) => html`<section class="codex-sec"><h2>${name}</h2><p class="note">${sub}</p>
        <div class="codex-grid">${entries.map((e) => html`<article class="codex-card">
          <div class="tech-top">${raw(spriteHtml(e.icon, 48))}<b>${e.title}</b></div>
          <p>${e.body}</p>
          ${e.go ? html`<a class="btn ghost" href="${href(e.go[0])}">${e.go[1]} →</a>` : ''}
        </article>`)}</div></section>`)}`);
    setTiles([]);
  },
};
export default screen;
