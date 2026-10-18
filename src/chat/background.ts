/* 통신 stays live after its screen closes: once a commander is signed in (and can sign the chat
 * login), the sync loop runs in the background so the HUD shows unread counts and a DM or a mention
 * pops a notice wherever you are. Signing out stops it. */
import { matrix, localpart } from './matrix';
import { session } from '../api/session';
import { current, go } from '../router';
import { notify } from '../game/fx';
import { pushNative } from '../game/native';
import { href } from '../router';

const seen = new Set<string>();
let primed = false;
let fns: (() => void)[] = [];
export const onUnread = (f: () => void) => { fns.push(f); return () => { fns = fns.filter((x) => x !== f); }; };

export function startBackgroundComms() {
  session.onChange((s) => {
    if (s.state !== 'in') { matrix.stop(); primed = false; seen.clear(); for (const f of fns) f(); return; }
    // A beat after sign-in, so the first screen's own reads go first.
    setTimeout(() => { if (session.status.state === 'in' && matrix.possible) matrix.signIn().then(() => matrix.start()).catch(() => null); }, 3500);
  });
  matrix.onChange(() => {
    for (const f of fns) f();
    const me = localpart(matrix.me);
    for (const r of matrix.rooms.values()) {
      const muted = matrix.muted.has(r.id);
      for (const m of r.events.slice(-12)) {
        if (seen.has(m.id) || m.pending) continue;
        seen.add(m.id);
        // The first sync is history, not news.
        if (!primed || m.mine || m.notice || muted) continue;
        const named = m.body.includes(me);
        if (!(r.direct || named)) continue;
        pushNative(r.direct ? 'dm' : 'mention', r.direct ? `${matrix.displayName(r.id, m.sender)} 님의 메시지` : `${r.name.replace(/^#/, '')}에서 언급`, m.body.slice(0, 120), href(`/chat?room=${encodeURIComponent(r.alias ?? r.id)}`));
        if (current() === '/chat') continue;
        notify(r.direct ? `${matrix.displayName(r.id, m.sender)} 님의 메시지` : `${r.name.replace(/^#/, '')}에서 나를 언급`, m.body.slice(0, 90), 'hwang', 'tick');
      }
    }
    if (matrix.rooms.size) primed = true;
    if (seen.size > 4000) seen.clear();
  });
}

export const openChat = () => go('/chat');

/* Once, a few seconds after a commander first signs in with this version: what's new to try. */
const HINT = 'structs-kor.hint.social';
session.onChange((s) => {
  if (s.state !== 'in') return;
  try { if (localStorage.getItem(HINT)) return; localStorage.setItem(HINT, '1'); } catch { return; }
  setTimeout(() => notify('새 기능', 'Ctrl+K 명령 팔레트 · 통신에 2-14 같은 ID를 쓰면 카드가 됩니다 · 메뉴의 작전 보드와 상황실', 'cheong', null), 6000);
});
