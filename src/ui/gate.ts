/* Members-only screens: the Guild API answers almost nothing without a session. */
import { session } from '../api/session';
import { href } from '../router';
import { ApiError } from '../api/http';
import { html, mount, type Safe } from './dom';

/** The signed-in commander's player id, or null after painting a sign-in card into `root`. */
export function needSession(root: HTMLElement, what: string): string | null {
  if (session.status.state === 'in' && session.playerId) return session.playerId;
  mount(root, html`
    <section class="card accent" style="max-width:560px;margin:40px auto">
      <h1 style="font-size:30px">${what}</h1>
      <p style="margin:0;line-height:1.7">길드 API의 게임 데이터는 길드 회원만 볼 수 있습니다. 사령관으로 로그인하세요.</p>
      <div style="display:flex;gap:10px;flex-wrap:wrap"><a class="btn primary" href="${href('/login')}">로그인</a><a class="btn ghost" href="${href('/tutorial')}">로그인 없이 전투 훈련</a></div>
    </section>`);
  return null;
}

export function errorCard(e: unknown): Safe {
  const msg = e instanceof ApiError ? `${e.message}${e.path ? ` (${e.path})` : ''}` : (e as Error)?.message || String(e);
  return html`<div class="notice err" role="alert">불러오지 못했습니다: ${msg}</div>`;
}

export const loading = (label = '불러오는 중…') => html`<div class="card"><div class="skeleton" style="height:18px;width:40%"></div><div class="skeleton" style="height:120px"></div><span class="sr">${label}</span></div>`;
