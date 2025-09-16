// src/searcher/priorityQueue.ts
export enum Priority {
  EMERGENCY = 10,
  HIGH = 8,
  MEDIUM = 5,
  LOW = 2,
}

type Task<T> = { p: Priority; run: () => Promise<T>; resolve: (v: T) => void; reject: (e: any) => void; };

export class PriorityQueue {
  private q: Task<any>[] = [];
  private active = 0;
  constructor(private maxConcurrent = 5) {}

  add<T>(p: Priority, run: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.q.push({ p, run, resolve, reject });
      this.q.sort((a, b) => b.p - a.p);
      this.pump();
    });
  }

  private pump() {
    while (this.active < this.maxConcurrent && this.q.length > 0) {
      const t = this.q.shift()!;
      this.active++;
      t.run().then(
        v => { this.active--; t.resolve(v); this.pump(); },
        e => { this.active--; t.reject(e); this.pump(); }
      );
    }
  }
}
