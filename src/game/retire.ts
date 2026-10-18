/* The demo base is retired: 바로 플레이 enlists a real commander instead. A browser that still holds
 * a demo save has it cleared on the next visit, once, and the title screen says so. The rank earned
 * there is not lost: progress.ts hands it to the first real commander. */
import { demo } from './demo';

const NOTICE = 'structs-kor.demo.retired';

export function retireDemo() {
  try {
    if (localStorage.getItem('structs-kor.demo') !== '1' && !localStorage.getItem('structs-kor.demo.state')) return;
    demo.stop(); // clears the save, the clock and the flag
    localStorage.removeItem('structs-kor.daily.demo');
    localStorage.setItem(NOTICE, '1');
  } catch { /* storage refused: nothing was saved to retire */ }
}

/** The one-time "the demo has ended" note: shown until dismissed or a real commander signs in. */
export const retiredNotice = {
  get pending() { try { return localStorage.getItem(NOTICE) === '1'; } catch { return false; } },
  /** Was there a demo rank waiting to carry over? */
  get carriesRank() { try { return !!localStorage.getItem('structs-kor.career.demo'); } catch { return false; } },
  dismiss() { try { localStorage.removeItem(NOTICE); } catch { /* fine */ } },
};
