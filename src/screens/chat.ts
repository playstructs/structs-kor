/* 통신: Matrix chat, signed in through the guild (POST /api/auth/matrix). Rooms are sectioned the
 * way Comms does it: 고정 · 다이렉트 · 로컬 넷 (my guild's homeserver) · 갤럭시 넷 (other servers).
 * Object ids in messages (2-14, 1-42) become references; a message that looks like a recovery
 * phrase is stopped before it is sent, with Cancel as the default. */
import type { Screen } from '../router';
import { href } from '../router';
import { html, mount, raw, esc, toast, type Safe } from '../ui/dom';
import { needSession } from '../ui/gate';
import { matrix, type Room } from '../chat/matrix';
import { looksLikePhrase } from '../wallet/keys';
import { wallet } from '../wallet/wallet';
import { entityOf } from '../i18n/ko';

const PINNED = ['#sn-corp', '#help', '#infrastructure'];

/** Escape, then turn object ids into reference chips. */
function rich(body: string): Safe {
  return raw(esc(body).replace(/\b(1[01]|[0-9])-(\d{1,7})\b/g, (m) => `<span class="chip cheong mono" title="${esc(entityOf(m))}">${m}</span>`));
}

const screen: Screen = {
  async render(root) {
    if (!needSession(root, '통신')) return;
    if (wallet.state !== 'unlocked') {
      mount(root, html`<section class="card accent" style="max-width:560px;margin:40px auto"><h1 style="font-size:28px">지갑 잠금 해제 필요</h1><p class="note">채팅은 지갑 서명으로 로그인합니다. 비밀번호는 필요 없습니다.</p><a class="btn primary" href="${href('/login')}">잠금 해제</a></section>`);
      return;
    }
    let active: string | null = null, draft = '', guard = false, err = '';
    const sorted = () => [...matrix.rooms.values()].sort((a, b) => (b.events.at(-1)?.ts ?? 0) - (a.events.at(-1)?.ts ?? 0));
    const sections = (): [string, Room[]][] => {
      const all = sorted();
      const pinned = all.filter((r) => r.alias && PINNED.some((p) => r.alias!.startsWith(p + ':')));
      const rest = all.filter((r) => !pinned.includes(r));
      return [['고정', pinned], ['다이렉트 메시지', rest.filter((r) => r.direct)], ['로컬 넷 · 내 길드', rest.filter((r) => !r.direct && r.local)], ['갤럭시 넷 · 타 서버', rest.filter((r) => !r.direct && !r.local)]];
    };
    const view = (): Safe => {
      const room = active ? matrix.rooms.get(active) : null;
      return html`
      <div style="display:flex;flex-wrap:wrap;border:2px solid var(--line);min-height:70vh;margin:-4px">
        <nav aria-label="대화방 목록" style="flex:1 1 260px;max-width:300px;background:var(--bg-raised);border-right:1px solid var(--line);overflow-y:auto">
          <div class="mono c-cheong" style="padding:12px 14px;font-size:12px;border-bottom:1px solid var(--line)">● ${matrix.grant?.user_id ?? '연결 중…'}</div>
          ${sections().map(([title, rooms]) => html`<div class="label faint" style="padding:14px 14px 6px;font-size:11px">${title}</div>
            ${rooms.length ? rooms.map((r) => html`<button data-act="open" data-id="${r.id}" style="display:flex;align-items:center;gap:10px;width:100%;min-height:44px;padding:8px 14px;border:0;background:${r.id === active ? 'var(--cheong-bg)' : 'transparent'};box-shadow:${r.id === active ? 'inset 3px 0 0 var(--cheong)' : 'none'};color:${r.id === active ? '#fff' : 'var(--text)'};font-size:14px;text-align:left;cursor:pointer">
              <span class="faint">${r.direct ? '@' : '#'}</span><span style="flex:1 1 auto;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${r.name.replace(/^#/, '')}</span>${r.unread ? html`<span style="min-width:20px;padding:1px 6px;background:var(--jeok-strong);color:#fff;font:11px var(--f-mono);text-align:center">${r.unread > 99 ? '99+' : r.unread}</span>` : ''}</button>`) : html`<p class="faint" style="padding:0 14px;font-size:12px;margin:4px 0">없음</p>`}`)}
          <form data-act="join" data-on="submit" style="padding:12px 14px;display:flex;gap:6px"><label class="sr" for="joinbox">대화방 참여</label><input id="joinbox" class="input" name="alias" placeholder="#planet-2-…" style="font-size:13px;min-height:40px"><button class="btn ghost" style="min-height:40px">참여</button></form>
        </nav>
        <section style="flex:999 1 480px;min-width:0;display:flex;flex-direction:column">
          ${room ? html`
            <div style="display:flex;align-items:center;gap:12px;padding:12px 20px;border-bottom:1px solid var(--line);background:var(--bg-raised)"><h1 style="font-size:22px">${room.name}</h1><span class="dim" style="font-size:13px">${room.members ? room.members + '명' : ''} · ${room.local ? '로컬 넷' : '갤럭시 넷'}</span></div>
            <div id="timeline" style="flex:1 1 auto;overflow-y:auto;padding:20px;display:flex;flex-direction:column;gap:12px;min-height:360px">
              ${room.events.length ? room.events.map((m, i) => {
                const day = new Date(m.ts).toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' });
                const prev = room.events[i - 1];
                const showDay = !prev || new Date(prev.ts).toDateString() !== new Date(m.ts).toDateString();
                const name = m.sender.replace(/^@/, '').split(':')[0];
                return html`${showDay ? html`<div style="display:flex;align-items:center;gap:12px;color:var(--text-faint);font-size:12px"><span style="flex:1 1 auto;height:1px;background:var(--line)"></span>${day}<span style="flex:1 1 auto;height:1px;background:var(--line)"></span></div>` : ''}
                <div style="display:flex;gap:10px;align-items:flex-end;flex-direction:${m.mine ? 'row-reverse' : 'row'}">
                  <div style="display:flex;flex-direction:column;gap:4px;max-width:640px;align-items:${m.mine ? 'flex-end' : 'flex-start'}">
                    ${m.mine ? '' : html`<span class="mono" style="font-size:12px;color:var(--cheong-hi)">${name}</span>`}
                    <div style="background:${m.mine ? 'var(--cheong-bg)' : 'var(--surface)'};border:1px solid ${m.mine ? 'var(--cheong-mid)' : 'var(--line)'};padding:10px 14px;color:#fff;font-size:15px;line-height:1.65;white-space:pre-wrap;overflow-wrap:anywhere">${rich(m.body)}</div>
                  </div>
                  <span style="font-size:11px;color:var(--text-faint);white-space:nowrap">${new Date(m.ts).toLocaleTimeString('ko-KR', { hour: 'numeric', minute: '2-digit' })}</span>
                </div>`;
              }) : html`<p class="empty" style="margin:auto">아직 메시지가 없습니다. 첫 메시지를 보내보세요.</p>`}
            </div>
            ${guard ? html`<div role="alertdialog" aria-label="복구 문구 경고" class="card danger" style="margin:0 20px 12px">
              <h2 style="font-size:20px;color:var(--jeok-hi)">복구 문구로 보이는 메시지입니다</h2>
              <p class="note" style="color:#F4D3C9">12–24개 단어로 된 문구는 지갑 복구 키일 수 있습니다. SN.CORP와 길드 운영진은 절대 복구 키를 요구하지 않습니다.</p>
              <div style="display:flex;gap:8px"><button class="btn danger" data-act="cancel" autofocus>취소 (권장)</button><button class="btn outline-danger" data-act="force">그래도 보내기</button></div></div>` : ''}
            <form data-act="send" data-on="submit" style="padding:12px 20px 16px;border-top:1px solid var(--line);background:var(--bg-raised);display:flex;gap:8px">
              <label class="sr" for="msg">메시지 입력</label>
              <input id="msg" class="input" style="font-family:var(--f-body)" placeholder="${room.name}에 메시지 보내기 · 2-14 처럼 객체 ID를 쓰면 참조가 됩니다" value="${draft}" data-act="type" autocomplete="off">
              <button class="btn primary" style="min-width:88px">전송</button>
            </form>` : html`<div class="empty" style="margin:auto">${err || (matrix.rooms.size ? '왼쪽에서 대화방을 고르세요.' : '대화방을 불러오는 중…')}</div>`}
        </section>
      </div>`;
    };
    const paint = () => {
      if (!root.isConnected) return;
      const focused = document.activeElement?.id === 'msg';
      mount(root, view(), handlers);
      const tl = root.querySelector('#timeline'); if (tl) tl.scrollTop = tl.scrollHeight;
      if (focused) { const i = root.querySelector<HTMLInputElement>('#msg'); i?.focus(); i?.setSelectionRange(i.value.length, i.value.length); }
    };
    const push = () => {
      const text = draft.trim(); if (!text || !active) return;
      draft = ''; guard = false; paint();
      matrix.send(active, text).catch((e) => toast('전송 실패: ' + (e as Error).message, 4000));
    };
    const handlers = {
      open: (el: HTMLElement) => { active = el.dataset.id!; const r = matrix.rooms.get(active); if (r) { r.unread = 0; const last = r.events.at(-1); if (last) void matrix.read(r.id, last.id); } paint(); },
      type: (el: HTMLElement) => { draft = (el as HTMLInputElement).value; },
      send: () => { if (looksLikePhrase(draft)) { guard = true; paint(); return; } push(); },
      force: push,
      cancel: () => { guard = false; paint(); },
      join: (el: HTMLElement) => {
        const a = String(new FormData(el as HTMLFormElement).get('alias') || '').trim(); if (!a) return;
        const alias = a.includes(':') ? a : `${a.startsWith('#') ? a : '#' + a}:${matrix.server}`;
        matrix.join(alias).then((r) => { active = r.room_id; toast('참여했습니다.'); }).catch((e) => toast('참여 실패: ' + (e as Error).message, 4000));
      },
    };
    paint();
    const off = matrix.onChange(() => { if (!active) active = sorted()[0]?.id ?? null; paint(); });
    try { await matrix.signIn(); matrix.start(); } catch (e) { err = '채팅 로그인 실패: ' + (e as Error).message; paint(); }
    return () => { off(); matrix.stop(); };
  },
};
export default screen;
