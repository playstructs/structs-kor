/* 공유: send an object or a situation to the guild. An object is an id (its link /o/2-14 opens a live
 * card); a situation is a moment frozen in a link (/s/…): a raid on your planet, a battle forecast, a
 * market offer, your base at a glance. The link carries the whole snapshot, so it reads the same for
 * anyone, signed in or not, and chat unfurls both kinds into cards.
 *
 * Where it goes: a 통신 room (Matrix), the clipboard, the device's own share menu, or a PNG card. */
import { html, raw, esc, toast, type Safe } from '../ui/dom';
import { openSheet } from '../ui/sheet';
import { href } from '../router';
import { matrix } from '../chat/matrix';
import { session } from '../api/session';
import { refSlot, resolveRef, idsIn, linkIds, type RefCard } from './refs';
import { entityOf } from '../i18n/ko';
import { sfx } from '../game/sfx';
import { webRoot } from '../core/desktop';
import { messageText } from './text';
import { encodeSituation, decodeSituation, type Situation, type SituationKind } from './situation-code';
export { encodeSituation, decodeSituation, type Situation, type SituationKind };

const KIND: Record<SituationKind, [string, string]> = {
  raid: ['습격 상황', 'icon-raid'], battle: ['전투 예측', 'icon-combat-log'], market: ['거래 제안', 'icon-transfers'], base: ['기지 현황', 'icon-cmd-post'],
  replay: ['전투 기록', 'icon-combat-log'], daily: ['일일 교전', 'icon-success'], guild: ['길드 소식', 'icon-guild'], alert: ['경보', 'icon-alert'], fleet: ['함대 이동', 'icon-fleet-tile'],
};

/** Links are for other people: the website's address, even inside the desktop app (tauri://…). */
export const objectLink = (id: string) => webRoot() + `/o/${id}`;
export const situationLink = (s: Situation) => webRoot() + `/s/${encodeSituation(s)}`;
/** Codes of the situation links in a text (chat unfurls them). */
export function situationsIn(text: string): Situation[] {
  const out: Situation[] = [];
  for (const m of text.matchAll(/\/s\/(S[A-Za-z0-9_-]{8,6000})/g)) { const s = decodeSituation(m[1]); if (s) out.push(s); if (out.length >= 2) break; }
  return out;
}

const when = (at: number) => new Date(at).toLocaleString('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
export function situationHtml(s: Situation, base = href('')): string {
  const [label, icon] = KIND[s.t];
  return `<article class="sit-card ${s.tone ?? (s.t === 'raid' || s.t === 'alert' ? 'jeok' : s.t === 'market' || s.t === 'daily' ? 'hwang' : 'cheong')}">
    <header><span class="sit-kind"><i class="si ${icon}"></i>${esc(label)}</span><small class="mono">${esc(when(s.at))}${s.by ? ` · ${esc(s.by)}` : ''}</small></header>
    <h3>${esc(s.title)}</h3>${s.sub ? `<p>${linkIds(esc(s.sub), base)}</p>` : ''}
    <dl>${s.lines.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd class="mono">${linkIds(esc(v), base)}</dd></div>`).join('')}</dl>
    ${s.go ? `<a class="btn ghost sit-go" href="${base}${esc(s.go)}">열기 →</a>` : ''}
  </article>`;
}

/* ── Recently shared (this browser) ── */
const LOG = 'structs-kor.shared';
export interface SharedEntry { at: number; what: string; link: string; to: string }
export const sharedLog = (): SharedEntry[] => { try { return JSON.parse(localStorage.getItem(LOG) || '[]'); } catch { return []; } };
function remember(e: SharedEntry) { try { localStorage.setItem(LOG, JSON.stringify([e, ...sharedLog()].slice(0, 30))); } catch { /* fine */ } }

/* ── PNG card: drawn on a canvas, so it can be dropped into any messenger. ── */
async function cardPng(title: string, sub: string, lines: [string, string][], kicker: string, tone: string): Promise<Blob | null> {
  const W = 1200, H = 630, c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  if (!g) return null;
  try { await document.fonts.ready; } catch { /* fine */ }
  const col = tone === 'jeok' ? '#EE7D69' : tone === 'hwang' ? '#EBAA49' : '#43CDB6';
  g.fillStyle = '#16142A'; g.fillRect(0, 0, W, H);
  for (let y = 0; y < H; y += 6) { g.fillStyle = 'rgba(255,255,255,0.025)'; g.fillRect(0, y, W, 2); }
  g.strokeStyle = col; g.lineWidth = 8; g.strokeRect(24, 24, W - 48, H - 48);
  g.fillStyle = col; g.fillRect(24, 24, 360, 56);
  g.fillStyle = '#16142A'; g.font = 'bold 30px Galmuri11, Galmuri9, monospace'; g.fillText(kicker, 44, 63);
  g.fillStyle = '#FFFFFF'; g.font = 'bold 64px Galmuri11, monospace'; g.fillText(title.slice(0, 26), 60, 170);
  g.fillStyle = '#C5D7D9'; g.font = '32px Galmuri11, monospace'; g.fillText(sub.slice(0, 48), 60, 222);
  lines.slice(0, 6).forEach(([k, v], i) => {
    const x = 60 + (i % 2) * 540, y = 300 + Math.floor(i / 2) * 92;
    g.fillStyle = '#222034'; g.fillRect(x, y, 500, 76);
    g.fillStyle = '#86DFC6'; g.font = '24px Galmuri11, monospace'; g.fillText(k.slice(0, 18), x + 18, y + 30);
    g.fillStyle = '#FFFFFF'; g.font = 'bold 30px Galmuri11, monospace'; g.fillText(v.slice(0, 26), x + 18, y + 64);
  });
  g.fillStyle = col; g.font = 'bold 28px Galmuri11, monospace'; g.fillText('구조체 STRUCTS', W - 330, H - 52);
  return new Promise((res) => c.toBlob((b) => res(b), 'image/png'));
}

/* ── The sheet ── */
export type ShareTarget = { kind: 'object'; id: string } | { kind: 'situation'; s: Situation };

export function share(t: ShareTarget) {
  const link = t.kind === 'object' ? objectLink(t.id) : situationLink(t.s);
  const what = t.kind === 'object' ? `${entityOf(t.id)} ${t.id}` : t.s.title;
  let comment = '', room = '', rooms: { id: string; name: string }[] = [], chat: 'idle' | 'loading' | 'ready' | 'off' = 'idle', busy = false, err = '', withImage = true;
  const me = session.playerId;
  const preview = (): Safe => raw(t.kind === 'object' ? refSlot(t.id, { base: href(''), noShare: true, me }) : situationHtml(t.s));
  const canChat = matrix.possible && session.status.state === 'in';
  const view = (): Safe => html`
    <div class="share-preview">${preview()}</div>
    <label class="field"><span>한마디 (선택)</span><textarea class="input" name="comment" rows="2" maxlength="400" data-act="comment" placeholder="${t.kind === 'object' ? '예: 이 행성 같이 칠 사람?' : '예: 방어 도와주세요!'}">${comment}</textarea></label>
    <div class="share-to">
      <div class="field"><span>통신 대화방</span>
        ${!canChat ? html`<p class="note">통신에 보내려면 지갑 잠금을 해제하고 길드에 로그인하세요.</p>`
        : chat === 'loading' ? html`<p class="note">대화방 불러오는 중…</p>`
        : chat === 'off' ? html`<p class="note">${err || '통신에 연결할 수 없습니다.'}</p>`
        : html`<select class="input" name="room" data-act="room" data-on="change">${rooms.map((r) => html`<option value="${r.id}" ${r.id === room ? 'selected' : ''}>${r.name}</option>`)}</select>`}
      </div>
      <label class="chk"><input type="checkbox" data-act="withImage" ${withImage ? 'checked' : ''}> 카드 이미지도</label>
      <button class="btn primary" data-act="send" ${!canChat || chat !== 'ready' || !room || busy ? 'disabled' : ''}>${busy ? '보내는 중…' : '통신에 보내기'}</button>
    </div>
    <div class="share-row">
      <button class="btn ghost" data-act="copy"><i class="si icon-copy"></i> 링크 복사</button>
      ${typeof navigator !== 'undefined' && 'share' in navigator ? html`<button class="btn ghost" data-act="native"><i class="si icon-link-out"></i> 기기로 공유</button>` : ''}
      <button class="btn ghost" data-act="png"><i class="si icon-deploy"></i> 카드 이미지</button>
    </div>
    <p class="mono faint share-link">${link.length > 96 ? link.slice(0, 96) + '…' : link}</p>`;
  const text = () => (comment.trim() ? comment.trim() + '\n' : '') + (t.kind === 'object' ? `${what} ${link}` : `[${KIND[t.s.t][0]}] ${t.s.title}\n${link}`);
  const pngFor = async () => {
    let title = what, sub = '', lines: [string, string][] = [], kicker = '구조체 · 공유', tone = 'cheong';
    if (t.kind === 'object') {
      const c: RefCard | null = await resolveRef(t.id);
      if (c) { title = c.title; sub = c.subtitle; lines = c.rows; kicker = entityOf(t.id); tone = c.badge?.tone ?? 'cheong'; }
    } else { title = t.s.title; sub = t.s.sub ?? ''; lines = t.s.lines; kicker = KIND[t.s.t][0]; tone = t.s.tone ?? (t.s.t === 'raid' ? 'jeok' : 'cheong'); }
    return cardPng(title, sub, lines, kicker, tone);
  };
  const handlers = {
    comment: (el: HTMLElement) => { comment = (el as HTMLTextAreaElement).value; },
    withImage: (el: HTMLElement) => { withImage = (el as HTMLInputElement).checked; },
    room: (el: HTMLElement) => { room = (el as HTMLSelectElement).value; try { localStorage.setItem('structs-kor.share.room', room); } catch { /* fine */ } },
    send: () => {
      busy = true; sheet.paint(view());
      const card = withImage ? pngFor().then((b) => (b ? matrix.sendImage(room, b, `structs-${t.kind === 'object' ? t.id : t.s.t}.png`, 1200, 630).catch(() => null) : null)) : Promise.resolve(null);
      card.then(() => matrix.send(room, text())).then(() => {
        sfx.play('confirm'); toast('통신에 공유했습니다.');
        remember({ at: Date.now(), what, link, to: rooms.find((r) => r.id === room)?.name ?? room });
        sheet.close();
      }).catch((e) => { busy = false; toast('전송 실패: ' + (e as Error).message, 4000); sheet.paint(view()); });
    },
    copy: () => {
      void navigator.clipboard?.writeText(text()).then(() => { toast('링크를 복사했습니다.'); remember({ at: Date.now(), what, link, to: '클립보드' }); }).catch(() => toast('복사하지 못했습니다.'));
    },
    native: () => { void (navigator as Navigator).share?.({ title: `구조체 · ${what}`, text: comment || what, url: link }).then(() => remember({ at: Date.now(), what, link, to: '기기 공유' })).catch(() => null); },
    png: async () => {
      const b = await pngFor();
      if (!b) { toast('이미지를 만들지 못했습니다.'); return; }
      const a = document.createElement('a');
      a.href = URL.createObjectURL(b); a.download = `structs-${t.kind === 'object' ? t.id : t.s.t}.png`; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    },
  };
  const sheet = openSheet({ kicker: t.kind === 'object' ? '객체 공유' : '상황 공유', title: what, tone: t.kind === 'situation' ? t.s.tone : undefined }, view(), handlers);
  if (canChat) {
    chat = 'loading'; sheet.paint(view());
    matrix.ensure().then(() => {
      const rank = (r: { alias: string | null; local: boolean; direct: boolean }) => (r.alias && /^#(sn-corp|guild)/.test(r.alias) ? 0 : r.local && !r.direct ? 1 : r.direct ? 2 : 3);
      rooms = [...matrix.rooms.values()].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name)).map((r) => ({ id: r.id, name: (r.direct ? '@ ' : '# ') + r.name.replace(/^#/, '') }));
      let saved = ''; try { saved = localStorage.getItem('structs-kor.share.room') || ''; } catch { /* fine */ }
      room = rooms.find((r) => r.id === saved)?.id ?? rooms[0]?.id ?? '';
      chat = rooms.length ? 'ready' : 'off'; if (!rooms.length) err = '참여한 대화방이 없습니다.';
      sheet.paint(view());
    }).catch((e) => { chat = 'off'; err = '통신 연결 실패: ' + (e as Error).message; sheet.paint(view()); });
  }
}

/** The text of a message, ready to read (see ./text). */
export const messageHtml = (body: string, base = href('')) => messageText(body, base);
/** Object ids a message is about: named ids plus /o/ links (situations bring their own). */
export const messageIds = (body: string) => idsIn(body.replace(/\/s\/S[A-Za-z0-9_-]+/g, ''), 3);
