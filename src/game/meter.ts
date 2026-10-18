/* The 패권 지수 meter: your share of the galaxy's power, with the four title lines marked on it. */
import { html, type Safe } from '../ui/dom';
import { demo, HEGEMONY } from './demo';

export function hegemonyMeter(): Safe {
  const h = demo.hegemony(), t = demo.hegemonyTier;
  const next = HEGEMONY[t];
  return html`<div class="hegemony" role="meter" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(h * 100)}" aria-label="패권 지수">
    <div class="heg-top"><span class="label c-hwang">패권 지수</span><strong class="mono">${(h * 100).toFixed(1)}%</strong><span class="end mono dim">${t ? HEGEMONY[t - 1].title : '무명'}</span></div>
    <div class="heg-bar"><i style="width:${Math.min(100, h * 100).toFixed(1)}%"></i>${HEGEMONY.map((x, i) => html`<b class="${i < t ? 'got' : ''}" style="left:${x.at * 100}%" title="${x.title}"></b>`)}</div>
    <small class="dim">${next ? `다음 칭호 ${next.title} · ${Math.round(next.at * 100)}%` : '은하의 패자 · 최고 칭호'}</small></div>`;
}

const LINE = ['var(--jeok)', '#B48CF0', '#E8A0C8', '#7FB2F0'];
/** Power over time: my worth (teal, thick) against each rival (thin), last 72 samples. */
export function powerChart(): Safe {
  const hist = demo.powerHist;
  if (hist.length < 3) return html`<p class="note">세력 기록을 모으는 중… (10블록마다)</p>`;
  const ids = demo.rivals().map((r) => r.id);
  const max = Math.max(1, ...hist.flatMap((p) => [p.me, ...ids.map((id) => p.r[id] ?? 0)]));
  const h0 = hist[0].h, span = Math.max(1, hist[hist.length - 1].h - h0);
  // Placed by block height, so time away shows as the gap it was.
  const W = 300, H = 110, x = (i: number) => ((hist[i].h - h0) / span) * W, y = (v: number) => H - (v / max) * (H - 6) - 3;
  const line = (vals: number[]) => vals.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
  const names = demo.rivals();
  return html`<svg class="powchart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="세력 추이">
    ${ids.map((id, k) => html`<path d="${line(hist.map((p) => p.r[id] ?? 0))}" stroke="${LINE[k % LINE.length]}" class="pl"/>`)}
    <path d="${line(hist.map((p) => p.me))}" class="pl me"/></svg>
    <div class="powlegend"><span><i style="background:var(--cheong)"></i>나</span>${names.map((r, k) => html`<span><i style="background:${LINE[k % LINE.length]}"></i>${r.vassal != null ? '♛ ' : ''}${r.name}</span>`)}</div>`;
}
