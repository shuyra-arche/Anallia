/** Limit visual updates independently of display refresh and pause while hidden. */
export function startClock(
  tick: (now: number, dt: number) => void,
  framesPerSecond: () => number = () => 60,
): () => void {
  let previous = performance.now(),
    nextDue = previous,
    handle = 0,
    stopped = false;
  const frame = (now: number) => {
    if (stopped || document.hidden) return;
    const limit = framesPerSecond();
    if (limit === Infinity || now + 0.1 >= nextDue) {
      const dt = Math.min(50, now - previous);
      previous = now;
      tick(now, dt);
      nextDue =
        limit === Infinity ? now : Math.max(nextDue + 1000 / limit, now);
    }
    handle = requestAnimationFrame(frame);
  };
  const visibility = () => {
    cancelAnimationFrame(handle);
    if (!stopped && !document.hidden) {
      previous = performance.now();
      nextDue = previous;
      handle = requestAnimationFrame(frame);
    }
  };
  document.addEventListener("visibilitychange", visibility);
  if (!document.hidden) handle = requestAnimationFrame(frame);
  return () => {
    stopped = true;
    cancelAnimationFrame(handle);
    document.removeEventListener("visibilitychange", visibility);
  };
}
