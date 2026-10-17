/* The wallet: one recovery phrase, sealed in this browser (vault.ts), opened into memory to sign.
 * Index 0 is the commander; 1+ are replicants (structs-ai: m/44'/118'/0'/0/i).
 *
 * The site signs exactly two things today:
 *   - the guild sign-in message (opens the Guild API session: src/api/session.ts)
 *   - chain transactions (game actions) — see src/api/actions.ts for how those are routed. */
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { deriveKey, isValidMnemonic, newMnemonic, normaliseMnemonic, toHex, type KeyPair } from './keys';
import { openDevice, openPhrase, readVault, sealDevice, sealPhrase, writeVault, type VaultAccount } from './vault';
import { dropDeviceKey, newDeviceKey, readDeviceKey } from './devicekey';
import { insecurePage } from './secure';

export type WalletState = 'empty' | 'locked' | 'unlocked';
type Fn = () => void;

class Wallet {
  private phrase: string | null = null;
  private keys = new Map<number, KeyPair>();
  private fns = new Set<Fn>();

  get state(): WalletState { return this.phrase ? 'unlocked' : readVault() ? 'locked' : 'empty'; }
  get accounts(): VaultAccount[] { return readVault()?.accounts ?? []; }
  get commander(): VaultAccount | undefined { return this.accounts.find((a) => a.index === 0); }

  onChange(f: Fn) { this.fns.add(f); return () => this.fns.delete(f); }
  private emit() { for (const f of this.fns) { try { f(); } catch (e) { console.error(e); } } }

  /** Sealed by this browser's device key (automatic enlist) rather than a passphrase. */
  get deviceSealed(): boolean { return readVault()?.mode === 'device'; }

  /** Automatic enlist: a fresh 24-word phrase sealed by the device key, open at once. Nothing to type. */
  async createDevice() {
    const bad = insecurePage();
    if (bad) throw new Error(bad);
    const m = newMnemonic(24);
    const k = deriveKey(m, 0);
    const accounts: VaultAccount[] = [{ index: 0, address: k.address, label: '사령관', role: 'primary', createdAt: Date.now() }];
    const { id, key } = await newDeviceKey();
    writeVault(await sealDevice(m, key, id, accounts));
    this.phrase = m;
    this.keys.clear();
    this.emit();
  }

  /** On load: a device vault opens itself; a passphrase vault stays locked. */
  async restore() {
    const v = readVault();
    if (this.phrase || !v || v.mode !== 'device') return;
    const key = await readDeviceKey(v.keyId ?? 'vault').catch(() => null);
    if (!key) return;
    this.phrase = await openDevice(v, key).catch(() => null);
    if (this.phrase) this.emit();
  }

  /** Import (or create) a phrase and seal it with a passphrase. */
  async importPhrase(mnemonic: string, passphrase: string) {
    const bad = insecurePage();
    if (bad) throw new Error(bad);
    const m = normaliseMnemonic(mnemonic);
    if (!isValidMnemonic(m)) throw new Error('올바른 복구 문구가 아닙니다 (BIP-39 12/24단어).');
    if (passphrase.length < 8) throw new Error('잠금 비밀번호는 8자 이상이어야 합니다.');
    const k = deriveKey(m, 0);
    const accounts: VaultAccount[] = [{ index: 0, address: k.address, label: '사령관', role: 'primary', createdAt: Date.now() }];
    writeVault(await sealPhrase(m, passphrase, accounts));
    this.phrase = m;
    this.keys.clear();
    this.emit();
  }

  async unlock(passphrase: string) {
    const v = readVault();
    if (!v) throw new Error('이 브라우저에 저장된 지갑이 없습니다.');
    this.phrase = await openPhrase(v, passphrase).catch(() => { throw new Error('비밀번호가 틀렸습니다.'); });
    this.keys.clear();
    this.emit();
  }

  /** The phrase itself, for 내 정보 › 복구 문구 보기. A passphrase vault asks the passphrase again,
   * even when unlocked; a device vault has none to ask. */
  async revealPhrase(passphrase = ''): Promise<string> {
    const v = readVault();
    if (!v) throw new Error('이 브라우저에 저장된 지갑이 없습니다.');
    let phrase: string;
    if (v.mode === 'device') { await this.restore(); if (!this.phrase) throw new Error('이 브라우저의 기기 키를 찾을 수 없습니다.'); phrase = this.phrase; }
    else phrase = await openPhrase(v, passphrase).catch(() => { throw new Error('비밀번호가 틀렸습니다.'); });
    writeVault({ ...v, backedUpAt: Date.now() });
    this.emit();
    return phrase;
  }

  get backedUp(): boolean { return !!readVault()?.backedUpAt; }

  /** A device vault has nothing to unlock with, so it stays open. */
  lock() { if (this.deviceSealed) return; this.phrase = null; this.keys.clear(); this.emit(); }
  forget() {
    const keyId = readVault()?.keyId;
    this.phrase = null; this.keys.clear(); writeVault(null);
    void dropDeviceKey(keyId);
    this.emit();
  }

  key(index = 0): KeyPair {
    if (!this.phrase) throw new Error('지갑이 잠겨 있습니다.');
    let k = this.keys.get(index);
    if (!k) { k = deriveKey(this.phrase, index); this.keys.set(index, k); }
    return k;
  }

  /** The guild sign-in signature: secp256k1 over sha256(message), 65 bytes r‖s‖v, hex. */
  signMessage(index: number, message: string): { address: string; pubkey: string; signature: string } {
    const k = this.key(index);
    const digest = sha256(new TextEncoder().encode(message));
    const rec = secp256k1.sign(digest, k.privKey, { prehash: false, lowS: true, format: 'recovered' });
    const fixed = new Uint8Array(65);
    fixed.set(rec.subarray(1, 65), 0);
    fixed[64] = rec[0];
    return { address: k.address, pubkey: toHex(k.pubKey), signature: toHex(fixed) };
  }

  setPlayerId(index: number, playerId: string) {
    const v = readVault();
    if (!v) return;
    v.accounts = v.accounts.map((a) => (a.index === index ? { ...a, playerId } : a));
    writeVault(v);
    this.emit();
  }
}

export const wallet = new Wallet();
