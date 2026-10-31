/**
 * D1 stand-in for the Firestore surface the handlers use, so transaction options, read paths
 * and commit failures can be asserted without an emulator. References are plain `{ path }`
 * objects with no read methods, and the fake has no non-transactional reads: any read outside
 * `runTransaction` throws, which is what the T-GAP-6 test relies on.
 * Not a Firestore model: no locking, retries or snapshot isolation (those are platform behavior).
 */
import type { Firestore } from "firebase-admin/firestore";

interface Ref {
  readonly path: string;
  readonly id: string;
}

class FakeSnapshot {
  constructor(
    readonly id: string,
    private readonly fields: Record<string, unknown> | undefined,
  ) {}
  get exists(): boolean {
    return this.fields !== undefined;
  }
  get(key: string): unknown {
    return this.fields?.[key];
  }
  data(): Record<string, unknown> | undefined {
    return this.fields;
  }
}

export interface FakeFirestoreOptions {
  /** Rejects after the callback returns, as the SDK does once commit retries are exhausted. */
  readonly commitError?: Error;
}

export class FakeFirestore {
  readonly docs = new Map<string, Record<string, unknown>>();
  readonly transactionOptions: unknown[] = [];
  readonly transactionReads: string[] = [];
  readonly transactionWrites: string[] = [];
  private nextId = 0;

  constructor(private readonly options: FakeFirestoreOptions = {}) {}

  get asFirestore(): Firestore {
    return this as unknown as Firestore;
  }

  doc(path: string): Ref {
    return { path, id: path.slice(path.lastIndexOf("/") + 1) };
  }

  collection(path: string): { path: string; doc: () => Ref } {
    return { path, doc: () => this.doc(`${path}/auto-${++this.nextId}`) };
  }

  private snapshot(path: string): FakeSnapshot {
    this.transactionReads.push(path);
    return new FakeSnapshot(path.slice(path.lastIndexOf("/") + 1), this.docs.get(path));
  }

  async runTransaction<T>(fn: (tx: unknown) => Promise<T>, options?: unknown): Promise<T> {
    this.transactionOptions.push(options);
    const tx = {
      getAll: async (...refs: Ref[]) => refs.map((r) => this.snapshot(r.path)),
      get: async (query: { path: string }) => {
        const prefix = `${query.path}/`;
        const children = [...this.docs.keys()].filter((p) => p.startsWith(prefix) && !p.slice(prefix.length).includes("/"));
        return { docs: children.sort().map((p) => this.snapshot(p)) };
      },
      set: (ref: Ref) => {
        this.transactionWrites.push(ref.path);
      },
    };
    const result = await fn(tx);
    if (this.options.commitError) throw this.options.commitError;
    return result;
  }
}
