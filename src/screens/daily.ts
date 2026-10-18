/* 일일 교전: today's operation (or a past day's), your best and your streak, the results friends have
 * sent you, and the archive. A shared link (/daily/<day>/<code>) is replayed here before it is shown,
 * so its score is whatever those orders really earn. The battle itself is the simulator's
 * (/sim?daily=<day>). */
import type { Screen } from '../router';
import { current, go, href } from '../router';
import { html, mount, raw, toast, type Safe } from '../ui/dom';
import { dailyScenario, encodeReplay } from '../sim/fleets';
import { DAILY_CHARGE, DAILY_EPOCH, TWIST_KO, dailyNo, dayBefore, decodeDaily, kstDay, msToNextDaily, nameKo, playable, shareText, verifyDaily, type DailyResult } from '../sim/daily';
import { dailySim, type Entry } from '../game/dailysim';
import { parse, path as linkPath, type Link } from '../core/links';
import { RELEASES, canHandOff, inKakao, kakaoExternal, openIn, openInApp, setOpenIn } from '../core/handoff';
import { daily as guildDaily } from '../api/planned';
import { webRoot } from '../core/desktop';
import { spriteHtml } from '../game/map/art';
import { DIFFICULTY_KO } from './sim-labels';
import { notify } from '../game/fx';
import { sfx } from '../game/sfx';
import { keys } from '../game/keys';

const won = (n: number) => n.toLocaleString('ko-KR');
const starsOf = (n: number) => '★'.repeat(n) + '☆'.repeat(3 - n);
const verdict = (w: DailyResult['winner']) => (w === 'player' ? '승리' : w === 'draw' ? '무승부' : '패배');
const grid = (e: Pick<Entry, 'mine' | 'theirs'>): Safe => html`<div class="dl-grid" aria-hidden="true"><span>${e.mine.map((x) => (x ? '🟦' : '⬛')).join('')}</span><span>${e.theirs.map((x) => (x ? '🟥' : '⬛')).join('')}</span></div>`;
const hms = (ms: number) => { const s = Math.max(0, Math.floor(ms / 1000)); return [s / 3600, (s % 3600) / 60, s % 60].map((x) => String(Math.floor(x)).padStart(2, '0')).join(':'); };

const screen: Screen = {
  render(root) {
    const today = kstDay();
    const link = parse(current()) as Extract<Link, { view: 'daily' }> | null;
    const day = link?.day && playable(link.day) ? link.day : today;
    if (link?.day && link.day !== day) toast(link.day > today ? '아직 열리지 않은 작전입니다' : '그날의 작전은 없습니다', 3000);
    const d = dailyScenario(day);
    const twist = TWIST_KO[d.twist.id];
    const shareUrl = (code: string) => webRoot() + linkPath({ view: 'daily', day, code });

    // Someone's result: replayed here, so the score shown is the one their orders earn.
    let shared: (DailyResult & { name: string; code: string }) | null = null;
    if (link?.code) {
      const c = decodeDaily(link.code);
      const r = c && c.day === day ? verifyDaily(link.code) : null;
      if (r) { shared = { ...r, code: link.code }; dailySim.addFriend(day, r.name, r, link.code); }
      else toast('기록 링크를 확인하지 못했습니다', 4000);
    }
    let ladder: Awaited<ReturnType<typeof guildDaily>> | null = null;
    // A shared result can go to the desktop app, if there is one and the player wants that.
    let offer = !!shared && canHandOff() && openIn() === 'ask', sentToApp = false, remember = false;
    const kakao = inKakao();

    const replayHref = (r: DailyResult, title: string) => href('/sim/' + encodeReplay({ units: d.units, seed: d.seed, start: 1000, charge: DAILY_CHARGE, txs: r.txs, title, winner: r.winner }));
    const fleetRow = (side: 'player' | 'computer'): Safe => html`<div class="dl-fleet ${side}">${d.units.filter((u) => u.side === side).map((u) => raw(spriteHtml(u.type, 32)))}</div>`;

    const view = (): Safe => {
      const mine = dailySim.day(day);
      const best = mine.best;
      const streak = dailySim.streak(today);
      const board = [...dailySim.friends(day), ...(best ? [{ ...best, name: (dailySim.name || '나') + ' (나)', me: true }] : [])].sort((a, b) => b.score - a.score);
      const days: string[] = [];
      for (let k = 0, x = today; k < 14 && x >= DAILY_EPOCH; k++, x = dayBefore(x)) days.push(x);
      return html`
      ${kakao ? html`<div class="dl-banner"><span>카카오톡 안에서는 일부 기능(설치, 지갑)이 제한됩니다.</span><a class="btn gold" href="${kakaoExternal(location.href)}">기본 브라우저로 열기</a></div>` : ''}
      ${offer ? html`<div class="dl-banner"><span>이 기록을 데스크톱 앱에서 열까요? 여기서도 그대로 볼 수 있습니다.</span>
        <label class="dl-remember"><input type="checkbox" data-act="remember" ${remember ? 'checked' : ''}> 선택 기억</label>
        <button class="btn primary" data-act="toApp">데스크톱 앱에서 열기</button><button class="btn ghost" data-act="stayWeb">여기서 보기</button></div>` : ''}
      ${sentToApp ? html`<div class="dl-banner"><span>데스크톱 앱으로 보냈습니다. 앱이 없다면 <a href="${RELEASES}" target="_blank" rel="noopener">여기서 받으세요</a>.</span><button class="btn ghost" data-act="forget">매번 묻기</button></div>` : ''}
      <div class="g2 dl">
        <section class="card game-panel dl-today">
          <div class="card-head"><h1 style="font-size:28px">일일 교전 <span class="mono c-hwang">#${dailyNo(day)}</span></h1><span class="label c-jeok">DAILY</span>
            <span class="end mono dim">${day}${day === today ? html` · 다음 작전까지 <b class="c-cheong" id="dl-clock">${hms(msToNextDaily())}</b>` : ' · 지난 작전'}</span></div>
          <h2 class="dl-name">작전 「${nameKo(d)}」</h2>
          <div style="display:flex;gap:6px;flex-wrap:wrap"><span class="chip jeok">${twist.name}</span><span class="chip">${DIFFICULTY_KO[d.difficulty]}</span><span class="chip mono">아군 ${d.units.filter((u) => u.side === 'player').length} · 적 ${d.units.filter((u) => u.side === 'computer').length}</span><span class="chip mono">충전 ${DAILY_CHARGE}</span></div>
          <p class="note">${twist.note} 모든 사령관이 같은 함대, 같은 적, 같은 주사위로 싸웁니다. 자동 조종은 쓸 수 없습니다.</p>
          <div class="dl-vs">${fleetRow('player')}<span class="label">VS</span>${fleetRow('computer')}</div>
          <a class="btn danger lg" href="${href('/sim?daily=' + day)}">${best ? '다시 출격' : '출격'} <kbd>Enter</kbd></a>
          <div class="g3" style="gap:8px">
            <div class="stat"><small>오늘의 최고</small><strong>${best ? won(best.score) : '—'}</strong></div>
            <div class="stat"><small>출격</small><strong>${mine.plays}회</strong></div>
            <div class="stat"><small>연속 출격</small><strong>${streak ? `🔥 ${streak}일` : '—'}</strong></div>
          </div>
          ${best ? html`<div class="dl-best"><div><span class="label">내 최고 기록</span><b>${verdict(best.winner)} ${best.winner === 'player' ? starsOf(best.stars) : ''}</b><span class="mono dim">${best.blocks}블록 · ${won(best.score)}점</span></div>${grid(best)}
            <div class="dl-share"><button class="btn gold" data-act="share">결과 공유</button><button class="btn ghost" data-act="copyLink">링크 복사</button></div></div>` : ''}
          <label class="field"><span>호출부호 · 공유 링크에 담기는 이름</span><input class="input" maxlength="16" value="${dailySim.name}" placeholder="예: 청룡사령관" data-act="name" data-on="change"></label>
          <details class="dl-rules"><summary>점수 계산</summary><p class="note">승리 1,000 + 별마다 150 + 격파 1척마다 25 + 남은 내구도 최대 300 + 빨리 끝낼수록 최대 200. 패배와 무승부는 격파와 적에게 준 피해로 매깁니다(무승부 +250). 별: 승리 · 손실 ⅓ 이하 · 60블록 안에 승리.</p></details>
        </section>
        <section class="card game-panel">
          ${shared ? html`<div class="dl-shared"><span class="label c-hwang">공유된 기록 · 재검증 완료 ✓</span>
            <h2>${shared.name || '익명'}의 기록</h2><b>${verdict(shared.winner)} ${shared.winner === 'player' ? starsOf(shared.stars) : ''} · ${shared.blocks}블록 · ${won(shared.score)}점</b>${grid(shared)}
            <div class="dl-share"><a class="btn primary" href="${replayHref(shared, `${shared.name || '익명'} · 일일 교전 #${dailyNo(day)}`)}">▶ 전투 보기</a><a class="btn danger" href="${href('/sim?daily=' + day)}">이 기록에 도전</a></div></div>` : ''}
          <h2>이날의 순위</h2>
          ${board.length ? html`<ol class="dl-board">${board.map((r, i) => html`<li class="${'me' in r ? 'me' : ''}"><span class="rk mono">${i + 1}</span><b>${r.name}</b><span class="mono">${r.winner === 'player' ? starsOf(r.stars) : verdict(r.winner)}</span><span class="mono c-hwang">${won(r.score)}</span></li>`)}</ol>`
            : html`<p class="empty">아직 기록이 없습니다. 출격하고 친구에게 링크를 보내 보세요. 받은 기록은 여기에 쌓입니다.</p>`}
          ${ladder?.ladder.length ? html`<h2>길드 순위</h2><ol class="dl-board">${ladder.ladder.map((r, i) => html`<li><span class="rk mono">${i + 1}</span><b>${r.username}</b><span class="mono">${starsOf(r.stars)}</span><span class="mono dim">${r.blocks}블록</span></li>`)}</ol>` : ''}
          <h2>지난 작전</h2>
          <div class="dl-archive">${days.map((x) => { const b = dailySim.day(x).best; return html`<a class="${x === day ? 'on' : ''} ${b ? 'played' : ''}" href="${href('/daily/' + x)}"><span class="mono">#${dailyNo(x)}</span><small>${x.slice(5).replace('-', '/')}</small><b>${b ? (b.winner === 'player' ? starsOf(b.stars) : verdict(b.winner)) : '—'}</b></a>`; })}</div>
        </section>
      </div>`;
    };

    const share = async () => {
      const best = dailySim.day(day).best;
      if (!best) return;
      const r = verifyDaily(best.code);
      if (!r) return;
      const text = shareText(r, d, shareUrl(best.code));
      // Phones: the system share sheet (KakaoTalk, 문자, Discord…). Elsewhere: the clipboard.
      if (navigator.share && /Android|iPhone|iPad|Mobile/.test(navigator.userAgent)) { try { await navigator.share({ text }); return; } catch { /* dismissed */ } }
      try { await navigator.clipboard.writeText(text); sfx.play('confirm'); notify('복사됨', '채팅에 붙여넣어 공유하세요', 'cheong', null); } catch { toast('복사하지 못했습니다'); }
    };
    const handlers = {
      share: () => void share(),
      copyLink: () => { const b = dailySim.day(day).best; if (b) void navigator.clipboard?.writeText(shareUrl(b.code)).then(() => { sfx.play('confirm'); notify('복사됨', '기록 링크를 붙여넣어 공유하세요', 'cheong', null); }).catch(() => toast('복사하지 못했습니다')); },
      name: (el: HTMLElement) => { dailySim.setName((el as HTMLInputElement).value); },
      remember: (el: HTMLElement) => { remember = (el as HTMLInputElement).checked; },
      toApp: () => { if (remember) setOpenIn('app'); offer = false; void openInApp(link!).then((ok) => { sentToApp = true; if (!ok) toast('데스크톱 앱이 응답하지 않았습니다', 3000); paint(); }); },
      stayWeb: () => { if (remember) setOpenIn('web'); offer = false; paint(); },
      forget: () => { setOpenIn('ask'); sentToApp = false; paint(); },
    };
    const paint = () => { if (root.isConnected) mount(root, view(), handlers); };
    paint();
    // Remembered "always the app": hand it over once, and keep the page here in case it isn't installed.
    if (shared && canHandOff() && openIn() === 'app') void openInApp(link!).then(() => { sentToApp = true; paint(); });
    void guildDaily().then((g) => { if (g.date === day) { ladder = g; paint(); } }).catch(() => null);
    const clock = setInterval(() => {
      const el = root.querySelector('#dl-clock');
      if (el) el.textContent = hms(msToNextDaily());
      // Midnight KST: today's page becomes the new day's.
      if (day === today && kstDay() !== today) go('/daily', true);
    }, 1000);
    const offKeys = keys.scope({ Enter: () => go('/sim?daily=' + day) });
    return () => { clearInterval(clock); offKeys(); };
  },
};
export default screen;
