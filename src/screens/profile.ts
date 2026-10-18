/* 내 정보: the commander's account, and where the recovery phrase lives. Enlisting doesn't show the
 * phrase; it is revealed here, behind the vault passphrase (asked again even when unlocked), and
 * hidden again after a minute or on leaving the screen. */
import { playerMessage } from '../api/errors';
import type { Screen } from '../router';
import { href, go } from '../router';
import { html, mount, toast, raw, type Safe } from '../ui/dom';
import { wallet } from '../wallet/wallet';
import { session } from '../api/session';
import { GUILD_ID } from '../config';
import { simulate, actions } from '../api/actions';
import { portraitHtml, myPfp } from '../game/portrait';
import { guildApi } from '../api/guild';
import { MOCK } from '../api/http';
import { CHANNELS, prefs, setPrefs, enable, supported, permission, type Channel } from '../game/native';

const SHOW_FOR_MS = 60_000;

const screen: Screen = {
  render(root) {
    let phrase: string | null = null, err = '', busy = false;
    // 체인 점검: the dry run's steps as they come back, and the verdict.
    let check: { steps: [string, string][]; verdict: string | null; ok: boolean | null; running: boolean } = { steps: [], verdict: null, ok: null, running: false };
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
            <tr><td class="dim" style="width:140px">사령관 ID</td><td class="mono c-white">${c.playerId ?? '— (입대 처리 중)'}</td></tr>
            <tr><td class="dim">길드</td><td class="mono">${GUILD_ID}</td></tr>
            <tr><td class="dim">계정 코드</td><td class="mono dim" style="overflow-wrap:anywhere;font-size:12px">${c.address}</td></tr>
            <tr><td class="dim">레플리칸트</td><td class="mono">${wallet.accounts.filter((a) => a.index > 0).length}개 저장됨 · <a href="${href('/replicants')}">분대 명단</a></td></tr>
          </tbody></table>
          <section class="chain-check">
            <div class="card-head"><h2 style="font-size:20px">연결 점검</h2><span class="end note">아무것도 바뀌지 않음</span></div>
            <p class="note">구조체 하나의 전원 명령을 실제로 보내지 않고 시험해, 명령이 은하 사령부까지 제대로 전달되는지 확인합니다. 아무것도 바뀌지 않습니다.</p>
            ${check.steps.length ? html`<details><summary class="note">기술 정보</summary><ol class="newswire">${check.steps.map(([k, v]) => html`<li><b>${k}</b> · <span class="mono">${v}</span></li>`)}</ol></details>` : ''}
            ${check.verdict ? html`<div class="notice ${check.ok ? '' : 'err'}" role="status">${check.verdict}</div>` : ''}
            <button class="btn gold" data-act="check" ${check.running || wallet.state !== 'unlocked' || !c.playerId || MOCK ? 'disabled' : ''}>${check.running ? '점검 중…' : '연결 점검'}</button>
            ${wallet.state !== 'unlocked' ? html`<small class="dim">계정 잠금을 해제해야 명령할 수 있습니다.</small>` : MOCK ? html`<small class="dim">모의 모드에서는 꺼져 있습니다.</small>` : ''}
          </section>
          <section class="chain-check">
            <div class="card-head"><h2 style="font-size:20px">사령관 신원</h2><span class="end note">모두에게 보임</span></div>
            <div class="ident-row">${raw(portraitHtml(myPfp(), 64))}<div class="ident-forms">
              <form class="invite-form" data-act="rename" data-on="submit"><input class="input" name="name" maxlength="24" placeholder="새 호출부호" required><button class="btn ghost sm" ${wallet.state === 'unlocked' && c.playerId && !MOCK ? '' : 'disabled'}>이름 변경</button></form>
              <div style="display:flex;gap:6px;flex-wrap:wrap"><button class="btn ghost sm" data-act="pfp" ${wallet.state === 'unlocked' && c.playerId && !MOCK ? '' : 'disabled'}>이 초상화로 저장</button><a class="btn ghost sm" href="${href('/record')}">초상화 꾸미기</a></div>
            </div></div>
            <p class="note">이름과 초상화는 플레이어 카드, 통신, 길드 명단 어디서나 이것으로 보입니다.</p>
          </section>
          <section class="chain-check">
            <div class="card-head"><h2 style="font-size:20px">소리</h2><span class="end note">음량 · 효과음마다 켜고 끄기 · 내 소리 파일</span></div>
            <button class="btn ghost" data-act="sound">소리 설정</button>
          </section>
          <section class="chain-check">
            <div class="card-head"><h2 style="font-size:20px">시스템 알림</h2><span class="end note">${!supported() ? '이 환경은 지원하지 않음' : permission() === 'denied' ? '브라우저에서 차단됨' : prefs().on ? '켜짐' : '꺼짐'}</span></div>
            <p class="note">탭이 뒤에 있을 때 운영체제 알림으로 알려줍니다. 채널마다 끌 수 있습니다.</p>
            ${prefs().on ? html`<div class="notify-list">${CHANNELS.map((c) => html`<div class="order-row"><div><b class="c-white">${c.label}</b><br><span class="dim" style="font-size:12px">${c.hint}</span></div><button class="sw" aria-pressed="${prefs().channels[c.id]}" aria-label="${c.label} 알림" data-act="chan" data-id="${c.id}"></button></div>`)}
              <div class="order-row"><div><b class="c-white">게임 화면을 보고 있을 때도</b><br><span class="dim" style="font-size:12px">끄면 탭이 뒤에 있을 때만</span></div><button class="sw" aria-pressed="${prefs().always}" aria-label="항상 알림" data-act="always"></button></div></div>
              <button class="btn ghost" data-act="notifyOff">알림 끄기</button>`
            : html`<button class="btn gold" data-act="notifyOn" ${supported() && permission() !== 'denied' ? '' : 'disabled'}>알림 켜기</button>`}
          </section>
          <div style="display:flex;flex-wrap:wrap;gap:8px">
            ${wallet.deviceSealed ? '' : wallet.state === 'unlocked' ? html`<button class="btn ghost" data-act="lock">계정 잠그기</button>` : html`<a class="btn ghost" href="${href('/login')}">계정 잠금 해제</a>`}
            ${s.state === 'in' ? html`<button class="btn ghost" data-act="signout">길드 로그아웃</button>` : ''}
          </div>
        </section>

        <section class="card side ${wallet.backedUp ? '' : 'warn'}" aria-label="백업 코드">
          <h2 style="font-size:22px">백업 코드</h2>
          <p class="note">24단어 백업 코드가 곧 계정입니다. 다른 기기에서 로그인하거나 이 브라우저 데이터가 지워졌을 때 필요합니다. SN.CORP와 길드 운영진은 절대 백업 코드를 묻지 않습니다.</p>
          ${wallet.backedUp ? '' : html`<div class="notice">아직 백업 코드를 확인한 적이 없습니다. 이 브라우저를 잃으면 계정도 잃습니다.</div>`}
          ${err ? html`<div class="notice err" role="alert">${err}</div>` : ''}
          ${phrase ? html`
            <ol class="mono" style="margin:0;padding:14px;list-style:none;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px;background:var(--sunken);border:1px solid var(--line);font-size:14px">
              ${phrase.split(' ').map((w, i) => html`<li><span class="faint">${i + 1}.</span> <span class="c-white">${w}</span></li>`)}
            </ol>
            <p class="note">종이에 적어 안전한 곳에 보관하세요. 1분 뒤 자동으로 가려집니다.</p>
            <button class="btn primary" data-act="hide">가리기</button>`
          : html`<form data-act="reveal" data-on="submit" style="display:flex;flex-direction:column;gap:10px">
              ${wallet.deviceSealed ? html`<p class="note">주변에 화면을 보는 사람이 없는지 확인하세요.</p>` : html`<label class="field"><span>잠금 비밀번호를 다시 입력하세요</span><input class="input" name="pass" type="password" required autocomplete="current-password"></label>`}
              <button class="btn gold" ${busy ? 'disabled' : ''}>백업 코드 보기</button>
            </form>`}
          <hr style="border:0;border-top:1px solid var(--line);width:100%">
          <button class="btn outline-danger" data-act="forget">이 브라우저에서 계정 지우기</button>
        </section>
      </div>`;
    };
    const paint = () => { if (root.isConnected) mount(root, view(), handlers); };
    const handlers = {
      rename: (el: HTMLElement) => {
        const name = String(new FormData(el as HTMLFormElement).get('name') || '').trim();
        const pid = wallet.commander?.playerId;
        if (!name || !pid) return;
        void actions.playerName(pid, name).then(() => toast('이름을 바꿨습니다')).catch((e) => toast('실패: ' + (e as Error).message, 5000));
      },
      pfp: () => {
        const pid = wallet.commander?.playerId;
        if (!pid) return;
        void actions.playerPfp(pid, myPfp()).then(() => toast('초상화를 저장했습니다')).catch((e) => toast('실패: ' + (e as Error).message, 5000));
      },
      sound: () => void import('../ui/sound').then((m) => m.openSoundSettings()),
      notifyOn: () => { void enable().then((ok) => { toast(ok ? '알림을 켰습니다.' : '브라우저가 알림을 허용하지 않았습니다.'); paint(); }); },
      notifyOff: () => { setPrefs({ on: false }); paint(); },
      chan: (el: HTMLElement) => { const id = el.dataset.id as Channel; const p = prefs(); setPrefs({ channels: { ...p.channels, [id]: !p.channels[id] } }); paint(); },
      always: () => { setPrefs({ always: !prefs().always }); paint(); },
      check: () => {
        const pid = wallet.commander?.playerId;
        if (!pid || check.running) return;
        check = { steps: [], verdict: null, ok: null, running: true }; paint();
        const step = (k: string, v: string) => { check.steps.push([k, v]); paint(); };
        void (async () => {
          try {
            // A built struct that's running is best (switching it off always passes the message's checks).
            const mine = (await guildApi.structsOf(pid)).filter((x) => !(x.status & 32) && !x.is_destroyed && (x.status & 1));
            step('구조체', `완성된 구조체 ${mine.length}기`);
            const s = mine.find((x) => x.status & 4) ?? mine[0];
            if (!s) throw new Error('점검에 쓸 완성된 구조체가 없습니다 (하나 건설한 뒤 다시 시도)');
            // Power off a running struct (or on an idle one): a harmless order the chain fully checks.
            const name = s.status & 4 ? 'MsgStructDeactivate' : 'MsgStructActivate';
            const r = await simulate(name, { structId: s.id }, step);
            check.ok = true; check.verdict = '통과 · 명령이 은하 사령부까지 정상적으로 전달됩니다.'; void r;
          } catch (e) {
            const m = (e as Error).message;
            // An error from running the message means the transaction itself got through decoding and the account checks.
            check.ok = false; check.verdict = /message index/.test(m) ? `연결은 정상 · 이 명령은 지금 받아들여지지 않습니다 (${playerMessage(m)})` : `실패 · ${playerMessage(m)}`;
          } finally { check.running = false; paint(); }
        })();
      },
      reveal: (el: HTMLElement) => {
        const pass = String(new FormData(el as HTMLFormElement).get('pass') ?? '');
        busy = true; err = ''; paint();
        wallet.revealPhrase(pass)
          .then((p) => { phrase = p; hideTimer = setTimeout(() => { hide(); paint(); }, SHOW_FOR_MS); })
          .catch((e) => { err = (e as Error).message; })
          .finally(() => { busy = false; paint(); });
      },
      hide: () => { hide(); paint(); },
      lock: () => { wallet.lock(); hide(); toast('계정을 잠갔습니다.'); paint(); },
      signout: () => { void session.signOut().then(paint); },
      forget: () => {
        if (!confirm(wallet.backedUp ? '이 브라우저에서 계정을 지울까요? 백업 코드로 다시 로그인할 수 있습니다.' : '백업 코드를 확인하지 않았습니다. 지우면 계정을 잃습니다. 정말 지울까요?')) return;
        void session.signOut(); wallet.forget(); hide(); go('/');
      },
    };
    paint();
    return hide;
  },
};
export default screen;
