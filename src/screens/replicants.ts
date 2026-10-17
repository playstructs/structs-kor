/* 레플리칸트: extra commanders derived from the same recovery phrase (HD index ≥ 1), each its own
 * player in the guild. Listed by REQ-REP-1 (or derived here and resolved, REQ-REP-2). Replicating
 * is the guild's own signup for the next HD index (POST /auth/signup), gated on energy: each new
 * player needs ≥ 4 kW of substation share, (capacity − load) ÷ (connections + queue). */
import type { Screen } from '../router';
import { href } from '../router';
import { html, mount, n, micro, watts, toast, type Safe } from '../ui/dom';
import { needSession, errorCard, loading } from '../ui/gate';
import { replicants, energy, type Replicant, type Energy } from '../api/planned';
import { guildApi } from '../api/guild';
import { wallet } from '../wallet/wallet';
import { GUILD_ID } from '../config';

type Role = 'productive' | 'bait' | 'raider';
const ROLE: Record<Role, { name: string; builds: string; c1: string; c2: string; head: string }> = {
  productive: { name: '생산형', builds: '추출기 · 정제소 · 필드 발전기', c1: '#43CDB6', c2: '#1C5F6A', head: '#133546' },
  bait: { name: '미끼형', builds: '추출기만 · 광석 축적', c1: '#EBAA49', c2: '#785B02', head: '#3A2F12' },
  raider: { name: '레이더형', builds: '스타파이터 · 추격 전투기 · 탱크 · 구축함', c1: '#EE7D69', c2: '#5D0C15', head: '#2E1F3E' },
};
const CALLSIGNS = ['Vesper', 'Kestrel', 'Orrin', 'Lumen', 'Tamsin', 'Corvid', 'Halcyon', 'Sable', 'Wren', 'Juno', 'Ferro', 'Nox'];
const SCAN = 12;
const MIN_SHARE_MW = 4e6;

interface Doctrine { enabled: boolean; autopilot: boolean; sweepAbove: number; rally: string; roles: Record<string, Role> }
const DKEY = 'structs-kor.doctrine';
const loadDoctrine = (): Doctrine => { try { return { enabled: true, autopilot: false, sweepAbove: 2, rally: '', roles: {}, ...JSON.parse(localStorage.getItem(DKEY) || '{}') }; } catch { return { enabled: true, autopilot: false, sweepAbove: 2, rally: '', roles: {} }; } };
const saveDoctrine = (d: Doctrine) => { try { localStorage.setItem(DKEY, JSON.stringify(d)); } catch { /* fine */ } };

const portrait = (c1: string, c2: string, label: string) => html`<svg class="pix" width="56" height="56" viewBox="0 0 12 12" role="img" aria-label="${label}" style="flex:0 0 56px;background:var(--sunken)"><rect x="3" y="2" width="6" height="6" fill="${c1}"/><rect x="4" y="4" width="1" height="1" fill="#fff"/><rect x="7" y="4" width="1" height="1" fill="#fff"/><rect x="5" y="6" width="2" height="1" fill="${c2}"/><rect x="2" y="8" width="8" height="4" fill="${c2}"/><rect x="5" y="0" width="2" height="2" fill="${c1}"/></svg>`;

const sw = (on: boolean, act: string, label: string) => html`<button class="sw" aria-pressed="${on}" aria-label="${label}" data-act="${act}"></button>`;

const screen: Screen = {
  async render(root) {
    const pid = needSession(root, '레플리칸트');
    if (!pid) return;
    if (wallet.state !== 'unlocked') {
      mount(root, html`<section class="card accent" style="max-width:560px;margin:40px auto"><h1 style="font-size:28px">지갑 잠금 해제 필요</h1><p class="note">레플리칸트는 내 복구 문구에서 파생됩니다. 주소를 계산하려면 지갑을 열어야 합니다.</p><a class="btn primary" href="${href('/login')}">잠금 해제</a></section>`);
      return;
    }
    mount(root, loading());
    let list: Replicant[] = [], en: Energy | null = null, role: Role = 'productive', busy = false;
    const d = loadDoctrine();
    const derived = Array.from({ length: SCAN }, (_, i) => ({ index: i + 1, address: wallet.key(i + 1).address }));
    const nextIndex = () => { const used = new Set(list.map((r) => r.hd_index)); return derived.find((x) => !used.has(x.index))?.index ?? SCAN + 1; };

    const view = (): Safe => {
      const free = en?.power ? Number(en.power.capacity) - Number(en.power.load) : 0;
      const conns = en?.substation?.connection_count ?? 0;
      const share = en?.substation?.connection_capacity != null ? Number(en.substation.connection_capacity) : free / Math.max(1, conns + 1);
      const ok = share >= MIN_SHARE_MW;
      const totAlpha = list.reduce((s, r) => s + Number(r.alpha), 0);
      return html`
      <div style="display:flex;flex-wrap:wrap;gap:8px">
        <div class="tile"><small>레플리칸트</small><strong>${list.length}</strong></div>
        <div class="tile"><small>보유 알파 합계</small><strong class="c-hwang">${micro(totAlpha)} g</strong></div>
        <div class="tile"><small>변전소 몫 / 명</small><strong style="color:${ok ? 'var(--cheong)' : 'var(--jeok)'}">${watts(share)}</strong></div>
      </div>
      <div class="row">
        <section class="card side" aria-label="복제">
          <h1 style="font-size:26px">복제</h1>
          <div class="field"><span>새 레플리칸트 역할</span><div style="display:flex;flex-wrap:wrap;gap:6px">${(Object.keys(ROLE) as Role[]).map((r) => html`<button class="pill ${role === r ? 'on' : ''}" data-act="role" data-r="${r}">${ROLE[r].name}</button>`)}</div></div>
          <button class="btn primary lg" data-act="replicate" ${!ok || busy ? 'disabled' : ''}>복제하기 · #${nextIndex()}</button>
          <div style="padding:12px;background:var(--sunken);border:1px solid var(--line);font:13px/1.7 var(--f-mono)">(용량 − 부하) ÷ (연결 + 대기열)<br>= ${watts(free)} ÷ ${n(conns + 1)}<br><b style="color:${ok ? 'var(--cheong)' : 'var(--jeok)'};font-size:15px">= ${watts(share)} · ${ok ? '복제 가능' : '보류 · 에너지 부족 (4 kW 미만)'}</b></div>
          <p class="note">복제는 다음 HD 인덱스 주소로 길드에 입대 신청을 보냅니다 (서명만 전송). 입대가 체인에 기록되면 명단에 나타납니다.</p>
        </section>

        <section class="grow" aria-label="분대 명단" style="display:flex;flex-direction:column;gap:12px">
          <div class="card-head"><h2 style="font-size:26px">분대 명단</h2><span class="end dim" style="font-size:13px">HD m/44'/118'/0'/0/1–${SCAN} 검색</span></div>
          ${list.length ? html`<div class="g3">${list.map((r, i) => {
            const ro = ROLE[d.roles[r.player_id] ?? 'productive'];
            const name = r.username || `${CALLSIGNS[(r.hd_index ?? i) % CALLSIGNS.length]}-${r.hd_index ?? i + 1}`;
            return html`<article style="background:var(--bg-raised);border:2px solid ${ro.c2};display:flex;flex-direction:column">
              <div style="display:flex;gap:12px;padding:14px;align-items:center;background:${ro.head}">${portrait(ro.c1, ro.c2, name + ' 초상')}
                <div style="min-width:0"><h3 style="font-size:20px">${name}</h3><span style="font-size:12px;color:${ro.c1}">${ro.name} 레플리칸트</span><br><span class="mono dim" style="font-size:11px">${r.player_id} · ${r.planet_id || '행성 없음'}</span></div></div>
              <div style="padding:12px 14px;display:flex;flex-direction:column;gap:8px;font-size:13px">
                <div style="display:flex;justify-content:space-between"><span class="dim">알파</span><span class="mono c-hwang">${micro(r.alpha)} g</span></div>
                <div style="display:flex;justify-content:space-between"><span class="dim">광석</span><span class="mono">${n(r.ore)}</span></div>
                <div style="display:flex;justify-content:space-between"><span class="dim">전력</span><span class="mono">${watts(Number(r.load))} / ${watts(Number(r.capacity))}</span></div>
                <div style="display:flex;justify-content:space-between"><span class="dim">구성</span><span style="text-align:right">${ro.builds}</span></div>
                <label class="field"><span>역할</span><select class="input" data-act="setRole" data-on="change" data-id="${r.player_id}">${(Object.keys(ROLE) as Role[]).map((k) => html`<option value="${k}" ${(d.roles[r.player_id] ?? 'productive') === k ? 'selected' : ''}>${ROLE[k].name}</option>`)}</select></label>
              </div></article>`;
          })}</div>` : html`<div class="card"><p class="empty">아직 레플리칸트가 없습니다. 왼쪽에서 첫 레플리칸트를 복제하세요.</p></div>`}
        </section>

        <section class="card side" aria-label="복무 규칙">
          <h2 style="font-size:26px">복무 규칙</h2>
          <div style="display:flex;justify-content:space-between;align-items:center;gap:12px"><div><b class="c-white">규칙 활성화</b><br><span class="dim" style="font-size:12px">레플리칸트가 스스로 행동</span></div>${sw(d.enabled, 'tEnabled', '규칙 활성화')}</div>
          <div style="display:flex;justify-content:space-between;align-items:center;gap:12px"><div><b class="c-white">사령관 자동 조종</b><br><span class="dim" style="font-size:12px">내 계정도 같은 규칙으로 운영</span></div>${sw(d.autopilot, 'tAuto', '사령관 자동 조종')}</div>
          <label class="field"><span>알파 회수 기준 (g, 넘으면 사령관에게 송금)</span><input class="input" type="number" min="0" value="${d.sweepAbove}" data-act="sweep" data-on="change"></label>
          <label class="field"><span>레이더 집결 행성</span><input class="input" value="${d.rally}" placeholder="2-…" data-act="rally" data-on="change"></label>
          <div class="field"><span>규칙 미리보기 (위에서부터, 먼저 맞는 규칙 실행)</span>
          <pre style="margin:0;padding:12px;background:var(--sunken);border:1px solid var(--line);font:12px/1.7 var(--f-mono);white-space:pre-wrap">${d.enabled ? `만약 구성 미완성   → 구조체 건설
만약 전력 부족     → 전원 연결
만약 광석 소진     → 새 행성 탐사
만약 알파 > ${d.sweepAbove}      → 사령관에게 회수
만약 역할 = 레이더 → ${d.rally || '[집결 행성]'} 집결
만약 행동 거부     → 약 15블록 대기` : '규칙 꺼짐 — 아무 행동도 하지 않습니다.'}</pre></div>
          <p class="note">규칙 실행기는 Structs Desktop이 맡습니다. 여기서 바꾼 규칙은 이 브라우저에 저장됩니다.</p>
        </section>
      </div>`;
    };
    const paint = () => { if (root.isConnected) mount(root, view(), handlers); };
    const save = () => { saveDoctrine(d); paint(); };
    const handlers = {
      role: (el: HTMLElement) => { role = el.dataset.r as Role; paint(); },
      setRole: (el: HTMLElement) => { d.roles[el.dataset.id!] = (el as HTMLSelectElement).value as Role; save(); },
      tEnabled: () => { d.enabled = !d.enabled; save(); },
      tAuto: () => { d.autopilot = !d.autopilot; save(); },
      sweep: (el: HTMLElement) => { d.sweepAbove = Number((el as HTMLInputElement).value) || 0; save(); },
      rally: (el: HTMLElement) => { d.rally = (el as HTMLInputElement).value.trim(); save(); },
      replicate: async () => {
        const i = nextIndex();
        busy = true; paint();
        try {
          const k = wallet.key(i);
          const s = wallet.signMessage(i, `GUILD${GUILD_ID}ADDRESS${k.address}NONCE0`);
          await guildApi.signup({ primary_address: k.address, signature: s.signature, pubkey: s.pubkey, guild_id: GUILD_ID, username: `${CALLSIGNS[i % CALLSIGNS.length]}-${i}` });
          toast(`#${i} 부화 중 · 체인 기록을 기다립니다`);
        } catch (e) { toast('복제 실패: ' + (e as Error).message, 5000); }
        busy = false; paint();
      },
    };
    try {
      const me = await guildApi.player(pid);
      [list, en] = await Promise.all([replicants(pid, derived), energy(me).catch(() => null)]);
      paint();
    } catch (e) { mount(root, errorCard(e)); }
  },
};
export default screen;
