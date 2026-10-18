/* 시스템 진단: when something seems stuck, this says where. Who you are (public facts only), every
 * connection the client depends on with its latency (Guild API and its indexer lag, GRASS, Matrix,
 * the chain's LCD), the proof-of-work engine, the Guild API routes still running on fallbacks, and
 * the standing orders. One button copies a report to paste for the guild's operators — never a
 * phrase, key or token. After structs-universe's Debug tab and System → Diagnostics. */
import type { Screen } from '../router';
import { href } from '../router';
import { html, mount, n, toast, type Safe } from '../ui/dom';
import { needSession } from '../ui/gate';
import { guildApi, type PlayerRow, type BlockRow } from '../api/guild';
import { endpoints, GUILD_ID, TRANSPORT } from '../config';
import { MOCK } from '../api/http';
import { REQUIREMENTS, fallbacksUsed } from '../api/requirements';
import { grassState } from '../grass/grass';
import { matrix } from '../chat/matrix';
import { pow } from '../pow/engine';
import { wallet } from '../wallet/wallet';
import { doctrine, dutyLog } from '../game/orders';
import { prefs as notifyPrefs, permission } from '../game/native';
import { setTiles } from '../ui/shell';
import { txLog, onTx } from '../api/txlog';

interface Probe { name: string; target: string; ok: boolean | null; ms: number | null; note: string }

const timed = async <T,>(f: () => Promise<T>): Promise<[T | null, number, string]> => {
  const t0 = performance.now();
  try { const v = await f(); return [v, Math.round(performance.now() - t0), '']; } catch (e) { return [null, Math.round(performance.now() - t0), (e as Error).message]; }
};

const screen: Screen = {
  async render(root) {
    const pid = needSession(root, '시스템 진단');
    if (!pid) return;
    let me: PlayerRow | null = null, block: BlockRow | null = null, grass = 'closed';
    const probes: Probe[] = [];

    const view = (): Safe => {
      const used = fallbacksUsed(), d = doctrine();
      return html`
      <div class="card-head"><h1 style="font-size:28px">시스템 진단</h1><span class="label c-cheong">DIAGNOSTICS</span>
        <span class="end" style="display:flex;gap:6px"><button class="btn ghost sm" data-act="rerun">다시 점검</button><button class="btn primary sm" data-act="copy">진단 보고서 복사</button></span></div>
      <div class="guild-wrap">
        <section class="card game-panel"><h2>신원</h2><table class="t"><tbody>
          <tr><td class="dim">플레이어</td><td class="mono">${pid}${me?.username ? ` · ${me.username}` : ''}</td></tr>
          <tr><td class="dim">주소</td><td class="mono" style="overflow-wrap:anywhere">${wallet.commander?.address ?? '—'} ${wallet.commander ? html`<button class="linkish" data-act="copyAddr">복사</button>` : ''}</td></tr>
          <tr><td class="dim">길드</td><td class="mono">${me?.guild_id ?? GUILD_ID}${me?.tag ? ` [${me.tag}]` : ''}</td></tr>
          <tr><td class="dim">변전소 · 행성 · 함대</td><td class="mono">${me ? `${me.substation_id || '—'} · ${me.planet_id || '—'} · ${me.fleet_id || '—'}` : '—'}</td></tr>
          <tr><td class="dim">지갑</td><td>${wallet.state === 'unlocked' ? '열림' : wallet.state === 'locked' ? '잠김' : '없음'}${wallet.deviceSealed ? ' · 기기 봉인' : ''} · 레플리칸트 ${n(wallet.accounts.filter((a) => a.index > 0).length)}</td></tr>
          <tr><td class="dim">모드</td><td>${MOCK ? '모의 (개발)' : TRANSPORT === 'relay' ? '개발 릴레이' : '직접 연결'}</td></tr>
        </tbody></table></section>
        <section class="card game-panel"><h2>연결</h2><ul class="diag-list">
          ${probes.map((p) => html`<li><span class="dot ${p.ok == null ? 'connecting' : p.ok ? 'live' : 'expired'}"></span><b>${p.name}</b><small class="mono faint">${p.target}</small><span class="mono">${p.ms == null ? '…' : `${n(p.ms)} ms`}</span>${p.note ? html`<small class="${p.ok ? 'dim' : 'c-jeok'}">${p.note}</small>` : ''}</li>`)}
          <li><span class="dot ${grass === 'live' ? 'live' : grass === 'connecting' ? 'connecting' : 'expired'}"></span><b>GRASS 실시간</b><small class="mono faint">${endpoints.grass}</small><span class="mono">${grass === 'live' ? '연결됨' : grass === 'connecting' ? '연결 중' : grass === 'down' ? '끊김' : '닫힘'}</span></li>
          <li><span class="dot ${matrix.state === 'live' ? 'live' : matrix.state === 'idle' ? '' : matrix.state === 'expired' ? 'expired' : 'connecting'}"></span><b>통신 (Matrix)</b><small class="mono faint">${matrix.server || endpoints.matrix}</small><span class="mono">${({ idle: '대기', connecting: '연결 중', live: '실시간', stalled: '재연결 중', expired: '세션 만료' } as Record<string, string>)[matrix.state]}</span>${matrix.state === 'live' ? html`<small class="dim">대화방 ${n(matrix.rooms.size)}</small>` : ''}</li>
        </ul>
        ${block && block.lag_blocks > 20 ? html`<div class="notice err">인덱서가 체인보다 ${n(block.lag_blocks)}블록 뒤처져 있습니다. 화면의 숫자가 늦게 바뀔 수 있습니다.</div>` : ''}</section>
        <section class="card game-panel"><h2>작업 증명 엔진</h2>
          <div class="stat-grid"><div class="stat"><small>상태</small><strong>${pow.running ? '해싱 중' : '정지'}</strong></div><div class="stat"><small>속도</small><strong class="mono">${n(pow.rate / 1000, 1)} kH/s</strong></div><div class="stat"><small>작업</small><strong class="mono">${n(pow.tasks.size)}</strong></div><div class="stat"><small>코어</small><strong class="mono">${n(navigator.hardwareConcurrency || 0)}</strong></div></div>
          <a class="btn ghost sm" href="${href('/console')}">함교의 작업 증명 카드</a></section>
        <section class="card game-panel"><h2>최근 거래</h2>
          ${txLog().length ? html`<ol class="ledger">${txLog().slice(0, 20).map((t) => html`<li class="${t.status === 'failed' || t.status === 'refused' ? 'out' : 'in'}"><b>${({ pending: '대기', ok: '완료', failed: '실패', unknown: '확인 불가', refused: '거부' } as Record<string, string>)[t.status]}</b><span class="mono">${t.name.replace(/^Msg/, '')}${t.signer ? ` · #${t.signer}` : ''}</span><small class="mono faint">${t.hash ? t.hash.slice(0, 10) + '…' : ''}${t.height ? ` #${n(t.height)}` : ''}</small><small class="mono faint">${new Date(t.at).toLocaleTimeString('ko-KR')}</small>${t.error ? html`<small class="c-jeok" style="grid-column:1/-1">${t.error.slice(0, 160)}</small>` : ''}</li>`)}</ol>` : html`<p class="note">이번 세션에 보낸 거래가 없습니다.</p>`}</section>
        <section class="card game-panel"><h2>대체 경로 (Guild API)</h2>
          ${used.length ? html`<ul class="diag-list">${REQUIREMENTS.filter((r) => used.includes(r.id)).map((r) => html`<li><span class="planned">${r.id}</span><b>${r.title}</b><small class="mono faint">${r.endpoint} → ${r.fallback}</small></li>`)}</ul>` : html`<p class="note">이번 세션에서는 대체 경로를 쓰지 않았습니다.</p>`}
          <p class="note">길드가 이 경로들을 제공하면 클라이언트는 코드 변경 없이 더 빨라집니다 (docs/guild-api-requirements.md).</p></section>
        <section class="card game-panel"><h2>복무 규칙 · 알림</h2>
          <p>${d.enabled ? '규칙 켜짐' : '규칙 꺼짐'} · 자동 회수 ${d.autoSweep ? `켜짐 (${d.sweepAbove} g 초과)` : '꺼짐'} · 자동 복제 ${d.autoReplicate ? `켜짐 (최대 ${d.maxReps})` : '꺼짐'}</p>
          <p class="note">최근 일지: ${dutyLog()[0]?.text ?? '없음'}</p>
          <p>시스템 알림 ${notifyPrefs().on ? '켜짐' : '꺼짐'} · 브라우저 권한 ${permission()}</p>
          <a class="btn ghost sm" href="${href('/replicants?tab=orders')}">복무 규칙</a></section>
      </div>`;
    };
    const paint = () => { if (root.isConnected) mount(root, view(), handlers); setTiles([{ label: '연결', value: `${probes.filter((p) => p.ok).length}/${probes.length}`, tone: probes.every((p) => p.ok) ? 'var(--cheong)' : 'var(--warn)' }]); };
    const run = async () => {
      probes.length = 0;
      const add = (name: string, target: string) => { const p: Probe = { name, target, ok: null, ms: null, note: '' }; probes.push(p); return p; };
      const api = add('길드 API', endpoints.guildApi), lcd = add('체인 LCD', endpoints.lcd);
      paint();
      const [b, ms, err] = await timed(() => guildApi.block());
      block = b; api.ok = !!b; api.ms = ms; api.note = b ? `블록 #${n(b.height)} · 지연 ${n(b.lag_blocks)}블록` : err;
      me = await guildApi.player(pid).catch(() => null);
      paint();
      if (MOCK) { lcd.ok = true; lcd.ms = 0; lcd.note = '모의 모드: 확인 생략'; }
      else {
        const [node, ms2, err2] = await timed(() => fetch(endpoints.lcd + '/cosmos/base/tendermint/v1beta1/node_info').then((r) => (r.ok ? r.json() : Promise.reject(new Error(`LCD ${r.status}`)))) as Promise<{ default_node_info?: { network?: string } }>);
        lcd.ok = !!node; lcd.ms = ms2; lcd.note = node ? `체인 ${node.default_node_info?.network ?? '?'}` : err2;
      }
      paint();
    };
    const report = () => JSON.stringify({
      at: new Date().toISOString(), client: 'structs-kor', mode: MOCK ? 'mock' : TRANSPORT, player: pid, guild: me?.guild_id ?? GUILD_ID, address: wallet.commander?.address,
      wallet: wallet.state, replicants: wallet.accounts.filter((a) => a.index > 0).length,
      probes: probes.map((p) => ({ name: p.target, ok: p.ok, ms: p.ms, note: p.note })), block, grass, matrix: { state: matrix.state, rooms: matrix.rooms.size },
      pow: { running: pow.running, rate: Math.round(pow.rate), tasks: pow.tasks.size }, fallbacks: fallbacksUsed(), doctrine: doctrine(), ua: navigator.userAgent,
    }, null, 2);
    const handlers = {
      rerun: () => void run(),
      copy: () => { void navigator.clipboard?.writeText(report()).then(() => toast('진단 보고서를 복사했습니다 (비밀 정보 없음).')).catch(() => toast('복사하지 못했습니다')); },
      copyAddr: () => { void navigator.clipboard?.writeText(wallet.commander?.address ?? '').then(() => toast('주소를 복사했습니다.')); },
    };
    paint();
    const offGrass = grassState((s) => { grass = s; paint(); });
    const offTx = onTx(paint);
    await run();
    return () => { offGrass(); offTx(); setTiles([]); };
  },
};
export default screen;
