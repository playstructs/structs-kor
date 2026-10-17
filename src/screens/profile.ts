/* 내 정보: the commander's account, and where the recovery phrase lives. Enlisting doesn't show the
 * phrase; it is revealed here, behind the vault passphrase (asked again even when unlocked), and
 * hidden again after a minute or on leaving the screen. */
import type { Screen } from '../router';
import { href, go } from '../router';
import { html, mount, toast, type Safe } from '../ui/dom';
import { wallet } from '../wallet/wallet';
import { session } from '../api/session';
import { GUILD_ID } from '../config';

const SHOW_FOR_MS = 60_000;

const screen: Screen = {
  render(root) {
    let phrase: string | null = null, err = '', busy = false;
    let hideTimer: ReturnType<typeof setTimeout> | null = null;
    const hide = () => { phrase = null; if (hideTimer) clearTimeout(hideTimer); hideTimer = null; };

    const view = (): Safe => {
      const c = wallet.commander;
      if (!c) return html`<section class="card accent" style="max-width:560px;margin:40px auto"><h1 style="font-size:28px">내 정보</h1>
        <p class="note">이 브라우저에 사령관이 없습니다.</p><a class="btn primary" href="${href('/start')}">사령관 입대</a></section>`;
      const s = session.status;
      return html`<div class="row">
        <section class="card grow">
          <div class="card-head"><h1 style="font-size:28px">내 정보</h1><span class="end chip ${s.state === 'in' ? 'cheong' : 'hwang'}">${s.state === 'in' ? '● 길드 로그인됨' : '로그아웃 상태'}</span></div>
          <table class="t"><tbody>
            <tr><td class="dim" style="width:140px">플레이어</td><td class="mono c-white">${c.playerId ?? '— (입대 처리 중)'}</td></tr>
            <tr><td class="dim">길드</td><td class="mono">${GUILD_ID}</td></tr>
            <tr><td class="dim">주소</td><td class="mono" style="overflow-wrap:anywhere">${c.address}</td></tr>
            <tr><td class="dim">레플리칸트</td><td class="mono">${wallet.accounts.filter((a) => a.index > 0).length}개 저장됨 · <a href="${href('/replicants')}">분대 명단</a></td></tr>
          </tbody></table>
          <div style="display:flex;flex-wrap:wrap;gap:8px">
            ${wallet.deviceSealed ? '' : wallet.state === 'unlocked' ? html`<button class="btn ghost" data-act="lock">지갑 잠그기</button>` : html`<a class="btn ghost" href="${href('/login')}">지갑 잠금 해제</a>`}
            ${s.state === 'in' ? html`<button class="btn ghost" data-act="signout">길드 로그아웃</button>` : ''}
          </div>
        </section>

        <section class="card side ${wallet.backedUp ? '' : 'warn'}" aria-label="복구 문구">
          <h2 style="font-size:22px">복구 문구</h2>
          <p class="note">24단어 복구 문구가 곧 계정입니다. 다른 기기에서 로그인하거나 이 브라우저 데이터가 지워졌을 때 필요합니다. SN.CORP와 길드 운영진은 절대 복구 문구를 묻지 않습니다.</p>
          ${wallet.backedUp ? '' : html`<div class="notice">아직 복구 문구를 확인한 적이 없습니다. 이 브라우저를 잃으면 계정도 잃습니다.</div>`}
          ${err ? html`<div class="notice err" role="alert">${err}</div>` : ''}
          ${phrase ? html`
            <ol class="mono" style="margin:0;padding:14px;list-style:none;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px;background:var(--sunken);border:1px solid var(--line);font-size:14px">
              ${phrase.split(' ').map((w, i) => html`<li><span class="faint">${i + 1}.</span> <span class="c-white">${w}</span></li>`)}
            </ol>
            <p class="note">종이에 적어 안전한 곳에 보관하세요. 1분 뒤 자동으로 가려집니다.</p>
            <button class="btn primary" data-act="hide">가리기</button>`
          : html`<form data-act="reveal" data-on="submit" style="display:flex;flex-direction:column;gap:10px">
              ${wallet.deviceSealed ? html`<p class="note">주변에 화면을 보는 사람이 없는지 확인하세요.</p>` : html`<label class="field"><span>잠금 비밀번호를 다시 입력하세요</span><input class="input" name="pass" type="password" required autocomplete="current-password"></label>`}
              <button class="btn gold" ${busy ? 'disabled' : ''}>복구 문구 보기</button>
            </form>`}
          <hr style="border:0;border-top:1px solid var(--line);width:100%">
          <button class="btn outline-danger" data-act="forget">이 브라우저에서 지갑 지우기</button>
        </section>
      </div>`;
    };
    const paint = () => { if (root.isConnected) mount(root, view(), handlers); };
    const handlers = {
      reveal: (el: HTMLElement) => {
        const pass = String(new FormData(el as HTMLFormElement).get('pass') ?? '');
        busy = true; err = ''; paint();
        wallet.revealPhrase(pass)
          .then((p) => { phrase = p; hideTimer = setTimeout(() => { hide(); paint(); }, SHOW_FOR_MS); })
          .catch((e) => { err = (e as Error).message; })
          .finally(() => { busy = false; paint(); });
      },
      hide: () => { hide(); paint(); },
      lock: () => { wallet.lock(); hide(); toast('지갑을 잠갔습니다.'); paint(); },
      signout: () => { void session.signOut().then(paint); },
      forget: () => {
        if (!confirm(wallet.backedUp ? '이 브라우저에서 지갑을 지울까요? 복구 문구로 다시 로그인할 수 있습니다.' : '복구 문구를 확인하지 않았습니다. 지우면 계정을 잃습니다. 정말 지울까요?')) return;
        void session.signOut(); wallet.forget(); hide(); go('/');
      },
    };
    paint();
    return hide;
  },
};
export default screen;
