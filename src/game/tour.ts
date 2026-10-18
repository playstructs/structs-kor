/* Coach marks: a short spotlight tour over the bridge the first time someone takes command of the
 * demo base. Each step dims the screen except one element and says what it is for. Enter or the
 * button advances; Escape ends it. Replayable from the ? help. Touch screens get wording without keys. */
import { sfx } from './sfx';

/** `touch` replaces `text` on a touch screen: no keys to press there, and phones stack the panels. */
export interface Step { sel: string; title: string; text: string; touch?: string }
const KEY = 'structs-kor.tour';

export const BRIDGE_TOUR: Step[] = [
  { sel: '#tiles', title: '자원', text: '알파는 안전한 재화, 광석은 약탈당할 수 있는 원료입니다. 숫자 옆은 블록당 변화량. 다음 습격 칸은 남은 블록과 가장 유력한 세력입니다.',
    touch: '알파는 안전한 재화, 광석은 약탈당할 수 있는 원료입니다. 숫자 옆은 블록당 변화량. 막대를 옆으로 밀면 전력 · 보호막 · 다음 습격도 보입니다.' },
  { sel: '.bd-map', title: '전장', text: '내 행성입니다. 빈 칸(신호기)을 누르면 건설, 구조체를 누르면 선택. 오른쪽 안개 너머에서 습격이 옵니다. 드래그로 이동, Z로 확대.',
    touch: '내 행성입니다. 빈 칸(신호기)을 누르면 건설, 구조체를 누르면 선택. 오른쪽 안개 너머에서 습격이 옵니다. 손가락으로 밀어 둘러보고, 돋보기 버튼으로 전체 보기.' },
  { sel: '.ops', title: '작전 목표', text: '목표를 채우면 보상 수령으로 XP를 받고 진급합니다. 높은 계급은 깊은 연구를 엽니다.' },
  { sel: '.ab-bar.player', title: '명령 패널', text: '선택한 것의 명령이 여기 뜹니다. 아무것도 고르지 않으면 기지 명령: Q 정제 · E 건설 · I 주입, 능력은 7–0. 습격이 오면 오른쪽 아래 적 패널에서 A 요격 · S 참호.',
    touch: '선택한 것의 명령이 여기 뜹니다. 아무것도 고르지 않으면 정제 · 건설 · 주입 같은 기지 명령과 능력 버튼. 습격이 오면 적 패널이 나타나 요격 · 참호 태세를 고릅니다.' },
  { sel: '#menu-btn', title: '메뉴', text: '은하 지도, 연구소, 거래소, 작전… 모든 화면은 메뉴(F10)에서. 각 화면은 단축키로도 바로 열리고, Esc로 함교에 돌아옵니다. ? 는 모든 단축키.',
    touch: '은하 지도, 연구소, 거래소, 작전… 모든 화면은 이 메뉴 버튼에서 열립니다. 함교로 돌아올 때도 메뉴에서 함교를 고르세요.' },
];

export const GALAXY_TOUR: Step[] = [
  { sel: 'svg.gx', title: '은하', text: '청록은 내 행성, 붉은 점은 경쟁 세력, ▲는 거점, 보라는 공허 함대. 휠과 드래그로 확대·이동, 0으로 전체 보기.',
    touch: '청록은 내 행성, 붉은 점은 경쟁 세력, ▲는 거점, 보라는 공허 함대. 손가락으로 밀어 둘러봅니다.' },
  { sel: '.gx-wrap aside .card', title: '정보', text: '행성이나 거점을 누르면 여기에 정찰·습격·공작·동맹·투자·복속 명령이 나옵니다. 정찰하면 예상 승률이 보입니다.' },
  { sel: '.hegemony', title: '패권 지수', text: '은하 전체 세력 중 내 몫. 25·40·55·70%에서 칭호를 받고, 70%면 은하 황제입니다. 55%를 넘으면 세력들이 연합해 맞섭니다.' },
];

let active: { close: () => void } | null = null;
const touch = () => matchMedia('(pointer: coarse)').matches;

export const tourSeen = (id: string) => { try { return !!localStorage.getItem(`${KEY}.${id}`); } catch { return true; } };

/** Run a tour; returns false when nothing in it is on screen. */
export function runTour(id: string, steps: Step[]): boolean {
  active?.close();
  const live = steps.filter((s) => document.querySelector(s.sel));
  if (!live.length) return false;
  let i = 0;
  const shade = document.createElement('div');
  shade.className = 'tour';
  shade.innerHTML = '<div class="tour-hole"></div><div class="tour-card" role="dialog" aria-live="polite"><span class="label"></span><b></b><p></p><div class="tour-btns"><button type="button" class="btn ghost" data-t="skip">건너뛰기</button><button type="button" class="btn primary" data-t="next"></button></div></div>';
  document.body.appendChild(shade);
  const hole = shade.querySelector<HTMLElement>('.tour-hole')!, card = shade.querySelector<HTMLElement>('.tour-card')!;
  const place = () => {
    const st = live[i], el = document.querySelector<HTMLElement>(st.sel);
    if (!el) { next(); return; }
    el.scrollIntoView({ block: 'nearest' });
    // A tall target (the rail runs the page's full height) is lit only where it's on screen.
    const b = el.getBoundingClientRect(), top = Math.max(b.top, 8), bottom = Math.min(b.bottom, innerHeight - 8);
    const r = { left: b.left, width: b.width, top, bottom, height: Math.max(0, bottom - top) }, pad = 6;
    Object.assign(hole.style, { left: `${r.left - pad}px`, top: `${r.top - pad}px`, width: `${r.width + pad * 2}px`, height: `${r.height + pad * 2}px` });
    card.querySelector('.label')!.textContent = `안내 ${i + 1} / ${live.length}`;
    card.querySelector('b')!.textContent = st.title;
    card.querySelector('p')!.textContent = (touch() && st.touch) || st.text;
    card.querySelector<HTMLButtonElement>('[data-t="next"]')!.textContent = i === live.length - 1 ? '지휘 시작' : '다음';
    // The card sits below the spotlight, or above it when there is no room.
    const below = r.bottom + 16, w = Math.min(360, innerWidth - 32);
    card.style.width = `${w}px`;
    if (r.height > innerHeight * 0.6) {
      // A column: the card goes beside it.
      card.style.left = `${Math.min(innerWidth - w - 16, r.left + r.width + 20)}px`;
      card.style.top = `${Math.max(16, innerHeight / 2 - 90)}px`;
    } else {
      card.style.left = `${Math.max(16, Math.min(innerWidth - w - 16, r.left))}px`;
      card.style.top = below + 180 < innerHeight ? `${below}px` : `${Math.max(16, r.top - 196)}px`;
    }
    card.querySelector<HTMLButtonElement>('[data-t="next"]')!.focus();
  };
  const close = () => {
    shade.remove(); removeEventListener('resize', place); document.removeEventListener('keydown', key, true); active = null;
    try { localStorage.setItem(`${KEY}.${id}`, '1'); } catch { /* fine */ }
    // The screen puts back whatever the spotlight scrolled (the bridge recentres its camera).
    dispatchEvent(new CustomEvent('structs:tour-end', { detail: id }));
  };
  const next = () => { sfx.play('tick'); if (++i >= live.length) { sfx.play('confirm'); close(); } else place(); };
  const key = (e: KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
    else if (e.key === 'Enter' || e.key === 'ArrowRight') { e.preventDefault(); e.stopPropagation(); next(); }
  };
  shade.addEventListener('click', (e) => { const t = (e.target as HTMLElement).closest<HTMLElement>('[data-t]')?.dataset.t; if (t === 'skip') close(); else if (t === 'next') next(); });
  addEventListener('resize', place);
  document.addEventListener('keydown', key, true);
  active = { close };
  place();
  return true;
}
