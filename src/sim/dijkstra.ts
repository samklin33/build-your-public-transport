import type { TransitGraph } from './graph';

/**
 * 可重複使用的 Dijkstra 求解器。
 *
 * 模擬時要從「每一個車站」各跑一次最短路徑，站數可能上百，
 * 因此緩衝區只配置一次並在每次求解時重設，避免反覆的記憶體配置與 GC。
 * 用扁平的 Int32/Float32 二元堆而非物件陣列，也是同樣的理由。
 */
export class Dijkstra {
  readonly dist: Float32Array;
  /** 抵達該節點所走的最後一條邊索引，-1 表示起點或未抵達。 */
  readonly prevEdge: Int32Array;

  private readonly heapNode: Int32Array;
  private readonly heapKey: Float32Array;
  private readonly posInHeap: Int32Array;
  private heapSize = 0;

  constructor(private readonly g: TransitGraph) {
    const n = g.nodeCount;
    this.dist = new Float32Array(n);
    this.prevEdge = new Int32Array(n);
    this.heapNode = new Int32Array(n);
    this.heapKey = new Float32Array(n);
    this.posInHeap = new Int32Array(n);
  }

  run(source: number): void {
    const { nodeStart, edgeHead, edgeCost } = this.g;
    const { dist, prevEdge, posInHeap } = this;

    dist.fill(Infinity);
    prevEdge.fill(-1);
    posInHeap.fill(-1);
    this.heapSize = 0;

    dist[source] = 0;
    this.push(source, 0);

    while (this.heapSize > 0) {
      const u = this.pop();
      const du = dist[u];
      if (du === Infinity) break;

      for (let e = nodeStart[u], end = nodeStart[u + 1]; e < end; e++) {
        const v = edgeHead[e];
        const nd = du + edgeCost[e];
        if (nd < dist[v]) {
          dist[v] = nd;
          prevEdge[v] = e;
          if (posInHeap[v] >= 0) this.decrease(v, nd);
          else this.push(v, nd);
        }
      }
    }
  }

  private push(node: number, key: number) {
    const i = this.heapSize++;
    this.heapNode[i] = node;
    this.heapKey[i] = key;
    this.posInHeap[node] = i;
    this.siftUp(i);
  }

  private pop(): number {
    const { heapNode, heapKey, posInHeap } = this;
    const top = heapNode[0];
    posInHeap[top] = -1;
    const last = --this.heapSize;
    if (last > 0) {
      heapNode[0] = heapNode[last];
      heapKey[0] = heapKey[last];
      posInHeap[heapNode[0]] = 0;
      this.siftDown(0);
    }
    return top;
  }

  private decrease(node: number, key: number) {
    const i = this.posInHeap[node];
    this.heapKey[i] = key;
    this.siftUp(i);
  }

  private siftUp(i: number) {
    const { heapNode, heapKey, posInHeap } = this;
    const node = heapNode[i];
    const key = heapKey[i];
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heapKey[p] <= key) break;
      heapNode[i] = heapNode[p];
      heapKey[i] = heapKey[p];
      posInHeap[heapNode[i]] = i;
      i = p;
    }
    heapNode[i] = node;
    heapKey[i] = key;
    posInHeap[node] = i;
  }

  private siftDown(i: number) {
    const { heapNode, heapKey, posInHeap, heapSize } = this;
    const node = heapNode[i];
    const key = heapKey[i];
    for (;;) {
      let c = 2 * i + 1;
      if (c >= heapSize) break;
      if (c + 1 < heapSize && heapKey[c + 1] < heapKey[c]) c++;
      if (heapKey[c] >= key) break;
      heapNode[i] = heapNode[c];
      heapKey[i] = heapKey[c];
      posInHeap[heapNode[i]] = i;
      i = c;
    }
    heapNode[i] = node;
    heapKey[i] = key;
    posInHeap[node] = i;
  }
}
