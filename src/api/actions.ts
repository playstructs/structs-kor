/* Game actions: Cosmos SDK transactions (SIGN_MODE_DIRECT), signed in the browser.
 *
 * The Guild API has no write path today, so the official webapp signs and broadcasts over the
 * chain's RPC. This site asks the Guild API first (REQ-TX-1/2/3: account sequence, broadcast,
 * result) so a player's browser only ever talks to their guild, and falls back to the chain's LCD.
 * Proto encoding: src/wallet/{proto,encode,schema.gen}.ts, from structs-xyz. */
import { endpoints } from '../config';
import { wallet } from '../wallet/wallet';
import { Writer, any, coin } from '../wallet/proto';
import { encodeAny, typeUrlOf, type Msg, type MsgValue } from '../wallet/encode';
import { signBytes, toB64, type KeyPair } from '../wallet/keys';
import { ApiError, MOCK, get, post } from './http';
import { fellBack, isMissing, markMissing } from './requirements';

const FEE = { amount: [{ denom: 'ualpha', amount: '0' }], gas: 500_000 };

async function viaGuild<T>(req: string, run: () => Promise<T>, fallback: () => Promise<T>): Promise<T> {
  if (!isMissing(req)) {
    try { return await run(); } catch (e) { if (!(e instanceof ApiError) || e.code !== 'missing') throw e; markMissing(req); }
  }
  fellBack(req);
  return fallback();
}

async function lcd<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(endpoints.lcd + path, init);
  const body = await r.json().catch(() => null);
  if (!r.ok) throw new Error(body?.message || `LCD ${r.status}`);
  return body as T;
}

let chainIdP: Promise<string> | null = null;
// A failed lookup isn't remembered: the next call tries again.
const chainId = () => (chainIdP ??= lcd<{ default_node_info: { network: string } }>('/cosmos/base/tendermint/v1beta1/node_info').then((r) => r.default_node_info.network).catch((e) => { chainIdP = null; throw e; }));

interface Account { account_number: string; sequence: string }
const account = (address: string) => viaGuild<Account>('REQ-TX-1',
  () => get<Account>(`account/${address}`),
  async () => { const r = await lcd<{ account: Account & { base_account?: Account } }>(`/cosmos/auth/v1beta1/accounts/${address}`); return r.account.base_account || r.account; });

const broadcastBytes = (tx: Uint8Array) => viaGuild<{ txhash: string; code: number; raw_log: string }>('REQ-TX-2',
  () => post('tx/broadcast', { tx_bytes: toB64(tx) }),
  async () => (await lcd<{ tx_response: { txhash: string; code: number; raw_log: string } }>('/cosmos/tx/v1beta1/txs', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tx_bytes: toB64(tx), mode: 'BROADCAST_MODE_SYNC' }),
  })).tx_response);

export const txResult = (hash: string) => viaGuild<{ code: number; height: string } | null>('REQ-TX-3',
  () => get(`tx/${hash}`),
  async () => (await lcd<{ tx_response: { code: number; height: string } }>(`/cosmos/tx/v1beta1/txs/${hash}`).catch(() => null))?.tx_response ?? null);

function signTx(key: KeyPair, msgs: Msg[], chain: string, acc: Account): Uint8Array {
  const body = new Writer();
  for (const m of msgs) body.msg(1, encodeAny(m), true);
  const bodyBytes = body.finish();
  const pk = any('/cosmos.crypto.secp256k1.PubKey', new Writer().bytes(1, key.pubKey).finish());
  const signerInfo = new Writer().msg(1, pk).msg(2, new Writer().msg(1, new Writer().uint(1, 1), true), true).uint(3, BigInt(acc.sequence));
  const fee = new Writer();
  for (const c of FEE.amount) fee.msg(1, coin(c), true);
  fee.uint(2, FEE.gas);
  const auth = new Writer().msg(1, signerInfo, true).msg(2, fee, true).finish();
  const doc = new Writer().bytes(1, bodyBytes).bytes(2, auth).string(3, chain).uint(4, BigInt(acc.account_number)).finish();
  const sig = signBytes(key.privKey, doc);
  const raw = new Writer().bytes(1, bodyBytes).bytes(2, auth);
  raw.bytes(3, sig);
  return raw.finish();
}

/* Transactions go out one at a time, and each signer's sequence is tracked here as well: the
 * account read can lag a just-accepted tx, and two signed with the same sequence lose one. */
let queue: Promise<unknown> = Promise.resolve();
const nextSeq = new Map<string, bigint>();
/** True when the chain refused a tx for its sequence (not for the move itself). */
export const isSequenceError = (e: unknown) => /account sequence mismatch|incorrect account sequence/i.test((e as Error)?.message ?? '');

/** Sign and broadcast one Structs message as the commander (or a replicant by HD index). */
export function act(name: string, value: MsgValue, index = 0): Promise<string> {
  const run = queue.then(() => send(name, value, index));
  queue = run.catch(() => null);
  return run;
}
async function send(name: string, value: MsgValue, index: number): Promise<string> {
  // The dev mock is a pretend guild: nothing it shows may be signed against the real chain.
  if (MOCK) throw new Error('모의 모드: 체인 거래는 보내지 않습니다');
  const key = wallet.key(index);
  const [chain, fetched] = await Promise.all([chainId(), account(key.address)]);
  const local = nextSeq.get(key.address);
  const seq = local !== undefined && local > BigInt(fetched.sequence) ? local : BigInt(fetched.sequence);
  const r = await broadcastBytes(signTx(key, [{ typeUrl: typeUrlOf(name), value: { creator: key.address, ...value } }], chain, { ...fetched, sequence: String(seq) }));
  // A refusal at broadcast (sync mode) consumed no sequence: trust the chain's count next time.
  if (r.code) { nextSeq.delete(key.address); throw new Error(r.raw_log || `체인 오류 ${r.code}`); }
  nextSeq.set(key.address, seq + 1n);
  return r.txhash;
}

/** A dry run: sign the message as the commander would and ask the chain's LCD to simulate it. Nothing is
 * broadcast, no sequence is used, no fee is paid. A pass proves the transaction decodes, the account
 * and sequence line up and the message's own checks pass. Simulation does NOT verify the signature
 * (the SDK skips that), so only a real broadcast proves signing. Each step is reported to `step`. */
export async function simulate(name: string, value: MsgValue, step: (what: string, detail: string) => void, index = 0): Promise<{ gasUsed: string }> {
  if (MOCK) throw new Error('모의 모드에서는 체인 점검을 하지 않습니다');
  const key = wallet.key(index);
  const chain = await chainId(); step('체인', chain);
  const fetched = await account(key.address);
  // The same sequence a real send would use (a move sent moments ago may not show in the read yet).
  const local = nextSeq.get(key.address);
  const acc = { ...fetched, sequence: String(local !== undefined && local > BigInt(fetched.sequence) ? local : BigInt(fetched.sequence)) };
  step('계정', `번호 ${acc.account_number} · 순번 ${acc.sequence}`);
  const tx = signTx(key, [{ typeUrl: typeUrlOf(name), value: { creator: key.address, ...value } }], chain, acc); step('서명', `${name} · ${tx.length}바이트`);
  const r = await lcd<{ gas_info?: { gas_used: string } }>('/cosmos/tx/v1beta1/simulate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tx_bytes: toB64(tx) }) });
  return { gasUsed: r.gas_info?.gas_used ?? '?' };
}

export const actions = {
  structActivate: (structId: string) => act('MsgStructActivate', { structId }),
  structDeactivate: (structId: string) => act('MsgStructDeactivate', { structId }),
  /** Fire one struct's weapon at another (raids and defense). */
  attack: (operatingStructId: string, targetStructId: string, weaponSystem: 'primaryWeapon' | 'secondaryWeapon' = 'primaryWeapon') =>
    act('MsgStructAttack', { operatingStructId, targetStructId: [targetStructId], weaponSystem }),
  /** Order one struct to guard another (it blocks shots at its ward and counter-fires), or stand down. */
  defenseSet: (defenderStructId: string, protectedStructId: string) => act('MsgStructDefenseSet', { defenderStructId, protectedStructId }),
  defenseClear: (defenderStructId: string) => act('MsgStructDefenseClear', { defenderStructId }),
  /** Send the fleet to another planet (a raid starts on arrival) or home. */
  fleetMove: (fleetId: string, destinationLocationId: string) => act('MsgFleetMove', { fleetId, destinationLocationId }),
  /** Start a build in a planet or fleet slot; the proof that finishes it is hashed by src/pow. */
  structBuild: (playerId: string, structTypeId: number, ambit: string, slot: number) =>
    act('MsgStructBuildInitiate', { playerId, structTypeId: String(structTypeId), operatingAmbit: ambit, slot: String(slot) }),
  /** capacity in mW, duration in blocks; the whole capacity × rate × duration is escrowed now. */
  agreementOpen: (providerId: string, capacity: number, duration: number) => act('MsgAgreementOpen', { providerId, capacity: String(capacity), duration: String(duration) }),
  agreementClose: (agreementId: string) => act('MsgAgreementClose', { agreementId }),
  agreementExtend: (agreementId: string, blocks: number) => act('MsgAgreementDurationIncrease', { agreementId, durationIncrease: String(blocks) }),
  providerCreate: (p: { substationId: string; rate: { denom: string; amount: string }; accessPolicy: 'openMarket' | 'guildMarket' | 'closedMarket'; capacityMinimum: number; capacityMaximum: number; durationMinimum: number; durationMaximum: number; providerCancellationPenalty: string; consumerCancellationPenalty: string }) =>
    act('MsgProviderCreate', { ...p, capacityMinimum: String(p.capacityMinimum), capacityMaximum: String(p.capacityMaximum), durationMinimum: String(p.durationMinimum), durationMaximum: String(p.durationMaximum) }),
  providerWithdraw: (providerId: string, destinationAddress: string) => act('MsgProviderWithdrawBalance', { providerId, destinationAddress }),
  providerDelete: (providerId: string) => act('MsgProviderDelete', { providerId }),
  providerAccess: (providerId: string, accessPolicy: 'openMarket' | 'guildMarket' | 'closedMarket') => act('MsgProviderUpdateAccessPolicy', { providerId, accessPolicy }),
  agreementCapacity: (agreementId: string, delta: number) => delta >= 0
    ? act('MsgAgreementCapacityIncrease', { agreementId, capacityIncrease: String(delta) })
    : act('MsgAgreementCapacityDecrease', { agreementId, capacityDecrease: String(-delta) }),

  /** Send alpha (ualpha) or a guild token from one of this wallet's accounts to any address. */
  playerSend: (toAddress: string, amount: { denom: string; amount: string }, index = 0) =>
    act('MsgPlayerSend', { from_address: wallet.key(index).address, to_address: toAddress, amount }, index),
  playerName: (playerId: string, name: string, index = 0) => act('MsgPlayerUpdateName', { playerId, name }, index),
  playerPfp: (playerId: string, pfp: string, index = 0) => act('MsgPlayerUpdatePfp', { playerId, pfp }, index),
  planetName: (planetId: string, name: string) => act('MsgPlanetUpdateName', { planetId, name }),

  /* Guild membership: a request waits for an officer; a join goes straight in when the guild allows it. */
  guildRequest: (guildId: string, playerId: string, substationId = '', index = 0) => act('MsgGuildMembershipRequest', { guildId, playerId, substationId }, index),
  guildRequestRevoke: (guildId: string, playerId: string) => act('MsgGuildMembershipRequestRevoke', { guildId, playerId }),
  guildRequestApprove: (guildId: string, playerId: string, substationId = '') => act('MsgGuildMembershipRequestApprove', { guildId, playerId, substationId }),
  guildRequestDeny: (guildId: string, playerId: string) => act('MsgGuildMembershipRequestDeny', { guildId, playerId }),
  guildInvite: (guildId: string, playerId: string, substationId = '') => act('MsgGuildMembershipInvite', { guildId, playerId, substationId }),
  guildInviteRevoke: (guildId: string, playerId: string) => act('MsgGuildMembershipInviteRevoke', { guildId, playerId }),
  guildInviteApprove: (guildId: string, playerId: string, substationId = '') => act('MsgGuildMembershipInviteApprove', { guildId, playerId, substationId }),
  guildInviteDeny: (guildId: string, playerId: string) => act('MsgGuildMembershipInviteDeny', { guildId, playerId }),
  guildKick: (guildId: string, playerId: string) => act('MsgGuildMembershipKick', { guildId, playerId }),
  guildRank: (guildId: string, playerId: string, guildRank: number) => act('MsgPlayerUpdateGuildRank', { guildId, playerId, guildRank: String(guildRank) }),
  guildEntryRank: (guildId: string, newEntryRank: number) => act('MsgGuildUpdateEntryRank', { guildId, newEntryRank: String(newEntryRank) }),
  guildName: (guildId: string, name: string) => act('MsgGuildUpdateName', { guildId, name }),
  guildEndpoint: (guildId: string, endpoint: string) => act('MsgGuildUpdateEndpoint', { guildId, endpoint }),
  guildEntrySubstation: (guildId: string, entrySubstationId: string) => act('MsgGuildUpdateEntrySubstationId', { guildId, entrySubstationId }),
  guildJoinMinimum: (guildId: string, joinInfusionMinimum: number) => act('MsgGuildUpdateJoinInfusionMinimum', { guildId, joinInfusionMinimum: String(joinInfusionMinimum) }),
  /** Guild bank: lock alpha as collateral and mint the guild's token, or burn tokens for alpha back. */
  bankMint: (guildId: string, amountAlpha: number, amountToken: number) => act('MsgGuildBankMint', { guildId, amountAlpha: String(amountAlpha), amountToken: String(amountToken) }),
  bankRedeem: (denom: string, amountToken: number, minAmountAlpha = 0) => act('MsgGuildBankRedeem', { amountToken: { denom, amount: String(amountToken) }, minAmountAlpha: String(minAmountAlpha) }),
  bankConvert: (guildId: string, amountAlpha: number, minAmountToken = 0) => act('MsgGuildBankConvert', { guildId, amountAlpha: String(amountAlpha), minAmountToken: String(minAmountToken) }),

  /* Reactors: stake alpha for energy (infuse), take it back (defuse, which takes time). */
  reactorInfuse: (validatorAddress: string, ualpha: number, index = 0) => act('MsgReactorInfuse', { delegator_address: wallet.key(index).address, validator_address: validatorAddress, amount: { denom: 'ualpha', amount: String(ualpha) } }, index),
  reactorDefuse: (validatorAddress: string, ualpha: number, index = 0) => act('MsgReactorDefuse', { delegator_address: wallet.key(index).address, validator_address: validatorAddress, amount: { denom: 'ualpha', amount: String(ualpha) } }, index),
  substationConnect: (substationId: string, playerId: string, index = 0) => act('MsgSubstationPlayerConnect', { substationId, playerId }, index),
  /* Distribution: allocations carry power from a source (player, reactor, generator) to a substation.
   * controller: optional player id that may manage it (blank: the creator). Automated: one per source. */
  allocationCreate: (sourceObjectId: string, allocationType: 'static' | 'dynamic' | 'automated', power: number, controller = '') =>
    act('MsgAllocationCreate', { controller, sourceObjectId, allocationType, power: String(power) }),
  allocationUpdate: (allocationId: string, power: number) => act('MsgAllocationUpdate', { allocationId, power: String(power) }),
  allocationDelete: (allocationId: string) => act('MsgAllocationDelete', { allocationId }),
  allocationConnect: (allocationId: string, destinationId: string) => act('MsgSubstationAllocationConnect', { allocationId, destinationId }),
  allocationDisconnect: (allocationId: string) => act('MsgSubstationAllocationDisconnect', { allocationId }),
  substationCreate: (owner: string, allocationId: string) => act('MsgSubstationCreate', { owner, allocationId }),
  substationName: (substationId: string, name: string) => act('MsgSubstationUpdateName', { substationId, name }),
  stealth: (structId: string, on: boolean) => act(on ? 'MsgStructStealthActivate' : 'MsgStructStealthDeactivate', { structId }),
};

export { BLOCKS_PER_DAY } from './rates';
