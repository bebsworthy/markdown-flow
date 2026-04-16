import type { RetryConfig } from "./types.js";
import { parseDuration } from "./duration.js";

/**
 * Compute the delay in milliseconds to wait before the next attempt.
 *
 * `attempt` is 0-indexed: the value passed is the number of failures observed
 * so far (attempt 0 = delay before the first retry, after the initial run).
 */
export function computeRetryDelay(
  cfg: RetryConfig,
  attempt: number,
  rand: () => number = Math.random,
): number {
  const baseMs = cfg.delay ? parseDuration(cfg.delay) : 0;
  if (baseMs === 0) return 0;

  const kind = cfg.backoff ?? "fixed";
  let raw: number;
  if (kind === "fixed") {
    raw = baseMs;
  } else if (kind === "linear") {
    raw = baseMs * (attempt + 1);
  } else {
    raw = baseMs * Math.pow(2, attempt);
  }

  if (cfg.maxDelay !== undefined) {
    raw = Math.min(raw, parseDuration(cfg.maxDelay));
  }

  const jitter = cfg.jitter ?? 0;
  if (jitter > 0) {
    // Symmetric jitter: multiplier in [1 - jitter, 1 + jitter].
    const multiplier = 1 + (rand() * 2 - 1) * jitter;
    raw = raw * multiplier;
  }

  return Math.max(0, Math.round(raw));
}

/**
 * Abortable sleep. Resolves after `ms` milliseconds, or rejects with an
 * AbortError if the signal fires first. Returns immediately if ms <= 0.
 */
export function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) {
    if (signal?.aborted) return Promise.reject(new DOMException("Aborted", "AbortError"));
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
