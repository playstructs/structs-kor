/* 통신 stays live after its screen closes: once a commander is signed in (and can sign the chat
 * login), the sync loop runs in the background so the HUD shows unread counts and a DM or a mention
 * pops a notice wherever you are. Signing out stops it. */
import { matrix, localpart } from './matrix';
import { session } from '../api/session';
import { current, go } from '../router';
import { notify } from '../game/fx';

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
      for (const m of r.events.slice(-12)) {
        if (seen.has(m.id) || m.pending) continue;
        seen.add(m.id);
        // The first sync is history, not news.
        if (!primed || m.mine || m.notice) continue;
        const named = m.body.includes(me);
        if (!(r.direct || named) || current() === '/chat') continue;
        notify(r.direct ? `${matrix.displayName(r.id, m.sender)} 님의 메시지` : `${r.name.replace(/^#/, '')}에서 나를 언급`, m.body.slice(0, 90), 'hwang', 'tick');
      }
    }
    if (matrix.rooms.size) primed = true;
    if (seen.size > 4000) seen.clear();
  });
}

export const openChat = () => go('/chat');
