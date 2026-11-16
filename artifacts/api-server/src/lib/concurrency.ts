/**
 * Runs at most `max` tasks at once; the rest wait in arrival order. A finished task hands its slot
 * straight to the next waiter, so nobody can jump the queue.
 */
export function limitConcurrency(max: number) {
  let active = 0;
  const waiting: Array<() => void> = [];
  return {
    async run<T>(task: () => Promise<T>, onStart?: () => Promise<void> | void): Promise<T> {
      if (active < max) active += 1;
      else await new Promise<void>((resolve) => waiting.push(resolve));
      try {
        await onStart?.();
        return await task();
      } finally {
        const next = waiting.shift();
        if (next) next();
        else active -= 1;
      }
    },
    get active() {
      return active;
    },
    get queued() {
      return waiting.length;
    },
  };
}
