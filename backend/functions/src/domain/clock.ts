/** Injectable server clock: read once per transaction attempt so derived deadlines share one instant. */
export interface Clock {
  nowMillis(): number;
}

export const systemClock: Clock = { nowMillis: () => Date.now() };

/** RFC 3339 UTC with millisecond precision, e.g. 2026-10-28T19:13:18.569Z (W-01 D-7). */
export function toRfc3339(millis: number): string {
  return new Date(millis).toISOString();
}
