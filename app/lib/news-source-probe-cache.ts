import { randomUUID } from "node:crypto";

type Probe<T> = { ownerId: string; inputUrl: string; expires: number; value: T };

export class NewsSourceProbeStore<T> {
  private readonly probes = new Map<string, Probe<T>>();
  private readonly limit: number;
  private readonly ttl: number;
  private readonly now: () => number;
  private readonly token: () => string;
  constructor(limit = 32, ttl = 10 * 60 * 1000, now: () => number = Date.now, token: () => string = randomUUID) {
    if (!Number.isInteger(limit) || limit < 1 || ttl < 1) throw new Error("Invalid source probe store limits.");
    this.limit = limit;
    this.ttl = ttl;
    this.now = now;
    this.token = token;
  }
  private prune() {
    const now = this.now();
    for (const [token, probe] of this.probes) if (probe.expires <= now) this.probes.delete(token);
  }
  stage(ownerId: string, inputUrl: string, value: T) {
    this.prune();
    while (this.probes.size >= this.limit) this.probes.delete(this.probes.keys().next().value!);
    const token = this.token();
    this.probes.set(token, { ownerId, inputUrl, expires: this.now() + this.ttl, value });
    return token;
  }
  consume(ownerId: string, inputUrl: string, token: string) {
    this.prune();
    const probe = this.probes.get(token);
    this.probes.delete(token);
    return probe && probe.ownerId === ownerId && probe.inputUrl === inputUrl ? probe.value : null;
  }
}
