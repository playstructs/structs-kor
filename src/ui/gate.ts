/* Members-only screens: the Guild API answers almost nothing without a session, so a signed-out
 * visitor gets 바로 플레이 (enlist) and 로그인 instead. */
import { session } from '../api/session';
import { href } from '../router';
import { ApiError } from '../api/http';
import { html, mount, type Safe } from './dom';

/** The signed-in commander's player id, else null after painting a sign-in card into `root`.
 * (`_opts.demo` is what screens passed while the demo base existed; it no longer does anything.) */
export function needSession(root: HTMLElement, what: string, _opts: { demo?: boolean } = {}): string | null {
  if (session.status.state === 'in' && session.playerId) return session.playerId;
  mount(root, html`
    <section class="card accent game-panel gate" style="max-width:640px;margin:40px auto">
      <span class="label c-cheong">ACCESS · 사령관 인증</span>
      <h1 style="font-size:34px">${what}</h1>
      <p style="margin:0;line-height:1.7">길드 API의 게임 데이터는 길드 회원만 볼 수 있습니다. 바로 플레이로 사령관을 만들거나, 이미 있다면 로그인하세요.</p>
      <div style="display:flex;gap:10px;flex-wrap:wrap">
        <a class="btn primary lg" href="${href('/start')}">바로 플레이</a>
        <a class="btn ghost lg" href="${href('/login')}">로그인</a>
        <a class="btn ghost lg" href="${href('/tutorial')}">전투 훈련</a>
        <a class="btn ghost lg" href="${href('/sim')}">전투 시뮬</a>
      </div>
    </section>`);
  return null;
}


export function errorCard(e: unknown): Safe {
  const msg = e instanceof ApiError ? `${e.message}${e.path ? ` (${e.path})` : ''}` : (e as Error)?.message || String(e);
  return html`<div class="notice err" role="alert">불러오지 못했습니다: ${msg}</div>`;
}

export const loading = (label = '불러오는 중…') => html`<div class="card"><div class="skeleton" style="height:18px;width:40%"></div><div class="skeleton" style="height:120px"></div><span class="sr">${label}</span></div>`;
