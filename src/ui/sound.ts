/* 소리 설정: master volume, each cue on or off, and any cue swapped for your own file (kept in this
 * browser). After structs-universe's sound designer, sized for a web client. */
import { html, toast, type Safe } from './dom';
import { openSheet } from './sheet';
import { sfx, CUE_NAMES, type Cue } from '../game/sfx';
import { music } from '../game/music';

export function openSoundSettings() {
  const cues = Object.keys(CUE_NAMES) as Cue[];
  const view = (): Safe => html`
    <div class="snd-top"><label class="field"><span>전체 음량 ${Math.round(sfx.volume * 100)}%</span><input type="range" name="vol" min="0" max="1.5" step="0.05" value="${sfx.volume}" data-act="vol"></label>
      <div class="snd-toggles"><button class="btn ghost sm" data-act="mute">${sfx.muted ? '소리 켜기' : '소리 끄기'} <kbd>M</kbd></button><button class="btn ghost sm" data-act="music">${music.on ? '음악 끄기' : '음악 켜기'} <kbd>J</kbd></button></div></div>
    <ul class="snd-list">${cues.map((c) => html`<li class="${sfx.isOff(c) ? 'off' : ''}">
      <b>${CUE_NAMES[c]}</b><small class="mono faint">${c}${sfx.hasCustom(c) ? ' · 내 파일' : ''}</small>
      <button class="hud-btn" data-act="test" data-c="${c}" aria-label="${CUE_NAMES[c]} 들어보기" title="들어보기">▶</button>
      <label class="btn ghost sm snd-file">파일<input type="file" accept="audio/*" data-act="file" data-on="change" data-c="${c}" aria-label="${CUE_NAMES[c]} 소리 파일"></label>
      ${sfx.hasCustom(c) ? html`<button class="btn ghost sm" data-act="reset" data-c="${c}">기본</button>` : ''}
      <button class="sw" aria-pressed="${!sfx.isOff(c)}" aria-label="${CUE_NAMES[c]} 켜기" data-act="sw" data-c="${c}"></button></li>`)}</ul>
    <p class="note">파일은 이 브라우저에만 저장됩니다. 짧은 소리(1–2초)가 좋습니다.</p>`;
  const handlers = {
    vol: (el: HTMLElement) => { sfx.setVolume(Number((el as HTMLInputElement).value)); s.paint(view()); },
    mute: () => { sfx.toggle(); s.paint(view()); },
    music: () => { music.toggle(); s.paint(view()); },
    test: (el: HTMLElement) => sfx.test(el.dataset.c as Cue),
    sw: (el: HTMLElement) => { const c = el.dataset.c as Cue; sfx.setOff(c, !sfx.isOff(c)); s.paint(view()); },
    reset: (el: HTMLElement) => { void sfx.setCustom(el.dataset.c as Cue, null).then(() => s.paint(view())); },
    file: (el: HTMLElement) => {
      const f = (el as HTMLInputElement).files?.[0]; const c = el.dataset.c as Cue;
      if (!f) return;
      if (f.size > 2_000_000) { toast('2 MB보다 작은 파일을 고르세요.'); return; }
      void sfx.setCustom(c, f).then((ok) => { toast(ok ? `${CUE_NAMES[c]}: 내 소리로 바꿨습니다.` : '이 파일은 재생할 수 없습니다.'); if (ok) sfx.test(c); s.paint(view()); });
    },
  };
  const s = openSheet({ kicker: '소리 설정', title: '소리', wide: true }, view(), handlers);
  void sfx.ready().then(() => s.paint(view()));
}
