/* The director: base events that matter wherever the player is (raid alarms, victories, losses,
 * brownouts) become alarms, banners and XP on every screen. Screen-specific effects (the board
 * playing the attack) stay with the screen. */
import { demo, HEGEMONY } from './demo';
import { transmit, guildSay, record } from './comms';

const mates = () => demo.guild?.members ?? [];

let raider: string | null = null;
import { sfx } from './sfx';
import { banner, flash, notify, shake } from './fx';
import { career } from './progress';
import { current } from '../router';
import { music } from './music';
import { session } from '../api/session';

demo.onEvent((kind, text) => {
  if (session.status.state === 'in') return; // signed in: the demo base is silent
  const away = current() !== '/console';
  if (kind === 'alarm') {
    // Rivals speak: a rebel declares itself, a new raid comes with a taunt.
    if (text.includes('반란') && demo.state.rebel) setTimeout(() => transmit(demo.state.rebel!, 'rebel'), 900);
    else if (demo.raid && demo.raid.eta > 0 && demo.raid.owner !== raider) { raider = demo.raid.owner; const who = raider; setTimeout(() => transmit(who, 'raid'), 900); }
    if (demo.raid?.eta === 0) music.setMode('battle');
    sfx.play('alarm'); flash();
    notify('경보', text + (away ? ' · C로 함교 복귀' : ''), 'jeok', null);
    if (demo.raid?.eta === 0 && !away) { shake('lg'); banner({ kicker: '습격', title: '적 함대 도착', sub: text, tone: 'jeok', ms: 2000 }); }
  } else if (kind === 'victory') {
    guildSay(mates(), 'victory', 3800);
    if (raider) { const who = raider; setTimeout(() => transmit(who, 'repelled'), away ? 600 : 3400); }
    raider = null;
    music.setMode('calm');
    const at = () => { sfx.play('victory'); if (away) notify('방어 성공', text, 'hwang', null); else banner({ kicker: '방어 성공', title: '습격 격퇴', sub: text, tone: 'gold' }); career.award(120, '습격 격퇴'); };
    // Let the board finish the last explosion before the fanfare.
    setTimeout(at, away ? 0 : 2400);
  } else if (kind === 'defeat') {
    guildSay(mates(), 'defeat', 3800);
    if (raider) { const who = raider; setTimeout(() => transmit(who, 'won'), away ? 600 : 3400); }
    raider = null;
    music.setMode('calm');
    setTimeout(() => { sfx.play('defeat'); if (away) notify('방어 실패', text, 'jeok', null); else { shake('lg'); banner({ kicker: '방어 실패', title: '약탈당함', sub: text, tone: 'jeok' }); } }, away ? 0 : 2400);
  } else if (kind === 'engine') {
    music.setMode('battle');
    sfx.play('victory'); shake('lg');
    banner({ kicker: '월드 엔진 가동', title: '은하의 패권', sub: text, tone: 'gold', ms: 5000 });
    if (demo.era === 0) career.award(1000, '월드 엔진 완공');
    setTimeout(() => music.setMode('calm'), 8000);
  } else if (kind === 'hegemony') {
    const [ti, fresh] = text.split('|');
    const t = HEGEMONY[Number(ti)];
    sfx.play('levelup'); shake('sm');
    banner({ kicker: `패권 지수 ${Math.round(t.at * 100)}% 돌파`, title: t.title, sub: '은하가 당신의 이름을 압니다', tone: 'gold', ms: 3200 });
    if (fresh === '1') career.award(t.xp, `패권 · ${t.title}`);
  } else if (kind === 'era') {
    raider = null; music.setMode('calm');
  } else if (kind === 'bounty') {
    sfx.play('coin');
    banner({ kicker: '현상금', title: '의뢰 완수', sub: text, tone: 'gold', ms: 2600 });
    career.award(80, '현상금 의뢰 완수');
  } else if (kind === 'streak') {
    const [n, g] = text.split('|');
    // Wait for the screen to settle (this fires as the base starts up).
    setTimeout(() => { sfx.play('coin'); banner({ kicker: '복귀 보상', title: `연속 ${n}일`, sub: `기지 금고 +${g} α · 내일도 오세요`, tone: 'gold', ms: 2600 }); }, 1500);
  } else if (kind === 'guildhelp') {
    notify('길드 지원', text, 'cheong', 'shield');
    record({ from: 'guild', who: mates()[0] ?? '길드원', text: `방어막 보냈습니다! ${text.split(' ').pop()} · 버티세요`, kind: 'guild' });
  } else if (kind === 'race') {
    guildSay(mates(), 'race', 1500);
    sfx.play('victory');
    banner({ kicker: '길드 전', title: '시즌 우승', sub: text, tone: 'gold', ms: 3000 });
    career.award(150, '길드 전 우승');
  } else if (kind === 'void') {
    guildSay(mates(), 'void', 1800);
    sfx.play('alarm'); flash(); shake('lg');
    banner({ kicker: '은하 경보', title: '공허 함대 출현', sub: text, tone: 'jeok', ms: 3200 });
    notify('공허 함대', `${text} · 은하 지도에서 요격`, 'jeok', null);
  } else if (kind === 'news') {
    const b = demo.bounty;
    if (b && text.includes('현상금')) setTimeout(() => transmit(b.patron, 'bounty'), 700);
    notify('은하 전황', text, 'hwang', null);
  } else if (kind === 'decision') {
    sfx.play('coin');
    notify('결단', `${text}${away ? ' · C로 함교에서 결정' : ''}`, 'hwang', null);
  } else if (kind === 'event') {
    const e = demo.event;
    notify('은하 소식', text, e?.tone ?? 'hwang', e?.tone === 'jeok' ? 'alarm' : 'coin');
    if (!away) banner({ kicker: '은하 소식', title: e?.name ?? '', sub: e?.text, tone: e?.tone === 'cheong' ? 'cheong' : e?.tone === 'jeok' ? 'jeok' : 'gold', ms: 2200 });
  } else notify(kind === 'jeok' ? '경고' : '보고', text, kind === 'jeok' ? 'jeok' : 'cheong', kind === 'jeok' ? 'error' : 'tick');
});

/* Coming back to the base: what it made, what it lost, while you were gone. */
demo.onAway((r) => {
  if (session.status.state === 'in') return;
  const mins = Math.round((r.blocks * demo.BLOCK_MS) / 60000);
  const el = document.createElement('div');
  el.className = 'away';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', '귀환 보고');
  const row = (k: string, v: string, tone = '') => `<div><span>${k}</span><b class="mono ${tone}">${v}</b></div>`;
  el.innerHTML = `<div class="away-in"><span class="label c-cheong">귀환 보고 · ${mins}분 · ${r.blocks}블록</span><h2>자리를 비운 동안</h2>
    ${row('정제된 알파', `${r.alpha >= 0 ? '+' : ''}${r.alpha.toFixed(2)} g`, 'c-hwang')}
    ${row('광석 변화', `${r.ore >= 0 ? '+' : ''}${Math.round(r.ore)}`)}
    ${r.earned ? row('전력 판매 수익', `+${r.earned.toFixed(2)} α`, 'c-cheong') : ''}
    ${r.raids ? row('습격', `${r.raids}회 · 격퇴 ${r.repelled}`, r.repelled === r.raids ? 'c-cheong' : 'c-jeok') : row('습격', '없음', 'c-cheong')}
    ${r.rebels?.length ? row('반란', r.rebels.join(', '), 'c-jeok') : ''}
    ${r.loan ? row('대출', r.loan, r.loan.includes('불이행') ? 'c-jeok' : 'c-hwang') : ''}
    ${r.stolen ? row('약탈당한 광석', `−${Math.round(r.stolen)}`, 'c-jeok') : ''}
    <p class="note">${r.stolen ? '정제하지 않은 광석은 약탈됩니다. 떠나기 전에 정제소를 돌리고, 함대를 갖춰 두세요.' : '기지가 잘 버텼습니다.'}</p>
    <button class="btn primary lg" type="button">지휘 재개</button></div>`;
  const close = () => { if (!el.isConnected) return; el.remove(); if (r.repelled) career.award(r.repelled * 40, `부재 중 습격 ${r.repelled}회 격퇴`); };
  el.querySelector('button')!.addEventListener('click', () => { sfx.play('confirm'); close(); });
  el.addEventListener('click', (e) => { if (e.target === el) close(); });
  document.body.appendChild(el);
  setTimeout(() => sfx.play(r.stolen ? 'alarm' : 'coin'), 300);
});
