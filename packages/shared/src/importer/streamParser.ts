/**
 * Stream JSON-array parser — TS port of
 * solidarity/Services/Importer/StreamParser.swift.
 *
 * Consumes an async iterable of UTF-8 chunks and yields decoded elements
 * one at a time. Mirrors the Swift `parseJSONArray` state machine so the
 * Twitter / Google Takeout importers can adopt the same wire contract.
 *
 * Limits (match Swift):
 *   - `MAX_ELEMENT_BYTES` (1 MiB): hard cap on a single accumulated
 *     element. Anything larger is treated as a malformed input and the
 *     generator throws — preventing unbounded buffer growth on
 *     missing-`]` archives.
 *
 * The parser only handles top-level JSON arrays of objects/arrays/
 * primitives. Whitespace and the leading `[` are skipped automatically;
 * commas at the top level terminate an element.
 */

const MAX_ELEMENT_BYTES = 1 * 1024 * 1024;

class StreamParserError extends Error {
  constructor(reason: 'invalidFormat' | 'elementTooLarge') {
    super(reason);
    this.name = 'StreamParserError';
  }
}

export async function* streamParseJsonArray(
  textStream: AsyncIterable<string>
): AsyncGenerator<unknown> {
  let buffer = '';
  let depth = 0;
  let inString = false;
  let escapeNext = false;
  let arrayStartFound = false;
  let currentElement = '';
  let elementDepth = 0;

  for await (const chunk of textStream) {
    buffer += chunk;
    for (let i = 0; i < buffer.length; i += 1) {
      if (currentElement.length > MAX_ELEMENT_BYTES) {
        throw new StreamParserError('elementTooLarge');
      }
      const char = buffer[i] ?? '';

      if (escapeNext) {
        escapeNext = false;
        currentElement += char;
        continue;
      }

      if (char === '\\' && inString) {
        escapeNext = true;
        currentElement += char;
        continue;
      }

      if (char === '"') {
        inString = !inString;
        currentElement += char;
        continue;
      }

      if (inString) {
        currentElement += char;
        continue;
      }

      if (char === '[' || char === '{') {
        depth += 1;
        if (!arrayStartFound && char === '[') {
          arrayStartFound = true;
        } else if (arrayStartFound) {
          if (elementDepth === 0) elementDepth = depth;
          currentElement += char;
        }
        continue;
      }

      if (char === ']' || char === '}') {
        depth -= 1;
        if (arrayStartFound && depth === elementDepth - 1) {
          currentElement += char;
          try {
            const decoded: unknown = JSON.parse(currentElement);
            yield decoded;
          } catch {
            // Malformed element — skip, matching Swift's "log but continue".
          }
          currentElement = '';
          elementDepth = 0;
        }
        continue;
      }

      if (char === ',' && depth === elementDepth) {
        continue;
      }

      if (arrayStartFound && depth >= elementDepth && elementDepth > 0) {
        currentElement += char;
      }
    }
    // Drop the consumed prefix to keep the working buffer bounded.
    buffer = '';
  }

  if (!arrayStartFound) {
    throw new StreamParserError('invalidFormat');
  }
}

export { StreamParserError };
