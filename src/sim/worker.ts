/// <reference lib="webworker" />
import type { CityPack, Network, SimResult } from '../model/types';
import { createSimContext, simulate, type SimContext } from './simulate';

export type WorkerRequest =
  | { type: 'init'; pack: CityPack }
  | { type: 'simulate'; network: Network; seq: number };

export type WorkerResponse =
  | { type: 'ready' }
  | { type: 'result'; result: SimResult; seq: number }
  | { type: 'error'; message: string; seq?: number };

let ctx: SimContext | null = null;

self.onmessage = (ev: MessageEvent<WorkerRequest>) => {
  const msg = ev.data;
  try {
    if (msg.type === 'init') {
      // createSimContext 會算好與路網無關的部分（距離、基準壅塞速度），
      // 之後每次改線都重用，不再重算。
      ctx = createSimContext(msg.pack);
      post({ type: 'ready' });
      return;
    }

    if (msg.type === 'simulate') {
      if (!ctx) throw new Error('尚未初始化城市資料');
      const result = simulate(ctx, msg.network);
      post({ type: 'result', result, seq: msg.seq });
    }
  } catch (err) {
    post({
      type: 'error',
      message: err instanceof Error ? err.message : String(err),
      seq: msg.type === 'simulate' ? msg.seq : undefined,
    });
  }
};

function post(m: WorkerResponse) {
  (self as unknown as Worker).postMessage(m);
}
