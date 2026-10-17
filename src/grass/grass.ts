/* GRASS: the guild stack's real-time feed (Postgres NOTIFY → NATS → WebSocket). Screens subscribe
 * with a subject pattern and re-read the Guild API when something they show changes, instead of
 * polling. One socket per tab, opened on first use. */
import { endpoints } from '../config';
import { NatsWs, type NatsState } from './nats';

export interface GrassEvent { subject: string; category: string; data: Record<string, unknown>; at: number }
type Fn = (e: GrassEvent) => void;

let conn: NatsWs | null = null;
const dec = new TextDecoder();
const stateFns = new Set<(s: NatsState) => void>();

function open(): NatsWs {
  if (conn) return conn;
  conn = new NatsWs({ url: endpoints.grass, name: 'structs-kor' });
  conn.onState((s) => { for (const f of stateFns) f(s); });
  conn.connect();
  return conn;
}

export function grassState(f: (s: NatsState) => void) { stateFns.add(f); if (conn) f(conn.state); return () => { stateFns.delete(f); }; }

/** Subscribe to a NATS subject (`structs.planet.2-14.>`, `structs.player.0-5.1-42`, `consensus`). */
export function onGrass(subject: string, fn: Fn): () => void {
  return open().subscribe(subject, (m) => {
    let data: Record<string, unknown> = {};
    try { data = JSON.parse(dec.decode(m.payload)); } catch { return; }
    fn({ subject: m.subject, category: String(data.category ?? ''), data, at: Date.now() });
  });
}

/** Call `fn` at most once per `ms` while events keep arriving (re-reads, not every event). */
export function throttled(fn: () => void, ms = 1500): () => void {
  let t: ReturnType<typeof setTimeout> | null = null;
  return () => { if (!t) t = setTimeout(() => { t = null; fn(); }, ms); };
}
