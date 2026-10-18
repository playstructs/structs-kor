/* 시작 / 로그인.
 *
 *   /start  automatic onboarding (src/api/enlist.ts): no form, no phrase shown. A key is made and
 *           sealed to this browser, the guild registers the commander, and the tutorial opens.
 *           A browser that already holds a commander just signs back in the same way.
 *   /login  returning players: bring a recovery phrase from another device, or unlock a vault
 *           sealed with a passphrase.
 *
 * The phrase never leaves this browser; only signatures go to the guild. 내 정보 (/profile)
 * reveals it later. */
import type { Screen } from '../router';
import { go, href } from '../router';
import { html, mount, toast, type Safe } from '../ui/dom';
import { wallet } from '../wallet/wallet';
import { session, CookieBlockedError, cookieHelp } from '../api/session';
import { enlist, type EnlistStep } from '../api/enlist';

type Mode = 'start' | 'choose' | 'import' | 'unlock';

const STEPS: [EnlistStep, string, string][] = [
  ['key', '사원 인식표 발급', '이 기기에 사령관 계정을 만듭니다'],
  ['register', '길드 입대 신청', 'SN Corp 길드에 가입을 요청합니다'],
  ['chain', '사령부 등록', '은하 사령부에 입대를 등록하는 중입니다 · 보통 수십 초'],
  ['signin', '길드 접속', '길드 서버에 접속합니다'],
];

const screen: Screen = {
  render(root, params) {
    const starting = location.pathname.endsWith('/start') || params.get('new') === '1';
    let mode: Mode = starting ? 'start' : wallet.state === 'locked' && !wallet.deviceSealed ? 'unlock' : 'choose';
    let step: EnlistStep = 'key';
    let err = '', busy = false, errHelp: string[] = [];
    const signal = { stopped: false };

    const box = (title: string, body: Safe) => html`
      <div style="display:flex;justify-content:center;padding:40px 8px">
        <section class="card" style="width:100%;max-width:560px;box-shadow:10px 10px 0 var(--sunken)">
          <div class="label c-cheong" style="margin:-18px -18px 0;padding:12px 18px;background:var(--cheong-bg)">SN.CORP · 사원 인증</div>
          <h1 style="font-size:36px">${title}</h1>
          ${err ? html`<div class="notice err" role="alert">${err}${errHelp.length ? html`<ul class="cookie-help">${errHelp.map((h) => html`<li>${h}</li>`)}</ul>` : ''}</div>` : ''}
          ${body}
        </section>
      </div>`;

    const views: Record<Mode, () => Safe> = {
      start: () => {
        const at = STEPS.findIndex(([k]) => k === step);
        return box(err ? '입대가 멈췄습니다' : '입대 처리 중', html`
          <ol style="list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:10px" aria-live="polite">
            ${STEPS.map(([, t, d], i) => {
              const done = i < at || step === 'done', now = i === at && step !== 'done';
              return html`<li style="display:flex;gap:14px;align-items:flex-start;padding:12px 14px;border:1px solid ${now ? 'var(--cheong)' : 'var(--line)'};background:${done ? 'var(--cheong-bg)' : now ? 'var(--bg-raised)' : 'transparent'}" aria-current="${now ? 'step' : 'false'}">
                <span class="mono" style="flex:0 0 28px;height:28px;display:flex;align-items:center;justify-content:center;border:1px solid currentColor;color:${done ? 'var(--cheong)' : now ? 'var(--hwang)' : 'var(--text-faint)'}">${done ? '✓' : i + 1}</span>
                <span style="display:flex;flex-direction:column;gap:2px"><b class="${done || now ? 'c-white' : 'faint'}">${t}</b><span class="dim" style="font-size:13px">${d}</span>
                ${now && !err ? html`<span class="meter" style="margin-top:6px;width:200px"><i class="skeleton" style="width:100%"></i></span>` : ''}</span>
              </li>`;
            })}
          </ol>
          ${err ? html`<div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn primary" data-act="retry">다시 시도</button><a class="btn ghost" href="${href('/login')}">다른 기기의 계정으로 로그인</a></div>`
            : html`<p class="note">입대가 끝나면 전투 훈련이 시작됩니다. 계정 백업 코드는 나중에 <b class="c-white">내 정보</b>에서 확인할 수 있습니다.</p>`}`);
      },
      choose: () => box('다시 오신 것을 환영합니다', html`
        <div style="display:flex;flex-direction:column;gap:10px">
          ${wallet.commander ? html`<button class="btn primary lg" data-act="resume">이 브라우저의 사령관으로 계속</button>` : html`<a class="btn primary lg" href="${href('/start')}">신규 사령관 입대</a>`}
          <button class="btn ghost lg" data-act="toImport">다른 기기의 계정 가져오기 (백업 코드)</button>
        </div>`),
      import: () => box('백업 코드로 로그인', html`
        <form data-act="doImport" data-on="submit" style="display:flex;flex-direction:column;gap:14px">
          <label class="field"><span>백업 코드 (12 또는 24단어)</span><textarea class="input" name="phrase" autocomplete="off" spellcheck="false" required></textarea></label>
          <label class="field"><span>이 브라우저 잠금 비밀번호 (8자 이상)</span><input class="input" name="pass" type="password" minlength="8" required autocomplete="new-password"></label>
          <button class="btn primary lg" ${busy ? 'disabled' : ''}>로그인</button>
          <button type="button" class="btn ghost" data-act="toChoose">뒤로</button>
        </form>`),
      unlock: () => box('계정 잠금 해제', html`
        <form data-act="doUnlock" data-on="submit" style="display:flex;flex-direction:column;gap:14px">
          <label class="field"><span>잠금 비밀번호</span><input class="input" name="pass" type="password" required autocomplete="current-password"></label>
          <button class="btn primary lg" ${busy ? 'disabled' : ''}>잠금 해제하고 로그인</button>
          <button type="button" class="btn ghost" data-act="toImport">백업 코드로 로그인</button>
        </form>`),
    };

    const paint = () => { if (root.isConnected) mount(root, views[mode](), handlers); };
    const fail = (e: unknown) => { busy = false; err = (e as Error).message || String(e); errHelp = e instanceof CookieBlockedError ? cookieHelp() : []; paint(); };
    const signIn = async () => { await session.signIn(); toast('로그인했습니다.'); go('/console'); };
    const run = () => {
      mode = 'start'; err = ''; paint();
      const firstTime = !wallet.commander?.playerId;
      enlist((s) => { step = s; paint(); }, signal)
        .then(() => { if (signal.stopped) return; toast(firstTime ? '입대를 환영합니다, 사령관님.' : '로그인했습니다.'); go(firstTime ? '/tutorial' : '/console'); })
        .catch(fail);
    };
    const form = (el: HTMLElement) => new FormData(el as HTMLFormElement);

    const handlers = {
      retry: run,
      resume: run,
      toImport: () => { mode = 'import'; err = ''; paint(); },
      toChoose: () => { mode = 'choose'; err = ''; paint(); },
      doImport: (el: HTMLElement) => {
        const f = form(el); busy = true; err = ''; paint();
        wallet.importPhrase(String(f.get('phrase')), String(f.get('pass'))).then(signIn).catch(fail);
      },
      doUnlock: (el: HTMLElement) => {
        const f = form(el); busy = true; err = ''; paint();
        wallet.unlock(String(f.get('pass'))).then(signIn).catch(fail);
      },
    };

    if (mode === 'start') run(); else paint();
    return () => { signal.stopped = true; };
  },
};
export default screen;
