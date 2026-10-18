/* The desktop app (src-tauri) runs this same client. Here the page picks up what only the app can
 * give it: structs-kor:// links (opened at the screen they name), new signed releases (offered, never
 * forced), and web links (sent to the player's browser instead of replacing the game). In a browser
 * tab none of this runs. */
import { go, href } from '../router';
import { SITE_URL } from '../config';
import { parse, path } from './links';
import { inDesktop } from './handoff';

interface TauriGlobal {
  core: { invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> };
  event: { listen(name: string, fn: () => void): Promise<() => void> };
}
const tauri = () => (window as unknown as { __TAURI__?: TauriGlobal }).__TAURI__;

/**
 * The website's root, for links meant for other people (a daily result, a replay). In the app,
 * location.origin is tauri://localhost, which nobody else can open.
 */
export const webRoot = (): string => (inDesktop() ? (import.meta.env.VITE_WEB_ROOT || SITE_URL).replace(/\/+$/, '') : location.origin + href(''));

async function takeLinks() {
  const urls = await tauri()!.core.invoke<string[]>('take_links');
  // Several at once (a burst of clicks): the last one wins.
  const link = urls.map((u) => parse(u)).filter(Boolean).pop();
  if (link) go(path(link));
}

interface Update { version: string; notes: string | null; installable: boolean }
const RELEASES = 'https://github.com/playstructs/structs-kor/releases/latest';

async function checkUpdate() {
  const u = await tauri()!.core.invoke<Update | null>('update_check').catch(() => null);
  if (!u || document.getElementById('app-update')) return;
  const bar = document.createElement('div');
  bar.id = 'app-update';
  bar.className = 'app-update';
  bar.setAttribute('role', 'status');
  bar.innerHTML = `<span>새 버전 <b class="mono"></b> 이(가) 나왔습니다.</span><button class="btn primary" type="button" data-go>${u.installable ? '업데이트 후 재시작' : '다운로드'}</button><button class="btn ghost" type="button" data-later>나중에</button>`;
  bar.querySelector('b')!.textContent = u.version;
  bar.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    if (t.closest('[data-later]')) { bar.remove(); return; }
    if (!t.closest('[data-go]')) return;
    if (!u.installable) { void tauri()!.core.invoke('open_external', { url: RELEASES }); bar.remove(); return; }
    (t as HTMLButtonElement).disabled = true;
    t.textContent = '받는 중…';
    void tauri()!.core.invoke('update_install').catch(() => { t.textContent = '실패 · 다시 시도'; (t as HTMLButtonElement).disabled = false; });
  });
  document.body.appendChild(bar);
}

export function startDesktop() {
  if (!inDesktop() || !tauri()) return;
  document.documentElement.dataset.desktop = '';
  void takeLinks();
  void tauri()!.event.listen('deep-link', () => void takeLinks());
  // A link to anywhere else on the web opens in the browser.
  document.addEventListener('click', (e) => {
    const a = (e.target as HTMLElement).closest?.('a');
    if (!a || !a.href) return;
    const url = new URL(a.href, location.href);
    if (url.origin === location.origin || !/^(https?|mailto):$/.test(url.protocol)) return;
    e.preventDefault();
    void tauri()!.core.invoke('open_external', { url: url.href });
  }, true);
  setTimeout(() => void checkUpdate(), 5000);
  setInterval(() => void checkUpdate(), 6 * 3600e3);
}
