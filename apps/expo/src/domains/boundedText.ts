import { err, ok, type Result } from '@solidarity/shared';

export type BoundedTextError = 'tooLarge' | 'unreadable';

/** Stream a response into memory while enforcing the byte cap during download. */
export async function readResponseTextBounded(
  response: Response,
  maxResponseBytes: number,
  controller: AbortController
): Promise<Result<string, BoundedTextError>> {
  const declaredLength = response.headers.get('content-length');
  if (declaredLength !== null) {
    const parsedLength = Number(declaredLength);
    if (Number.isFinite(parsedLength) && parsedLength > maxResponseBytes) {
      controller.abort();
      return err('tooLarge');
    }
  }

  const body = response.body;
  if (body === null) return ok('');

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      total += next.value.byteLength;
      if (total > maxResponseBytes) {
        try {
          await reader.cancel('response exceeded byte limit');
        } catch {
          // The transport may already have closed; the boundary still fails.
        }
        controller.abort();
        return err('tooLarge');
      }
      chunks.push(next.value);
    }
  } catch {
    return err('unreadable');
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return ok(new TextDecoder().decode(bytes));
}
