/* Block time from the chain itself, so build waits and per-day prices match the real pace. */
import { chainread } from '../api/chainread';
import { MOCK } from '../api/http';
import { setBlockSeconds } from './work';

export function measureBlockTime() {
  if (MOCK) return;
  void chainread.blockSeconds().then(setBlockSeconds).catch(() => null);
}
