/* Automatic onboarding: 지금 시작 → a commander in the guild, signed in, with nothing to type.
 *
 *   1. key       a fresh 24-word phrase, sealed by this browser's device key (no passphrase)
 *   2. register  POST /api/auth/signup, signed GUILD{g}ADDRESS{addr}NONCE0, with a random callsign
 *   3. chain     the guild joins the player on chain; poll /auth/player-address/…/player-id
 *   4. sign in   the guild session (src/api/session.ts)
 *
 * Every step is resumable: a reload mid-way picks up the same key and waits for the same player.
 * The phrase is never shown here; 내 정보 (/profile) reveals it later. */
import { GUILD_ID } from '../config';
import { wallet } from '../wallet/wallet';
import { guildApi } from './guild';
import { ApiError } from './http';
import { session } from './session';

export type EnlistStep = 'key' | 'register' | 'chain' | 'signin' | 'done';

const ADJ = ['Nova', 'Comet', 'Iron', 'Silent', 'Amber', 'Lunar', 'Solar', 'Cobalt', 'Hollow', 'Swift', 'Crimson', 'Azure'];
const NOUN = ['Falcon', 'Tiger', 'Crane', 'Otter', 'Magpie', 'Wolf', 'Heron', 'Lynx', 'Raven', 'Badger', 'Fox', 'Orca'];
/** The sign-up name stays Latin: the guild's username check counts bytes and may refuse Hangul
 * (REQ-I18N-2). The commander gets a Korean callsign on the chain right after (koreanCallsign). */
export function callsign(): string {
  const r = crypto.getRandomValues(new Uint32Array(3));
  return `${ADJ[r[0] % ADJ.length]}${NOUN[r[1] % NOUN.length]}-${(r[2] % 900) + 100}`;
}

const KADJ = ['은빛', '강철', '붉은', '푸른', '검은', '번개', '새벽', '황금', '서리', '불꽃', '고요한', '날쌘'];
const KNOUN = ['매', '범', '학', '늑대', '까치', '여우', '고래', '용', '독수리', '표범', '수리', '송골매'];
/** A Korean callsign the chain accepts (3–20 letters, digits, hyphens): 은빛매-141. */
export function koreanCallsign(): string {
  const r = crypto.getRandomValues(new Uint32Array(3));
  return `${KADJ[r[0] % KADJ.length]}${KNOUN[r[1] % KNOUN.length]}-${(r[2] % 900) + 100}`;
}
/** The Latin sign-up names this client gives (NovaFalcon-175): replaced by a Korean one on the chain. */
export const isSignupCallsign = (name: string) => /^[A-Z][a-z]+[A-Z][a-z]+-\d{3}$/.test(name);

const POLL_MS = 3000;
const WAIT_MS = 3 * 60_000;

export async function enlist(onStep: (s: EnlistStep) => void, signal: { stopped: boolean }): Promise<void> {
  onStep('key');
  if (wallet.state === 'empty') await wallet.createDevice();
  else if (wallet.state === 'locked') await wallet.restore();
  if (wallet.state !== 'unlocked') throw new Error('이 브라우저의 계정이 잠겨 있습니다. 로그인 화면에서 잠금을 해제하세요.');

  const k = wallet.key(0);
  let pid = wallet.commander?.playerId ?? (await guildApi.playerIdFor(k.address, GUILD_ID));

  if (!pid) {
    onStep('register');
    const s = wallet.signMessage(0, `GUILD${GUILD_ID}ADDRESS${k.address}NONCE0`);
    try {
      await guildApi.signup({ primary_address: k.address, signature: s.signature, pubkey: s.pubkey, guild_id: GUILD_ID, username: callsign() });
    } catch (e) {
      // 409: this address already asked to join (a reload mid-way). Just wait for it.
      if (!(e instanceof ApiError && e.status === 409)) throw e;
    }
    onStep('chain');
    const until = Date.now() + WAIT_MS;
    while (!pid && !signal.stopped && Date.now() < until) {
      await new Promise((r) => setTimeout(r, POLL_MS));
      pid = await guildApi.playerIdFor(k.address, GUILD_ID).catch(() => null);
    }
    if (signal.stopped) return;
    if (!pid) throw new Error('사령부 등록이 아직 끝나지 않았습니다. 잠시 후 다시 시도하세요.');
  }

  wallet.setPlayerId(0, pid);
  // Nothing to play without a planet: explore now, alongside signing in (game/settle.ts).
  void import('../game/settle').then((m) => m.settle(pid!));
  onStep('signin');
  await session.signIn();
  onStep('done');
}
