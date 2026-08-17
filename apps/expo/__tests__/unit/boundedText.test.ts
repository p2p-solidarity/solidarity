import { describe, expect, it } from 'bun:test';

import { readResponseTextBounded } from '@/domains/boundedText';

describe('readResponseTextBounded', () => {
  it('reads a response whose streamed body stays within the cap', async () => {
    const controller = new AbortController();

    expect(await readResponseTextBounded(new Response('small'), 5, controller)).toEqual({
      ok: true,
      value: 'small',
    });
    expect(controller.signal.aborted).toBe(false);
  });

  it('cancels and aborts as soon as a streamed body crosses the cap', async () => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('12345'));
        controller.enqueue(new TextEncoder().encode('67890'));
      },
      cancel() {
        cancelled = true;
      },
    });
    const controller = new AbortController();

    expect(await readResponseTextBounded(new Response(stream), 8, controller)).toEqual({
      ok: false,
      error: 'tooLarge',
    });
    expect(cancelled).toBe(true);
    expect(controller.signal.aborted).toBe(true);
  });
});
