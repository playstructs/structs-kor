/* System notifications (the OS's own, via the browser's Notification API) for what matters while the
 * tab is in the background: raids on your planet, direct messages, mentions, standing-order actions.
 * Each channel can be switched off; nothing is asked of the browser until the player turns them on.
 * After structs-universe's notification channels. */
export type Channel = 'raid' | 'dm' | 'mention' | 'orders';
export const CHANNELS: { id: Channel; label: string; hint: string }[] = [
  { id: 'raid', label: '습격', hint: '내 행성 습격 시작 · 격퇴 · 약탈' },
  { id: 'dm', label: '다이렉트 메시지', hint: '누군가 나에게 보낸 메시지' },
  { id: 'mention', label: '언급', hint: '대화방에서 내 이름이나 ID가 나올 때' },
  { id: 'orders', label: '복무 규칙', hint: '자동 회수 · 자동 복제가 실행될 때' },
];
const KEY = 'structs-kor.notify';
interface Prefs { on: boolean; channels: Record<Channel, boolean>; always: boolean }
const DEFAULT: Prefs = { on: false, always: false, channels: { raid: true, dm: true, mention: true, orders: false } };

export function prefs(): Prefs { try { const p = JSON.parse(localStorage.getItem(KEY) || '{}'); return { ...DEFAULT, ...p, channels: { ...DEFAULT.channels, ...(p.channels ?? {}) } }; } catch { return { ...DEFAULT, channels: { ...DEFAULT.channels } }; } }
export function setPrefs(p: Partial<Prefs>) { try { localStorage.setItem(KEY, JSON.stringify({ ...prefs(), ...p })); } catch { /* fine */ } }
export const supported = () => typeof Notification !== 'undefined';
export const permission = () => (supported() ? Notification.permission : 'denied');

/** Ask the browser (only from a click). */
export async function enable(): Promise<boolean> {
  if (!supported()) return false;
  const r = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
  setPrefs({ on: r === 'granted' });
  return r === 'granted';
}

/** Notify on a channel, if the player wants it and the tab isn't in front (unless 'always'). */
export function pushNative(channel: Channel, title: string, body = '', url?: string) {
  const p = prefs();
  if (!p.on || !p.channels[channel] || !supported() || Notification.permission !== 'granted') return;
  if (!p.always && !document.hidden) return;
  try {
    const n = new Notification(`구조체 · ${title}`, { body, icon: `${import.meta.env.BASE_URL ?? '/'}icon-192.png`, tag: `${channel}:${title}` });
    n.onclick = () => { window.focus(); if (url) location.assign(url); n.close(); };
  } catch { /* some webviews refuse */ }
}
