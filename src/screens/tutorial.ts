/* 전투 훈련: the Combat Training flow from structs-webapp's tutorial-attempt-1 branch
 * (src/js/tutorial/TutorialCopy.js · TutorialDirector.js), in Korean. Simulation only: no network
 * during the steps. The finished grade is saved with the branch's mini-game endpoint (REQ-TUT-1:
 * merge it to main), else in this browser. */
import type { Screen } from '../router';
import { href } from '../router';
import { html, mount, type Safe } from '../ui/dom';
import './tutorial.css';
import { ApiError } from '../api/http';
import { guildApi } from '../api/guild';
import { session } from '../api/session';
import { fellBack, isMissing, markMissing } from '../api/requirements';
import { Board, type BoardStruct } from '../game/map/board';
import type { AttackDetail, ShotRow, CounterRow } from '../sim/chain';
import { career } from '../game/progress';
import { sfx } from '../game/sfx';
import { banner } from '../game/fx';
import { keys } from '../game/keys';
import type { Ambit } from '../data/catalogue';

/* The training field on the real battle board: your base on the left, the raiders on the right. */
type Who = 'cmd' | 'bomber' | 'tankA' | 'tankB' | 'extractor' | 'refinery' | 'enemyCmd' | 'enemyTank';
const UNIT: Record<Who, { type: number; ambit: Ambit; slot: number; side: 'defender' | 'attacker'; cat: 'planet' | 'fleet'; max: number }> = {
  cmd: { type: 1, ambit: 'land', slot: 0, side: 'defender', cat: 'fleet', max: 6 },
  bomber: { type: 6, ambit: 'air', slot: 0, side: 'defender', cat: 'fleet', max: 3 },
  tankA: { type: 9, ambit: 'land', slot: 1, side: 'defender', cat: 'fleet', max: 3 },
  tankB: { type: 9, ambit: 'land', slot: 0, side: 'defender', cat: 'fleet', max: 3 },
  extractor: { type: 14, ambit: 'land', slot: 0, side: 'defender', cat: 'planet', max: 6 },
  refinery: { type: 15, ambit: 'land', slot: 1, side: 'defender', cat: 'planet', max: 6 },
  enemyCmd: { type: 1, ambit: 'land', slot: 0, side: 'attacker', cat: 'fleet', max: 6 },
  enemyTank: { type: 9, ambit: 'land', slot: 0, side: 'attacker', cat: 'fleet', max: 3 },
};
const TYPE_NAME: Record<number, string> = { 1: 'Command Ship', 6: 'Stealth Bomber', 9: 'Tank' };
const shot = (target: Who, before: number, after: number, extra: Partial<ShotRow> = {}): ShotRow => ({
  targetStructId: target, targetStructTypeId: UNIT[target].type, targetStructType: TYPE_NAME[UNIT[target].type] ?? '', targetStructOperatingAmbit: UNIT[target].ambit, targetStructSlot: UNIT[target].slot,
  targetPlayerId: '', targetHealthBefore: before, targetHealthAfter: after, targetDestroyed: after === 0 && before > 0, targetHealthMax: UNIT[target].max, eventAttackDefenderCounterDetail: [], ...extra,
});
const counter = (by: Who, dmg: number, killed = false): CounterRow => ({ counterByStructId: by, counterDamage: dmg, counterDestroyedAttacker: killed, counterByStructType: TYPE_NAME[UNIT[by].type], counterByStructOperatingAmbit: UNIT[by].ambit, counterByStructWeaponSystem: 'primaryWeapon' });
const attack = (by: Who, hp: number, shots: ShotRow[]): AttackDetail => ({
  attackerPlayerId: '', attackerStructId: by, attackerStructTypeId: UNIT[by].type, attackerStructType: TYPE_NAME[UNIT[by].type], attackerStructOperatingAmbit: UNIT[by].ambit, attackerStructSlot: UNIT[by].slot,
  weaponSystem: 'primaryWeapon', weaponControl: 'guided', activeWeaponry: '', attackerHealthBefore: hp, attackerHealthMax: UNIT[by].max, eventAttackShotDetail: shots,
});

interface Step { id: string; ph?: number; m?: 'say' | 'ask'; pos?: 't' | 'b'; k?: string; p?: string; tg?: string[]; t?: string; scr?: 'file' | 'loading' | 'cert' | 'ftl' }
const S: Step[] = [
  { id: 'FILE', scr: 'file' }, { id: 'LOADING', scr: 'loading' },
  { id: 'WELCOME', ph: 0, m: 'say', k: '전투 훈련', t: '전투 훈련에 오신 것을 환영합니다. 이 시뮬레이션에서 미개척 지역의 채굴 기지를 방어하는 법을 배웁니다.' },
  { id: 'ALPHA_BASE', ph: 0, m: 'say', k: '알파 기지', p: 'planet', t: '탐사하는 모든 행성에 이곳과 같은 알파 기지를 세워 알파 매터를 수확합니다.' },
  { id: 'ALPHA_ORE', ph: 0, m: 'say', k: '추출기', p: 'extractor', t: '알파 매터의 원료인 알파 광석은 추출기로 행성에서 채굴합니다.' },
  { id: 'REFINERY', ph: 0, m: 'say', k: '정제소', p: 'refinery', t: '알파 광석은 매우 불안정합니다. 쓸모 있게 만들려면 먼저 정제소에서 안정된 알파 매터로 정제해야 합니다.' },
  { id: 'ORE_RESERVES', ph: 0, m: 'say', k: '광석 보유량', p: 'hudOre', t: '현재 광석 보유량은 여기에 표시됩니다.' },
  { id: 'ORE_THEFTS', ph: 0, m: 'say', k: '습격대', p: 'hudOre', t: '미개척 지역에서는 광석 약탈이 흔합니다. 습격대로부터 광석 보유량을 지킬 준비를 하세요.' },
  { id: 'CMD_SHIP', ph: 0, m: 'say', k: '지휘함', p: 'cmd', t: '지휘함은 모든 작전의 중심입니다. 이 함선을 지키는 것이 성공의 열쇠입니다.' },
  { id: 'CMD_SHIP_DESTROYED_WARNING', ph: 0, m: 'say', p: 'cmd', t: '지휘함이 파괴되면 새 구조체를 배치할 수 없고, 알파 기지가 취약해집니다.' },
  { id: 'RAIDERS_ATTACK', ph: 1, m: 'say', p: 'enemyTank', t: '때마침 습격대가 알파 기지를 습격했습니다.' },
  { id: 'PLANETARY_DEFENSES', ph: 1, m: 'say', k: '행성 방어', p: 'hudShield', t: '이 아이콘은 행성 방어를 나타냅니다. 습격대는 이 방어를 돌파해야 광석 보유량을 훔칠 수 있습니다.' },
  { id: 'INSPECT_DEFENSES', ph: 1, m: 'ask', k: '상세 보기', tg: ['hudShield'], t: '대부분의 HUD 요소는 길게 눌러 상세 정보를 볼 수 있습니다. 행성 방어를 길게 눌러 상태를 확인하세요.' },
  { id: 'CMD_SHIP_PROTECTS', ph: 1, m: 'say', k: '보안', p: 'cmd', t: '지휘함은 광석 보유량을 침입으로부터 보호합니다. 지휘함이 주둔 중이면 방어는 보안 상태이며 돌파되지 않습니다.' },
  { id: 'CMD_SHIP_DESTROYED', ph: 1, m: 'say', k: '돌파', p: 'hudShield', t: '지휘함이 파괴되었습니다! 습격대가 행성 방어 돌파를 시도하고 있습니다!' },
  { id: 'BREACH_COUNTDOWN', ph: 1, m: 'say', k: '돌파 카운트다운', p: 'hudShield', t: '돌파에는 시간이 걸립니다. 돌파 카운트다운은 적이 광석을 훔치기까지 남은 시간을 알려줍니다.' },
  { id: 'SUMMON_CMD_SHIP', ph: 2, m: 'ask', tg: ['emptyCmd'], t: '행성 방어를 다시 확보하려면 새 지휘함을 소환해야 합니다. 표시된 타일을 선택하세요.' },
  { id: 'DEPLOY', ph: 2, m: 'ask', pos: 't', k: '배치', tg: ['btnDeploy'], t: '배치 능력으로 새 지휘함을 소환하세요.' },
  { id: 'DEPLOY_MENU', ph: 2, m: 'ask', pos: 't', tg: ['deployCard'], t: '배치 메뉴에서 지휘함을 눌러 배치하세요.' },
  { id: 'BATTERY_DEPLETES', ph: 2, m: 'say', pos: 't', k: '배터리', p: 'hudBattery', t: '좋습니다. 능력을 사용하면 배터리가 소모됩니다. 배터리는 자동으로 충전됩니다.' },
  { id: 'CMD_SHIP_UNPROTECTED', ph: 3, m: 'say', pos: 't', k: '방어자', t: '지휘함이 무방비 상태라 습격대가 쉽게 파괴했습니다. 중요한 구조체에는 방어자를 지정하세요.' },
  { id: 'SELECT_INDICATED_TANK', ph: 3, m: 'ask', pos: 't', tg: ['tankA'], t: '먼저 표시된 탱크를 선택하세요.' },
  { id: 'DEFEND_OTHER_TANK', ph: 3, m: 'ask', pos: 't', k: '방어', tg: ['btnDefend'], t: '배터리가 충분해지면 이 구조체가 다른 탱크를 방어하도록 지정하세요. 능력을 길게 눌러 배터리 비용을 확인할 수 있습니다.' },
  { id: 'ASSIGN_DEFENSE', ph: 3, m: 'ask', pos: 't', tg: ['tankB'], t: '이제 다른 탱크를 방어하도록 지정하세요.' },
  { id: 'DEFENDED_AND_DEFENDERS', ph: 3, m: 'say', pos: 't', k: '보호 · 방어자', p: 'tankB', t: '좋습니다. ‘보호받음’ 표시가 있는 구조체는 방어를 받고, ‘방어자’ 표시가 있는 구조체는 방어를 맡습니다.' },
  { id: 'CMD_SHIP_TAKES_TIME', ph: 3, m: 'say', t: '새 지휘함이 도착하려면 시간이 걸립니다. 그동안 적과 교전해야 합니다.' },
  { id: 'DESTROY_ENEMY_CMD_SHIP', ph: 4, m: 'say', k: '적 지휘함', p: 'enemyCmd', t: '적 지휘함을 파괴하면 습격대는 후퇴합니다.' },
  { id: 'SELECT_TANK', ph: 4, m: 'ask', tg: ['tankA'], t: '탱크를 선택하세요.' },
  { id: 'RAIL_GUN', ph: 4, m: 'ask', k: '레일건', tg: ['btnWeapon', 'enemyCmd'], t: '탱크의 레일건은 지상의 구조체를 공격할 수 있습니다. 적 지휘함을 공격하세요.' },
  { id: 'WENT_POORLY', ph: 4, m: 'say', pos: 't', p: 'enemyTank', t: '작전이 실패했습니다. 적 지휘함은 탱크의 방어를 받고 있었습니다.' },
  { id: 'DEFENDER_COUNTER_ATTACK', ph: 4, m: 'say', pos: 't', k: '반격', p: 'enemyTank', t: '방어자가 반격으로 내 탱크를 공격했습니다. 공격할 때 주의하세요. 방어자는 항상 먼저 사격합니다.' },
  { id: 'DEFENDER_BLOCKED', ph: 4, m: 'say', pos: 't', k: '차단', p: 'enemyTank', t: '방어자는 공격을 차단하여 피해를 흡수하고 지휘함을 보호했습니다.' },
  { id: 'CMD_SHIP_COUNTER_ATTACK', ph: 4, m: 'say', pos: 't', k: '반격', p: 'enemyCmd', t: '이어서 지휘함이 직접 반격하여 내 탱크를 파괴했습니다.' },
  { id: 'DESTROY_DEFENDER_FIRST', ph: 4, m: 'say', pos: 't', t: '지휘함을 직접 공격하려면 먼저 적 방어자를 파괴해야 합니다.' },
  { id: 'ONE_MORE_TANK', ph: 5, m: 'ask', tg: ['tankB'], t: '다행히 탱크가 하나 더 있습니다. 지금 선택하세요.' },
  { id: 'ATTACK_ENEMY_TANK', ph: 5, m: 'ask', tg: ['btnWeapon', 'enemyTank'], t: '준비되면 적 탱크를 공격하세요.' },
  { id: 'TRIGGERED_COUNTER_ATTACK', ph: 5, m: 'say', pos: 't', k: '반격', t: '공격이 반격을 유발했습니다. 각 구조체의 능력을 고려하면 반격을 피할 수 있습니다.' },
  { id: 'BATTLEGROUNDS', ph: 5, m: 'say', pos: 't', k: '전장', t: '모든 행성에는 지상, 수상, 공중, 우주의 여러 전장이 있습니다.' },
  { id: 'RAIL_GUN_LAND_ONLY', ph: 5, m: 'say', pos: 't', p: 'enemyTank', t: '적 탱크의 레일건은 지상만 공격할 수 있습니다. 이 점을 활용하세요.' },
  { id: 'STEALTH_BOMBER', ph: 6, m: 'ask', k: '스텔스 폭격기', tg: ['bomber', 'btnWeapon', 'enemyTank'], t: '스텔스 폭격기는 안전한 공중에서 공격할 수 있습니다. 준비되면 폭격기로 탱크를 파괴하세요.' },
  { id: 'SUCCESS', ph: 6, m: 'say', t: '성공! 공격 전에 적의 능력과 방어를 살펴 진형을 뚫고 위험한 반격을 피하세요.' },
  { id: 'CLOSE_TO_VICTORY', ph: 6, m: 'say', t: '승리가 눈앞입니다. 배운 것을 활용해 적 지휘함을 파괴하세요.' },
  { id: 'FREE_PLAY', ph: 7, m: 'ask', pos: 't', k: '자유 전투', tg: ['bomber', 'btnWeapon', 'enemyCmd'], t: '자유 전투 — 스스로 판단해 적 지휘함을 파괴하세요.' },
  { id: 'RAIDERS_REPELLED', ph: 8, m: 'say', t: '습격대를 격퇴했습니다. 하지만 지휘함이 주둔하지 않아 행성 방어는 아직 취약합니다.' },
  { id: 'CMD_SHIP_ARRIVING', ph: 8, m: 'say', p: 'cmd', t: '다행히 새 지휘함이 지금 도착하고 있습니다.' },
  { id: 'DEFENSES_SECURE', ph: 8, m: 'say', k: '보안', p: 'hudShield', t: '새 지휘함이 주둔하여 행성 방어가 보안 상태가 되었습니다.' },
  { id: 'CERT', scr: 'cert' }, { id: '초광속', scr: 'ftl' },
];
const PHASES = ['기지 소개', '습격대 습격', '지휘함 재소환', '방어자 지정', '첫 번째 공격', '두 번째 공격', '스텔스 폭격기', '자유 전투', '방어 확보'];
const TRAIN = S.filter((s) => !s.scr);
const ix = (id: string) => S.findIndex((s) => s.id === id);

async function saveGrade(grade: string) {
  try { localStorage.setItem('structs-kor.tutorial', JSON.stringify({ grade, at: Date.now() })); } catch { /* fine */ }
  if (session.status.state !== 'in' || isMissing('REQ-TUT-1')) { fellBack('REQ-TUT-1'); return; }
  try { await guildApi.miniGameProgress({ interface_name: 'tutorial', game_name: 'combat_training', score: 1 }); }
  catch (e) { if (e instanceof ApiError && e.code === 'missing') markMissing('REQ-TUT-1'); fellBack('REQ-TUT-1'); }
}

const screen: Screen = {
  render(root) {
    let i = 0, sub = 0;
    const go = (n: number) => {
      i = Math.max(0, Math.min(S.length - 1, n)); sub = 0;
      if (S[i].id === 'CERT') {
        let first = false;
        try { first = !localStorage.getItem('structs-kor.tutorial'); } catch { /* storage blocked: no XP, still certify */ }
        void saveGrade('C-');
        sfx.play('victory');
        banner({ kicker: 'SN코프', title: '훈련 수료', sub: '전투 훈련 과정을 이수했습니다', tone: 'gold' });
        if (first) setTimeout(() => career.award(60, '전투 훈련 수료'), 1200);
      }
      paint();
    };
    const at = (id: string) => i >= ix(id);

    const view = (): Safe => {
      const st = S[i];
      const train = !st.scr;
      const cur = train ? (st.m === 'ask' ? st.tg![sub] : st.p ?? null) : null;
      const tgt = (id: string) => (cur === id ? ' tgt' : '');
      const cmd = !at('CMD_SHIP_DESTROYED') || at('DEFENSES_SECURE') ? 'alive' : at('BATTERY_DEPLETES') ? 'build' : 'dead';
      const raiders = at('RAIDERS_ATTACK');
      const secure = cmd === 'alive' && (!at('CMD_SHIP_DESTROYED') || at('DEFENSES_SECURE'));
      const cd = at('RAIDERS_REPELLED') ? '' : at('STEALTH_BOMBER') ? '28분' : at('DESTROY_ENEMY_CMD_SHIP') ? '29분' : at('CMD_SHIP_DESTROYED') ? '30분' : '';
      const bat = at('DESTROY_ENEMY_CMD_SHIP') ? '5 / 5' : at('DEFEND_OTHER_TANK') ? '3 / 5' : at('BATTERY_DEPLETES') ? '1 / 5 · 충전 중' : '5 / 5';
      const tNo = train ? TRAIN.indexOf(st) + 1 : TRAIN.length;

      if (st.scr === 'file') return html`<div class="tscreen"><section class="card" style="max-width:560px;width:100%;text-align:center;align-items:center;box-shadow:10px 10px 0 var(--sunken)">
        <span class="label c-cheong">SN코프 · 인사 파일</span><h1 style="font-size:40px">파일 수신 완료</h1>
        <p style="margin:0;line-height:1.75">개척 지역의 해적 활동이 증가함에 따라, SN코프는 모든 신입 사원에게 전투 훈련 이수를 권장합니다.</p>
        <button class="btn primary lg" style="width:100%" data-act="next">훈련 시작</button><a class="btn ghost" style="width:100%" href="${href('/console')}">훈련 건너뛰기</a></section></div>`;
      if (st.scr === 'loading') return html`<div class="tscreen"><span class="label faint">불러오는 중</span><p style="font-family:var(--f-display);font-size:30px;color:#fff;margin:0">시뮬레이션 로딩 중…</p>
        <div class="meter" style="width:320px;max-width:100%"><i style="width:70%"></i></div><p class="note">훈련장 · 네트워크 연결 없음 · 실제 게임에 영향 없음</p><button class="btn primary" data-act="next">계속</button></div>`;
      if (st.scr === 'cert') return html`<div class="tscreen"><section style="position:relative;max-width:640px;width:100%;background:#F2EBDD;color:#1E1C2E;border:3px double #785B02;padding:40px;display:flex;flex-direction:column;gap:18px">
        <span class="label" style="color:#785B02">SN 코퍼레이션 · 제 [번호] 호</span><h1 style="font-size:52px;letter-spacing:8px;color:#1E1C2E">수 료 증</h1>
        <p style="margin:0;font-size:17px;line-height:1.8">귀하는 전투 훈련 과정을 성공적으로 이수하였습니다.</p>
        <p style="margin:0;font-size:17px;line-height:1.8">SN코프는 귀하가 ST-21 “스피어포인트” 지휘함 운용 최소 요건을 충족함을 인증합니다. 순탄한 여정이 되길 바랍니다, 사원님.</p>
        <div style="display:flex;align-items:center;gap:16px"><span style="color:#4C6475">훈련 성적</span><b style="font-family:var(--f-display);font-weight:400;font-size:44px;color:#B3261E">C-</b></div>
        <div aria-hidden="true" style="position:absolute;right:36px;bottom:32px;width:96px;height:96px;border:4px solid #B3261E;color:#B3261E;display:flex;align-items:center;justify-content:center;text-align:center;font-family:var(--f-display);font-size:20px;line-height:1.15;transform:rotate(-8deg)">SN코프<br>인증</div>
        <div style="display:flex;gap:10px;flex-wrap:wrap"><button class="btn" style="background:#133546;color:#fff" data-act="next">초광속 도약</button><button class="btn" style="background:transparent;color:#1E1C2E;border:1px solid #4C6475" data-act="restart">다시 훈련</button></div></section></div>`;
      if (st.scr === 'ftl') return html`<div class="tscreen"><span class="label faint">상태</span><p style="font-family:var(--f-display);font-size:40px;color:#fff;margin:0">초광속 도약 진행 중</p>
        <p class="note">실제 은하로 이동합니다. 내 지휘함 위치로 화면이 이동합니다.</p><a class="btn primary lg" href="${href(session.status.state === 'in' ? '/console' : '/start')}">${session.status.state === 'in' ? '지휘 콘솔 열기' : '사령관 입대'}</a></div>`;

      const narr = html`<div class="tnarr ${st.pos === 't' ? 'top' : 'bottom'}"><div role="dialog" aria-label="훈련 안내">
        <svg class="pix" width="64" height="64" viewBox="0 0 12 12" role="img" aria-label="SN코프 인사 봇" style="flex:0 0 64px;background:var(--cheong-bg)"><rect x="2" y="2" width="8" height="7" fill="#1C5F6A"/><rect x="3" y="4" width="2" height="2" fill="#86DFC6"/><rect x="7" y="4" width="2" height="2" fill="#86DFC6"/><rect x="4" y="7" width="4" height="1" fill="#43CDB6"/><rect x="5" y="0" width="2" height="2" fill="#43CDB6"/><rect x="1" y="9" width="10" height="3" fill="#2B3550"/></svg>
        <div style="flex:1 1 auto;display:flex;flex-direction:column;gap:8px;min-width:0">
          <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center"><b style="font-size:13px;color:var(--cheong-hi)">SN코프 인사 봇</b>${st.k ? html`<span class="chip hwang" style="font-weight:700">${st.k}</span>` : ''}<span class="mono faint" style="margin-left:auto;font-size:12px">${PHASES[st.ph!]} · ${tNo}/${TRAIN.length}</span></div>
          <p style="margin:0;font-size:17px;line-height:1.7;color:#fff">${st.t}</p>
          <div style="display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap"><button class="btn ghost" data-act="prev">이전</button>
            ${st.m === 'ask' ? html`<span class="chip hwang" style="padding:10px 14px">▼ 표시된 대상을 누르세요 · ${sub + 1} / ${st.tg!.length}</span>` : html`<button class="btn primary" data-act="next" ${busy ? 'disabled' : ''}>${busy ? '교전 중…' : '확인'} <kbd>Enter</kbd></button>`}</div>
        </div></div></div>`;

      return html`<div class="ttrain">
        <div class="thud">
          <div style="margin-right:12px;line-height:1.3"><b class="c-white" style="font-size:14px">훈련생</b><br><span class="dim" style="font-size:12px">행성 · 훈련장</span></div>
          <button class="hudb${tgt('hudOre')}" data-act="hit" data-id="hudOre"><small>광석 보유량</small><b class="c-hwang">120</b></button>
          <button class="hudb${tgt('hudShield')}" data-act="hit" data-id="hudShield"><small>행성 방어</small><b style="color:${secure ? 'var(--cheong)' : 'var(--jeok)'}">${secure ? '보안' : '취약'} <span class="c-jeok">${cd}</span></b></button>
          <button class="hudb${tgt('hudBattery')}" data-act="hit" data-id="hudBattery"><small>배터리</small><b class="c-cheong">${bat}</b></button>
          ${st.id === 'CMD_SHIP_PROTECTS' ? html`<div role="status" style="flex:1 1 260px;background:var(--sunken);border:1px solid var(--cheong);padding:8px 12px;font-size:13px"><b class="c-cheong">상세 · 행성 방어</b> — 상태 보안 · 지휘함 주둔 중 · 돌파 불가</div>` : ''}
        </div>
        <div style="position:relative;flex:1 1 auto;padding:12px 16px 16px;min-height:560px">
          ${narr}
          <div class="tfield-legend"><b class="c-cheong">◀ 내 알파 기지</b><b class="c-jeok">${raiders ? '습격대 ▶' : '궤도 스캔 중…'}</b></div>
          <div id="bd-host" class="bd-host"></div>
          ${st.id === 'DEPLOY_MENU' ? html`<aside aria-label="구조체 배치" style="position:absolute;top:0;right:0;bottom:0;width:360px;max-width:100%;background:var(--bg-raised);border-left:2px solid var(--cheong);z-index:6;display:flex;flex-direction:column">
            <div style="padding:16px;border-bottom:1px solid var(--line)"><h2 style="font-size:22px">구조체 배치</h2><span class="dim" style="font-size:13px">지상 · 슬롯 1 · 사령</span></div>
            <div style="padding:16px;display:flex;flex-direction:column;gap:10px"><button class="hudb${tgt('deployCard')}" data-act="hit" data-id="deployCard" style="display:flex;gap:12px;align-items:center;padding:14px;background:var(--cheong-bg)"><span style="width:48px;height:48px;background:var(--cheong);color:var(--cheong-bg);display:flex;align-items:center;justify-content:center;font-family:var(--f-display)">지휘</span><span style="text-align:left"><b class="c-white">지휘함</b><br><small class="c-cheong">ST-21 “스피어포인트”</small></span></button>
            <p class="note">구조체를 눌러 배치하세요.<br>길게 눌러 상세 정보를 확인하세요.</p></div></aside>` : ''}
        </div>
        <div class="tactions" style="display:flex;flex-wrap:wrap;gap:8px;padding:12px 16px;background:var(--bg-raised);border-top:2px solid var(--line)">
          <button class="btn primary${tgt('btnDeploy')}" style="position:relative" data-act="hit" data-id="btnDeploy">배치</button>
          <button class="btn ghost${tgt('btnDefend')}" style="position:relative" data-act="hit" data-id="btnDefend">방어</button>
          <button class="btn danger${tgt('btnWeapon')}" style="position:relative" data-act="hit" data-id="btnWeapon">주무기 · 레일건</button>
          <span class="faint" style="margin-left:auto;align-self:center;font-size:13px">길게 누르기 = 상세 보기</span>
        </div>
      </div>`;
    };

    /* The training board inside the header and mission list. */
    const frame = (): Safe => {
      const st = S[i];
      const tNo = !st.scr ? TRAIN.indexOf(st) + 1 : st.scr === 'cert' || st.scr === 'ftl' ? TRAIN.length : 0;
      const phNow = !st.scr ? st.ph! : tNo ? 9 : -1;
      return html`<div style="display:flex;flex-direction:column;margin:-16px;min-height:calc(100vh - 120px)">
        <div style="display:flex;flex-wrap:wrap;align-items:center;gap:16px;padding:10px 16px;background:var(--bg-raised);border-bottom:1px solid var(--line)">
          <h1 style="font-size:20px">전투 훈련</h1><span class="chip hwang label" style="font-size:11px">시뮬레이션 · 저장 안 됨</span>
          <div style="flex:1 1 240px;display:flex;align-items:center;gap:12px"><div class="meter" style="flex:1 1 auto"><i style="width:${Math.round((tNo / TRAIN.length) * 100)}%"></i></div><span class="mono dim" style="font-size:13px">${tNo} / ${TRAIN.length}</span></div>
          <a class="btn ghost" style="min-height:40px" href="${href('/console')}">훈련 건너뛰기</a></div>
        <div style="display:flex;flex-wrap:wrap;flex:1 1 auto">
          <nav aria-label="훈련 미션" style="flex:1 1 220px;max-width:260px;background:var(--bg-raised);border-right:1px solid var(--line);padding:16px 0;display:flex;flex-direction:column;gap:2px">
            ${PHASES.map((name, k) => html`<button class="tph${k === phNow ? ' now' : k < phNow ? ' done' : ''}" data-act="phase" data-k="${k}"><span>${k + 1}</span>${name}</button>`)}</nav>
          <div style="flex:999 1 560px;min-width:0;display:flex;flex-direction:column">${body()}</div>
        </div></div>`;
    };
    const body = view;

    /* ── The board ── */
    let board: Board | null = null, busy = false;
    const hp: Record<Who, number> = { cmd: 6, bomber: 3, tankA: 3, tankB: 3, extractor: 6, refinery: 6, enemyCmd: 6, enemyTank: 3 };
    const reset = () => Object.assign(hp, { cmd: 6, bomber: 3, tankA: 3, tankB: 3, extractor: 6, refinery: 6, enemyCmd: 6, enemyTank: 3 });
    /** Health as the script says it should stand at the current step (after its fight has played). */
    const truth = () => {
      reset();
      if (at('CMD_SHIP_DESTROYED')) hp.cmd = 0;
      if (at('BATTERY_DEPLETES')) hp.cmd = 6;
      if (at('WENT_POORLY')) { hp.tankA = 0; hp.enemyTank = 2; }
      if (at('TRIGGERED_COUNTER_ATTACK')) { hp.enemyTank = 1; hp.tankB = 2; }
      if (at('SUCCESS')) hp.enemyTank = 0;
      if (at('RAIDERS_REPELLED')) hp.enemyCmd = 0;
    };
    const structs = (): BoardStruct[] => {
      const raiders = at('RAIDERS_ATTACK');
      const building = at('BATTERY_DEPLETES') && !at('DEFENSES_SECURE');
      return (Object.keys(UNIT) as Who[]).filter((w) => raiders || UNIT[w].side === 'defender').map((w) => ({
        id: w, typeId: UNIT[w].type, ambit: UNIT[w].ambit, slot: UNIT[w].slot, side: UNIT[w].side, category: UNIT[w].cat, isCommand: UNIT[w].type === 1,
        health: hp[w], maxHealth: UNIT[w].max, building: w === 'cmd' && building ? 0.6 : null,
        protects: (w === 'tankA' && at('DEFENDED_AND_DEFENDERS') && !at('WENT_POORLY')) ? 'tankB' : w === 'enemyTank' && !at('SUCCESS') ? 'enemyCmd' : null,
      }));
    };
    const ensureBoard = () => {
      if (board) return board;
      board = new Board({
        slots: { space: 0, air: 2, land: 2, water: 0 }, fog: true, speed: 1.1, label: '훈련장', maxHeight: () => innerHeight - 380,
        onPick: (id) => handlers.hit({ dataset: { id } } as unknown as HTMLElement),
        onTile: (key) => { if (key === 'cmd|defender|land') handlers.hit({ dataset: { id: 'emptyCmd' } } as unknown as HTMLElement); },
      });
      return board;
    };
    /** Each step that is a fight plays it; the narrator waits for the dust to settle. */
    const FIGHTS: Record<string, () => void> = {
      CMD_SHIP_DESTROYED: () => { board!.playAttack(attack('enemyTank', 3, [shot('cmd', 6, 3)])); board!.playAttack(attack('enemyTank', 3, [shot('cmd', 3, 0)])); },
      BATTERY_DEPLETES: () => board!.play('cmd', ['DEPLOYMENT_LAND']),
      WENT_POORLY: () => {
        board!.playAttack(attack('tankA', 3, [shot('enemyCmd', 6, 6, { blocked: true, blockedByStructId: 'enemyTank', blockerHealthBefore: 3, blockerHealthAfter: 2, eventAttackDefenderCounterDetail: [counter('enemyTank', 1)] })]));
        board!.playAttack(attack('enemyCmd', 6, [shot('tankA', 2, 0)]));
      },
      TRIGGERED_COUNTER_ATTACK: () => board!.playAttack(attack('tankB', 3, [shot('enemyTank', 2, 1, { eventAttackDefenderCounterDetail: [counter('enemyTank', 1)] })])),
      SUCCESS: () => board!.playAttack(attack('bomber', 3, [shot('enemyTank', 1, 0)])),
      RAIDERS_REPELLED: () => { board!.playAttack(attack('bomber', 3, [shot('enemyCmd', 6, 3)])); board!.playAttack(attack('bomber', 3, [shot('enemyCmd', 3, 0)])); },
      DEFENSES_SECURE: () => board!.play('cmd', ['DEPLOYMENT_LAND']),
    };
    let lastStep = '';
    const paint = () => {
      if (!root.isConnected) return;
      const st = S[i];
      const entered = st.id !== lastStep;
      lastStep = st.id;
      const fight = entered && !!FIGHTS[st.id] && !busy && !st.scr;
      if (fight) busy = true;
      mount(root, frame(), handlers);
      const host = root.querySelector('#bd-host');
      if (!host) { busy = false; return; }
      const b = ensureBoard();
      b.attach(host);
      if (fight) {
        // Show the state before the fight, then play it.
        const save = i; i = Math.max(0, i - 1); truth(); i = save;
        b.setStructs(structs().map((x) => ({ ...x, building: st.id === 'BATTERY_DEPLETES' || st.id === 'DEFENSES_SECURE' ? null : x.building })));
        FIGHTS[st.id]();
        void b.idle().then(() => { busy = false; truth(); b.setStructs(structs()); if (root.isConnected) { mount(root, frame(), handlers); const h = root.querySelector('#bd-host'); if (h) b.attach(h); highlight(); } });
      } else if (!busy) { truth(); b.setStructs(structs()); }
      if (st.id === 'RAIDERS_ATTACK' && entered) { b.setFog(false); sfx.play('alarm'); }
      else b.setFog(!at('RAIDERS_ATTACK'));
      highlight();
    };
    const highlight = () => {
      if (!board) return;
      const st = S[i];
      const cur = st.m === 'ask' ? st.tg![sub] : st.p ?? null;
      const ids = cur && cur in UNIT ? [cur] : cur === 'planet' ? ['extractor', 'refinery'] : [];
      board.markTargets(busy ? [] : ids);
      if (ids[0]) board.reveal(ids[0]);
      if (!busy && cur === 'emptyCmd') board.ping('cmd|defender|land');
    };
    const handlers = {
      next: () => { if (!busy) go(i + 1); }, prev: () => { if (!busy) go(i - 1); }, restart: () => { lastStep = ''; go(2); },
      phase: (el: HTMLElement) => go(S.findIndex((s) => s.ph === Number(el.dataset.k))),
      hit: (el: HTMLElement) => {
        const st = S[i];
        if (st.m !== 'ask' || st.tg![sub] !== el.dataset.id) return;
        if (busy) return;
        sfx.play('confirm');
        if (sub + 1 >= st.tg!.length) go(i + 1); else { sub++; paint(); }
      },
    };
    i = 0;
    paint();
    const off = keys.scope({ Enter: () => (S[i].m === 'ask' ? undefined : handlers.next()), ArrowRight: () => handlers.next(), ArrowLeft: () => handlers.prev() });
    return () => { off(); board?.dispose(); };
  },
};
export default screen;
