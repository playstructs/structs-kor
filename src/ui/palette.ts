/* 명령 팔레트 (Ctrl/⌘-K): one box for everything. A bare id opens its card; `WORD id` or `id WORD`
 * runs a verb on it (공유 2-14, 1-7 보내기 5); a screen name goes there. Korean words and English
 * aliases both work, and Hangul matches by initial consonants too (ㅅㅈ → 시장).
 * After structs-universe's ⌘K palette and command grammar. */
import { go, href } from '../router';
import { esc } from './dom';
import { NAV_KEYS } from '../game/keys';
import { isRefId, REF_KINDS, resolveRef, cardFor } from '../social/refs';
import { entityOf } from '../i18n/ko';
import { share } from '../social/share';
import { openTransfer } from '../social/transfer';
import { openRent, watchlist, toggleWatch } from '../social/actions';
import { baseSituation } from '../social/situations';
import { session } from '../api/session';
import { matrix } from '../chat/matrix';
import { guildApi } from '../api/guild';
import { sfx } from '../game/sfx';
import { toast } from './dom';

interface Verb { word: string; aliases: string[]; label: string; hint: string; icon: string; arg?: 'id' | 'player' | 'provider' | 'text' | 'none'; run: (arg: string, rest: string[]) => void | Promise<void> }

const pidArg = (a: string) => (/^\d+$/.test(a) ? '1-' + a : a);
const VERBS: Verb[] = [
  { word: '열기', aliases: ['open', 'inspect', 'card', '카드'], label: '객체 카드 열기', hint: '열기 2-14', icon: 'icon-info', arg: 'id', run: (a) => go(`/o/${a}`) },
  { word: '공유', aliases: ['share', 'say'], label: '공유하기', hint: '공유 2-14', icon: 'icon-link-out', arg: 'id', run: (a) => share({ kind: 'object', id: a }) },
  { word: '보내기', aliases: ['pay', 'send', 'deliver', '송금'], label: '알파 보내기', hint: '보내기 1-7 5', icon: 'icon-send-alpha', arg: 'player', run: (a, r) => void openTransfer({ to: a ? pidArg(a) : undefined, amount: Number(r[0]) || undefined }) },
  { word: '메시지', aliases: ['dm', 'msg', 'message', 'talk', '귓속말'], label: '다이렉트 메시지', hint: '메시지 1-7', icon: 'icon-phone', arg: 'player', run: (a) => go(a ? `/chat?dm=${pidArg(a)}` : '/chat') },
  { word: '방', aliases: ['room', 'channel', '채널'], label: '대화방 열기', hint: '방 #help', icon: 'icon-phone', arg: 'text', run: (a) => go(`/chat${a ? `?room=${encodeURIComponent(a.startsWith('#') ? a : '#' + a)}` : ''}`) },
  { word: '임대', aliases: ['rent', 'lease'], label: '전력 임대', hint: '임대 10-3', icon: 'icon-transfers', arg: 'provider', run: async (a) => { const c = cardFor(a) ?? await resolveRef(a); if (c?.provider) openRent(c.provider); else toast('공급자를 찾지 못했습니다.'); } },
  { word: '감시', aliases: ['watch', 'follow', '추적'], label: '감시 목록에 추가/해제', hint: '감시 2-14', icon: 'icon-detected', arg: 'id', run: (a) => toast(toggleWatch(a) ? `${a} 감시 시작` : `${a} 감시 해제`) },
  { word: '길드', aliases: ['guild'], label: '길드 보기', hint: '길드 0-5', icon: 'icon-guild', arg: 'id', run: (a) => go(a ? `/guild?id=${a}` : '/guild') },
  { word: '모의전', aliases: ['sim', 'simulator', 'battle', '전투'], label: '전투 시뮬레이터', hint: '시뮬 1-9', icon: 'icon-combat-log', arg: 'player', run: (a) => go(a ? `/sim?vs=${pidArg(a)}` : '/sim') },
  { word: '기지', aliases: ['base', 'status', '현황'], label: '내 기지 현황 공유', hint: '기지', icon: 'icon-cmd-post', arg: 'none', run: async () => { const pid = session.playerId; const s = pid ? await baseSituation(pid) : null; if (s) share({ kind: 'situation', s }); else toast('로그인이 필요합니다.'); } },
  { word: '복제', aliases: ['replicate', 'clone', 'replicants', 'armada', '레플리칸트'], label: '레플리칸트 · 복제', hint: '복제', icon: 'icon-member', arg: 'none', run: () => go('/replicants') },
  { word: '회수', aliases: ['sweep'], label: '레플리칸트 알파 회수', hint: '회수', icon: 'icon-incoming', arg: 'none', run: () => go('/replicants') },
  { word: '규칙', aliases: ['orders', 'doctrine', 'policy', '자동'], label: '복무 규칙 · 자동화', hint: '규칙', icon: 'icon-computer', arg: 'none', run: () => go('/replicants?tab=orders') },
  { word: '시장', aliases: ['market', 'mkt', 'offers', '구매'], label: '전력 시장', hint: '시장', icon: 'icon-transfers', arg: 'none', run: () => go('/market') },
  { word: '은행', aliases: ['bank', 'mint', 'redeem', 'gt', '화폐'], label: '길드 은행 · 화폐 교환', hint: '은행', icon: 'icon-guild-directory', arg: 'none', run: () => go('/market?tab=bank') },
  { word: '자산', aliases: ['지갑', 'wallet', 'inventory', '잔액'], label: '내 보유품', hint: '보유품', icon: 'icon-key', arg: 'none', run: () => go('/market?tab=wallet') },
  { word: '계약', aliases: ['book', 'agreements', 'contracts'], label: '내 전력 계약', hint: '계약', icon: 'icon-transfers', arg: 'none', run: () => go('/market?tab=mine') },
  { word: '통계', aliases: ['stats', 'universe', 'galaxy stats', '랭킹', 'leaderboard'], label: '은하 통계 · 랭킹', hint: '통계', icon: 'icon-combat-log', arg: 'none', run: () => go('/stats') },
  { word: '표적', aliases: ['targets', 'war', 'raid', 'scout', '상황실', '정찰'], label: '작전 상황실 · 표적', hint: '표적', icon: 'icon-raid', arg: 'none', run: () => go('/war') },
  { word: '원한', aliases: ['grudges', 'vetoes', '금지'], label: '원한 · 공격 금지 목록', hint: '원한', icon: 'icon-blocked', arg: 'none', run: () => go('/war?tab=lists') },
  { word: '보드', aliases: ['board', 'terminal', 'workspace', 'dashboard', '터미널', '대시보드'], label: '작전 보드 (내 카드 콘솔)', hint: '보드', icon: 'icon-computer', arg: 'none', run: () => go('/board') },
  { word: '가입', aliases: ['join', 'apply', 'requests', '신청'], label: '길드 가입 신청 · 초대', hint: '가입', icon: 'icon-member', arg: 'none', run: () => go('/guild?tab=apps') },
  { word: '검색', aliases: ['find', 'search'], label: '통신 메시지 검색', hint: '검색 습격', icon: 'icon-detected', arg: 'text', run: (a) => go(`/chat?search=${encodeURIComponent(a)}`) },
  { word: '소리', aliases: ['sound', 'sounds', 'sfx', 'audio', '음량', '효과음'], label: '소리 설정 (음량 · 효과음 · 내 파일)', hint: '소리', icon: 'icon-tip', arg: 'none', run: () => void import('./sound').then((m) => m.openSoundSettings()) },
  { word: '진단', aliases: ['diag', 'debug', 'health', 'status', '상태', '디버그'], label: '시스템 진단 (연결 · 엔진)', hint: '진단', icon: 'icon-computer', arg: 'none', run: () => go('/diag') },
  { word: '도움말', aliases: ['help', '?', 'commands', '명령어'], label: '명령어 목록', hint: '도움말', icon: 'icon-tip', arg: 'none', run: () => undefined },
];

import { matches } from '../core/hangul';

interface Item { label: string; hint: string; icon: string; key?: string; run: () => void | Promise<void> }

function itemsFor(q: string): Item[] {
  const words = q.trim().split(/\s+/).filter(Boolean);
  const out: Item[] = [];
  if (!words.length) {
    for (const w of watchlist().slice(0, 5)) out.push({ label: `${entityOf(w)} ${w}`, hint: '감시 중', icon: 'icon-detected', run: () => go(`/o/${w}`) });
    for (const k of NAV_KEYS) out.push({ label: k.label, hint: '화면', icon: 'icon-arrow', key: k.key.toUpperCase(), run: () => go(k.path) });
    for (const v of VERBS.filter((x) => x.arg !== 'none').slice(0, 6)) out.push({ label: v.label, hint: v.hint, icon: v.icon, run: () => undefined });
    return out;
  }
  // `id WORD` / `WORD id` / bare id.
  const idAt = words.findIndex((w) => isRefId(w) || /^\d{1,2}-\d{1,9}$/.test(w));
  const id = idAt >= 0 ? words[idAt] : null;
  const rest = words.filter((_, i) => i !== idAt);
  const word = rest[0]?.toLowerCase() ?? '';
  const verb = VERBS.find((v) => v.word === word || v.aliases.includes(word));
  if (id && verb) out.push({ label: `${verb.label} · ${id}`, hint: entityOf(id), icon: verb.icon, run: () => verb.run(id, rest.slice(1)) });
  else if (verb && verb.arg !== 'none' && rest.length > 1) out.push({ label: `${verb.label} · ${rest.slice(1).join(' ')}`, hint: verb.hint, icon: verb.icon, run: () => verb.run(rest[1], rest.slice(2)) });
  else if (verb) out.push({ label: verb.label, hint: verb.hint, icon: verb.icon, run: () => verb.run('', []) });
  if (id && !verb && REF_KINDS[id.split('-')[0]]) {
    out.push({ label: `${entityOf(id)} ${id} 열기`, hint: '카드', icon: 'icon-info', run: () => go(`/o/${id}`) });
    out.push({ label: `${id} 공유`, hint: '공유', icon: 'icon-link-out', run: () => share({ kind: 'object', id }) });
    if (id.startsWith('1-')) { out.push({ label: `${id}에게 알파 보내기`, hint: '보내기', icon: 'icon-send-alpha', run: () => void openTransfer({ to: id, amount: Number(rest[0]) || undefined }) }); out.push({ label: `${id}에게 메시지`, hint: '메시지', icon: 'icon-phone', run: () => go(`/chat?dm=${id}`) }); }
    out.push({ label: `${id} 감시`, hint: '감시', icon: 'icon-detected', run: () => { toast(toggleWatch(id) ? `${id} 감시 시작` : `${id} 감시 해제`); } });
  }
  const q2 = q.trim();
  const scored: [number, Item][] = [];
  for (const k of NAV_KEYS) { const s = matches(k.label, q2); if (s) scored.push([s, { label: k.label, hint: '화면', icon: 'icon-arrow', key: k.key.toUpperCase(), run: () => go(k.path) }]); }
  for (const v of VERBS) { const s = Math.max(matches(v.word, q2), matches(v.label, q2), ...v.aliases.map((a) => matches(a, q2))); if (s && v !== verb) scored.push([s - 0.5, { label: v.label, hint: v.hint, icon: v.icon, run: () => v.run('', []) }]); }
  for (const r of matrix.rooms.values()) { const s = matches(r.name, q2.replace(/^#/, '')); if (s) scored.push([s - 1, { label: `${r.direct ? '@' : '#'}${r.name.replace(/^#/, '')}`, hint: '대화방', icon: 'icon-phone', run: () => go(`/chat?room=${encodeURIComponent(r.alias ?? r.id)}`) }]); }
  out.push(...scored.sort((a, b) => b[0] - a[0]).map(([, i]) => i));
  // Commanders by name (from the last search, filled in as you type).
  for (const p of found.filter((x) => matches(x.username, q2))) out.push({ label: `${p.username} · ${p.id}`, hint: '사령관', icon: 'icon-member', run: () => go(`/o/${p.id}`) });
  return out.slice(0, 12);
}
let found: { id: string; username: string }[] = [];
let searchT = 0, lastQ = '';
/** Names are looked up as you type (debounced), then the list repaints. */
function searchPlayers(q: string, again: () => void) {
  const t = q.trim();
  if (t.length < 2 || /^\d|^[ㄱ-ㅎ]+$/.test(t) || t === lastQ) return;
  clearTimeout(searchT);
  searchT = window.setTimeout(() => { lastQ = t; void guildApi.playerSearch(t).then((r) => { found = r.slice(0, 6); again(); }).catch(() => null); }, 300);
}

let el: HTMLElement | null = null;
export function openPalette(initial = '') {
  if (el) { close(); return; }
  sfx.play('click');
  el = document.createElement('div');
  el.className = 'palette-back';
  el.innerHTML = `<div class="palette" role="dialog" aria-label="명령 팔레트"><div class="palette-in"><span class="palette-k">⌘K</span><input class="palette-q" aria-label="명령 또는 ID" placeholder="ID, 화면, 명령… (예: 2-14 · 보내기 1-7 5 · ㄱㄹㅅ)" autocomplete="off" spellcheck="false"></div><ul class="palette-list" role="listbox"></ul><p class="palette-foot">↑↓ 이동 · Enter 실행 · Tab 완성 · Esc 닫기 · <a href="${href('/codex')}">명령어 도움말</a></p></div>`;
  document.body.appendChild(el);
  const input = el.querySelector<HTMLInputElement>('.palette-q')!, list = el.querySelector<HTMLElement>('.palette-list')!;
  let items: Item[] = [], at = 0;
  const paint = () => {
    items = itemsFor(input.value);
    if (/^(도움말|help|\?|명령어)$/i.test(input.value.trim())) items = VERBS.map((v) => ({ label: `${v.word} · ${v.label}`, hint: v.hint, icon: v.icon, run: () => { input.value = v.word + ' '; paint(); input.focus(); } }));
    at = Math.min(at, Math.max(0, items.length - 1));
    list.innerHTML = items.length ? items.map((it, i) => `<li role="option" aria-selected="${i === at}" class="${i === at ? 'on' : ''}" data-i="${i}"><i class="si ${it.icon}"></i><b>${esc(it.label)}</b><small>${esc(it.hint)}</small>${it.key ? `<kbd>${esc(it.key)}</kbd>` : ''}</li>`).join('') : '<li class="none">맞는 명령이 없습니다. <b>도움말</b>을 입력해 보세요.</li>';
  };
  const run = (i: number) => { const it = items[i]; if (!it) return; close(); void it.run(); };
  input.addEventListener('input', () => { at = 0; paint(); if (session.status.state === 'in') searchPlayers(input.value, paint); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); at = Math.min(items.length - 1, at + 1); paint(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); at = Math.max(0, at - 1); paint(); }
    else if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); run(at); }
    else if (e.key === 'Tab') { e.preventDefault(); const it = items[at]; if (it) { const w = VERBS.find((v) => it.label.startsWith(v.label) || it.label.startsWith(v.word)); if (w) { input.value = w.word + ' '; paint(); } } }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
  });
  list.addEventListener('click', (e) => { const li = (e.target as HTMLElement).closest<HTMLElement>('li[data-i]'); if (li) run(Number(li.dataset.i)); });
  el.addEventListener('mousedown', (e) => { if (e.target === el) close(); });
  input.value = initial;
  paint();
  input.focus();
}
function close() { el?.remove(); el = null; }

export function installPalette() {
  addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === 'k') {
      // 통신 keeps Ctrl-K for its own channel jump.
      if (document.documentElement.dataset.route === 'chat' && !el) return;
      if (document.querySelector('.sheet-back')) return;
      e.preventDefault(); e.stopPropagation();
      openPalette();
    }
  }, true);
}
