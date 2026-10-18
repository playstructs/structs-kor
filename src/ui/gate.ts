/* Members-only screens: the Guild API answers almost nothing without a session. Screens that can
 * run on the demo base (console, energy, market) accept it instead. */
import { session } from '../api/session';
import { href, go, current } from '../router';
import { ApiError } from '../api/http';
import { html, mount, type Safe } from './dom';
import { demo, DEMO_ID } from '../game/demo';

/** The signed-in commander's player id (or the demo's, where allowed), else null after painting a
 * sign-in card into `root`. */
export function needSession(root: HTMLElement, what: string, opts: { demo?: boolean } = {}): string | null {
  if (session.status.state === 'in' && session.playerId) return session.playerId;
  if (opts.demo && demo.on) return DEMO_ID;
  mount(root, html`
    <section class="card accent game-panel gate" style="max-width:640px;margin:40px auto">
      <span class="label c-cheong">ACCESS · 사령관 인증</span>
      <h1 style="font-size:34px">${what}</h1>
      <p style="margin:0;line-height:1.7">길드 API의 게임 데이터는 길드 회원만 볼 수 있습니다. 사령관으로 로그인하세요.${opts.demo ? ' 아니면 가상의 기지를 지휘하며 먼저 익혀 보세요.' : ''}</p>
      <div style="display:flex;gap:10px;flex-wrap:wrap">
        <a class="btn primary lg" href="${href('/login')}">로그인</a>
        ${opts.demo ? html`<button class="btn gold lg" data-act="demo">데모 함교로 체험</button>` : ''}
        <a class="btn ghost lg" href="${href('/tutorial')}">전투 훈련</a>
        <a class="btn ghost lg" href="${href('/sim')}">전투 시뮬</a>
      </div>
    </section>`, { demo: () => startDemo() });
  return null;
}

export function startDemo(path?: string) {
  demo.start();
  go(path ?? (current() === '/' ? '/console' : current()), true);
}

export function errorCard(e: unknown): Safe {
  const msg = e instanceof ApiError ? `${e.message}${e.path ? ` (${e.path})` : ''}` : (e as Error)?.message || String(e);
  return html`<div class="notice err" role="alert">불러오지 못했습니다: ${msg}</div>`;
}

export const loading = (label = '불러오는 중…') => html`<div class="card"><div class="skeleton" style="height:18px;width:40%"></div><div class="skeleton" style="height:120px"></div><span class="sr">${label}</span></div>`;
