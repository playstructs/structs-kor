/* An object's history from the guild's stat tables (/api/stat/<metric>/object/<id>/range): ore held,
 * power load and capacity over the last days, drawn as a small line chart with a per-bucket hover
 * readout and a table for screen readers. After structs-universe's terminal charts (source "stat"). */
import { get } from '../api/http';
import { esc, n } from '../ui/dom';

export type Metric = 'ore' | 'load' | 'capacity' | 'fuel' | 'struct_health' | 'connection_count';
export interface Point { t: number; v: number }

export async function history(metric: Metric, id: string, days = 7): Promise<Point[]> {
  const end = Math.floor(Date.now() / 1000), start = end - days * 86_400;
  const rows = await get<{ time?: string; bucket?: string; value?: unknown }[]>(`stat/${metric}/object/${encodeURIComponent(id)}/range/page/1`, { start_time: start, end_time: end, limit: 500, bucket: days > 2 ? '1h' : undefined }).catch(() => null);
  return (rows ?? []).map((r) => ({ t: Date.parse(String(r.time ?? r.bucket ?? '')), v: Number(r.value) })).filter((p) => Number.isFinite(p.t) && Number.isFinite(p.v)).sort((a, b) => a.t - b.t);
}

/** One series, one axis; the last value labelled; hover a bucket for its time and value. */
export function sparkHtml(points: Point[], o: { label: string; unit: string; scale?: number; tone?: string }): string {
  const scale = o.scale ?? 1;
  if (points.length < 2) return `<div class="spark-card"><b>${esc(o.label)}</b><p class="note">기록이 아직 부족합니다.</p></div>`;
  const W = 300, H = 72, P = 4;
  const vs = points.map((p) => p.v / scale), lo = Math.min(...vs), hi = Math.max(...vs), span = hi - lo || 1;
  const t0 = points[0].t, t1 = points.at(-1)!.t, dt = t1 - t0 || 1;
  const x = (t: number) => P + ((t - t0) / dt) * (W - P * 2), y = (v: number) => H - P - ((v - lo) / span) * (H - P * 2);
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p.v / scale).toFixed(1)}`).join('');
  const area = `${path}L${x(t1).toFixed(1)},${H - P}L${x(t0).toFixed(1)},${H - P}Z`;
  const when = (t: number) => new Date(t).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit' });
  const step = (W - P * 2) / points.length;
  const last = vs.at(-1)!, first = vs[0], delta = last - first;
  return `<figure class="spark-card" style="--sc:${o.tone ?? 'var(--cheong)'}"><figcaption><b>${esc(o.label)}</b><span class="mono">${n(last, 1)} ${esc(o.unit)}</span><small class="mono ${delta > 0 ? 'up' : delta < 0 ? 'down' : ''}">${delta > 0 ? '▲' : delta < 0 ? '▼' : ''} ${n(Math.abs(delta), 1)}</small></figcaption>
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(o.label)} ${n(first, 1)}에서 ${n(last, 1)} ${esc(o.unit)}"><path d="${area}" class="sp-area"/><path d="${path}" class="sp-line"/><circle cx="${x(t1).toFixed(1)}" cy="${y(last).toFixed(1)}" r="3" class="sp-dot"/>
    ${points.map((p) => `<rect x="${(x(p.t) - step / 2).toFixed(1)}" y="0" width="${step.toFixed(1)}" height="${H}" class="sp-hit"><title>${when(p.t)} · ${n(p.v / scale, 1)} ${esc(o.unit)}</title></rect>`).join('')}</svg>
    <span class="sp-range mono faint">${when(t0)} – ${when(t1)} · 최저 ${n(lo, 1)} · 최고 ${n(hi, 1)}</span>
    <table class="sr"><caption>${esc(o.label)}</caption><tbody>${points.filter((_, i) => i % Math.ceil(points.length / 24) === 0).map((p) => `<tr><td>${when(p.t)}</td><td>${n(p.v / scale, 1)}</td></tr>`).join('')}</tbody></table></figure>`;
}
