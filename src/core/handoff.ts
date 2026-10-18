/* Opening a link in the desktop app, when the player wants that. The web client is the whole game,
 * so the app is never required. A shared link plays right here, and "데스크톱 앱에서 열기" is an
 * offer. The choice is remembered (always the app / always here / ask), unlike structs-app, which
 * asks every time.
 *
 * The app is offered only once there is one to download (VITE_DESKTOP_RELEASES), and never inside
 * the app itself. KakaoTalk's in-app browser can't open custom schemes at all, so there the offer is
 * to reopen the page in the phone's own browser. */
import { appUrl, type Link } from './links';

export type OpenIn = 'ask' | 'app' | 'web';
const KEY = 'structs-kor.openIn';
export const RELEASES: string = import.meta.env.VITE_DESKTOP_RELEASES || '';

export const inDesktop = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
export const inKakao = () => typeof navigator !== 'undefined' && /KAKAOTALK/i.test(navigator.userAgent);
/** Desktop OSes the app is built for (phones and tablets play on the web). */
export const desktopOs = () => typeof navigator !== 'undefined' && /Windows NT|Macintosh|Linux x86_64/.test(navigator.userAgent) && !/Android|iPhone|iPad|Mobile/.test(navigator.userAgent) && navigator.maxTouchPoints < 2;
/** Whether to offer the desktop app at all here. */
export const canHandOff = () => !!RELEASES && !inDesktop() && !inKakao() && desktopOs();

export function openIn(): OpenIn {
  try { const v = localStorage.getItem(KEY); return v === 'app' || v === 'web' ? v : 'ask'; } catch { return 'ask'; }
}
export function setOpenIn(v: OpenIn) {
  try { if (v === 'ask') localStorage.removeItem(KEY); else localStorage.setItem(KEY, v); } catch { /* private mode: ask again next time */ }
}

/**
 * Try the desktop app. Resolves true if the page lost focus (the app took the link), false if
 * nothing answered within 1.6 s, which almost always means the app isn't installed.
 */
export function openInApp(link: Link): Promise<boolean> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v: boolean) => { if (done) return; done = true; removeEventListener('blur', left); document.removeEventListener('visibilitychange', left); clearTimeout(t); resolve(v); };
    const left = () => finish(true);
    addEventListener('blur', left);
    document.addEventListener('visibilitychange', left);
    const t = setTimeout(() => finish(document.hidden), 1600);
    location.href = appUrl(link);
  });
}

/** KakaoTalk's in-app browser: reopen this page in the phone's default browser. */
export const kakaoExternal = (url: string) => 'kakaotalk://web/openExternal?url=' + encodeURIComponent(url);
