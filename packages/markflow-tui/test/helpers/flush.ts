// test/helpers/flush.ts
//
// Shared async flush helper for Ink / React tests.
//
// Ink 7 rewrote the stdin read path: a 20ms setTimeout (`pendingInputFlushDelayMilliseconds`)
// buffers ambiguous escape sequences (lone Esc or the prefix of an arrow/function key)
// so they can be disambiguated. A `flush()` built only on `setImmediate` ticks does not
// advance that timer, so Esc-path tests assert before the event is delivered. The trailing
// real-time wait below drains that timer; the surrounding setImmediate loops let React's
// commit and Ink's re-render propagate before `lastFrame()` is read.

export async function flush(n = 6): Promise<void> {
  for (let i = 0; i < n; i++) {
    await new Promise<void>((r) => setImmediate(r));
  }
  await new Promise<void>((r) => setTimeout(r, 25));
  for (let i = 0; i < n; i++) {
    await new Promise<void>((r) => setImmediate(r));
  }
}
