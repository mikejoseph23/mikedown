/**
 * Growth, not a wall clock: a busy machine slows a fixed limit into a false
 * alarm, but it slows the small and the large run alike. The input grows by 4x
 * per step (1/64, 1/16, 1/4, 1 of about 1 MiB); linear work then grows about
 * 4x per step and the quadratic scans these guard against about 16x. A step
 * that takes over 150 ms must not be 10x its predecessor (best of two looks, the
 * predecessor floored at 5 ms for timer noise). Climbing from the small end
 * means a regression fails at the first step where it shows, in seconds, instead
 * of hanging for minutes on the full 1 MiB. `make(u)` builds the input at a
 * scale `u`; 1 is about 1 MiB.
 */
import { expect } from 'vitest';

export const MIB = 1024 * 1024;

const STEPS = [1 / 64, 1 / 16, 1 / 4, 1];
const FLOOR_MS = 150;
const LIMIT = 10;

export async function expectNearLinear<T>(name: string, make: (u: number) => T, run: (input: T) => unknown | Promise<unknown>): Promise<void> {
  const time = async (input: T): Promise<number> => {
    const t0 = performance.now();
    await run(input);
    return performance.now() - t0;
  };
  let prev: { input: T; ms: number } | null = null;
  for (const u of STEPS) {
    const input = make(u);
    let ms = await time(input);
    if (prev && ms >= FLOOR_MS && ms / Math.max(prev.ms, 5) >= LIMIT) {
      // One more look at both before calling it: a quadratic scan fails again, a busy machine does not.
      ms = Math.min(ms, await time(input));
      prev.ms = Math.min(prev.ms, await time(prev.input));
      expect(ms / Math.max(prev.ms, 5), `${name}: ${ms.toFixed(0)} ms at ${u} of a MiB, ${prev.ms.toFixed(0)} ms at a quarter of that`).toBeLessThan(LIMIT);
    }
    prev = { input, ms };
  }
}

/** `s` repeated to about `chars * u` characters. */
export function rep(s: string, chars: number, u: number): string {
  return s.repeat(Math.max(1, Math.round((chars * u) / s.length)));
}
