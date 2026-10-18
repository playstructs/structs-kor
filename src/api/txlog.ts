/* 거래 기록: every transaction this tab sent, followed until a block includes it. A broadcast that
 * passes the mempool can still fail when the block runs it; that failure is told, not swallowed.
 * After structs-universe's Transactions view (signing queue snapshot). */
export type TxStatus = 'pending' | 'ok' | 'failed' | 'unknown' | 'refused';
export interface TxEntry { hash: string; name: string; signer: number; at: number; status: TxStatus; height?: number; error?: string }

const log: TxEntry[] = [];
let fns: (() => void)[] = [];
export const txLog = () => log;
export const onTx = (f: () => void) => { fns.push(f); return () => { fns = fns.filter((x) => x !== f); }; };
const emit = () => { for (const f of fns) { try { f(); } catch { /* a listener's problem */ } } };
let failFns: ((e: TxEntry) => void)[] = [];
/** Told when an included transaction failed on chain. */
export const onTxFailed = (f: (e: TxEntry) => void) => { failFns.push(f); };

export function noteRefused(name: string, signer: number, error: string) {
  log.unshift({ hash: '', name, signer, at: Date.now(), status: 'refused', error });
  log.splice(60); emit();
}

/** Record a broadcast and poll for its result (every 6 s, about two minutes). */
export function track(hash: string, name: string, signer: number, result: (hash: string) => Promise<{ code: number; height: string; raw_log?: string } | null>) {
  const e: TxEntry = { hash, name, signer, at: Date.now(), status: 'pending' };
  log.unshift(e); log.splice(60); emit();
  let tries = 0;
  const poll = () => {
    tries++;
    void result(hash).then((r) => {
      if (r) {
        e.height = Number(r.height) || undefined;
        e.status = r.code ? 'failed' : 'ok';
        if (r.code) { e.error = r.raw_log || `코드 ${r.code}`; for (const f of failFns) f(e); }
        emit();
      } else if (tries < 20) setTimeout(poll, 6000);
      else { e.status = 'unknown'; emit(); }
    }).catch(() => { if (tries < 20) setTimeout(poll, 6000); else { e.status = 'unknown'; emit(); } });
  };
  setTimeout(poll, 6000);
}
