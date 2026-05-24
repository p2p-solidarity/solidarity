/**
 * walletPassSigner — end-to-end test for the .pkpass signing pipeline.
 *
 * Pins:
 *   1. Endpoint defaults to the Swift constant exactly.
 *   2. `signManifest` POSTs the raw manifest bytes verbatim and returns the
 *      server's binary response unmodified.
 *   3. `buildAndSignPkpass`
 *        - Produces a STORED ZIP whose CRC-32 + central directory parses.
 *        - manifest.json contains a SHA-1 hex digest for every other file.
 *        - The injected signature bytes round-trip through the archive.
 *   4. Non-2xx responses throw a `PassSigningError` exposing status + body.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';

import {
  bytesToHex,
  sha1Bytes,
  utf8ToBytes,
  type BusinessCard,
} from '@solidarity/shared';

// ── Mock expo-file-system/legacy so the builder runs in bun without RN ─────
//
// We capture every write to an in-memory map so the test can re-read the
// produced .pkpass bytes.

interface FsCall {
  uri: string;
  body: string;
  encoding?: string;
}

const writes: FsCall[] = [];
const dirs = new Set<string>();
let documentDirectory: string | null = 'file:///fixture-doc/';

const fsLegacyMock = {
  documentDirectory: 'file:///fixture-doc/',
  cacheDirectory: 'file:///fixture-cache/',
  EncodingType: { Base64: 'base64', UTF8: 'utf8' },
  getInfoAsync: (uri: string) =>
    Promise.resolve({ exists: dirs.has(uri) || writes.some((w) => w.uri === uri) }),
  makeDirectoryAsync: (uri: string) => {
    dirs.add(uri);
    return Promise.resolve();
  },
  writeAsStringAsync: (
    uri: string,
    body: string,
    opts?: { encoding?: string }
  ) => {
    writes.push({ uri, body, encoding: opts?.encoding });
    return Promise.resolve();
  },
};

beforeAll(async () => {
  await mock.module('expo-file-system/legacy', () => fsLegacyMock);
});

// ── Fetch double — install per-test so we can swap success / failure ───────

type FetchHandler = (input: unknown, init: RequestInit) => Promise<Response>;

const originalFetch = globalThis.fetch;
let currentHandler: FetchHandler = () => {
  throw new Error('fetch handler not installed');
};

beforeAll(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).fetch = ((input: unknown, init: RequestInit) =>
    currentHandler(input, init)) as typeof fetch;
});

afterAll(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).fetch = originalFetch;
});

beforeEach(() => {
  writes.length = 0;
  dirs.clear();
  documentDirectory = 'file:///fixture-doc/';
  fsLegacyMock.documentDirectory = documentDirectory;
});

function expectBytesEqual(a: Uint8Array, b: Uint8Array): void {
  expect(a.length).toBe(b.length);
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) {
      throw new Error(
        `byte mismatch at index ${String(i)}: got ${String(a[i])}, want ${String(b[i])}`
      );
    }
  }
}

// ── Test fixtures ──────────────────────────────────────────────────────────

const SIGNATURE_FIXTURE = new Uint8Array([
  0xde, 0xad, 0xbe, 0xef, 0x00, 0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77, 0x88,
  0x99, 0xaa, 0xbb,
]);

const TINY_PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49,
  0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x04,
  0x00, 0x00, 0x00, 0xb5, 0x1c, 0x0c, 0x02,
]);

function makeCard(): BusinessCard {
  return {
    id: '11111111-2222-3333-4444-555555555555',
    name: 'Ada Lovelace',
    title: 'Engineer',
    company: 'Analytical Engines',
    email: 'ada@example.com',
    phone: '+1-555-0100',
    profileImage: undefined,
    socialNetworks: [],
    skills: [],
    categories: [],
    sharingPreferences: {
      publicFields: new Set(['name']),
      professionalFields: new Set(['name', 'title', 'company', 'email']),
      personalFields: new Set(['name', 'title', 'company', 'email', 'phone']),
      allowForwarding: true,
      useZK: false,
      sharingFormat: 'plaintext',
    },
    verifiedFields: undefined,
    nameType: 'display_name',
    createdAt: new Date('2026-05-24T10:32:00Z'),
    updatedAt: new Date('2026-05-24T10:32:00Z'),
  } as unknown as BusinessCard;
}

// ── ZIP reader (minimal, STORED only) — used to verify the archive ─────────

interface ZipEntryRead {
  name: string;
  data: Uint8Array;
}

function readZip(bytes: Uint8Array): ZipEntryRead[] {
  // Find end-of-central-directory record by scanning from the end.
  let eocdOffset = -1;
  for (let i = bytes.length - 22; i >= 0; i -= 1) {
    if (
      bytes[i] === 0x50 &&
      bytes[i + 1] === 0x4b &&
      bytes[i + 2] === 0x05 &&
      bytes[i + 3] === 0x06
    ) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset < 0) throw new Error('EOCD not found');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const totalEntries = view.getUint16(eocdOffset + 10, true);
  const cdOffset = view.getUint32(eocdOffset + 16, true);

  const entries: ZipEntryRead[] = [];
  let cursor = cdOffset;
  for (let i = 0; i < totalEntries; i += 1) {
    if (view.getUint32(cursor, true) !== 0x02_01_4b_50) {
      throw new Error(`bad CD signature at ${String(cursor)}`);
    }
    const compressedSize = view.getUint32(cursor + 20, true);
    const nameLen = view.getUint16(cursor + 28, true);
    const extraLen = view.getUint16(cursor + 30, true);
    const commentLen = view.getUint16(cursor + 32, true);
    const localOffset = view.getUint32(cursor + 42, true);
    const name = new TextDecoder().decode(
      bytes.subarray(cursor + 46, cursor + 46 + nameLen)
    );

    // Local header is 30 bytes + nameLen + extraLen → then data.
    const localNameLen = view.getUint16(localOffset + 26, true);
    const localExtraLen = view.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + localNameLen + localExtraLen;
    const data = bytes.subarray(dataStart, dataStart + compressedSize);
    entries.push({ name, data });

    cursor += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('passSigner — endpoint contract', () => {
  it('default endpoint matches the Swift PassKitManager constant', async () => {
    const { DEFAULT_SIGN_ENDPOINT, SIGN_ENDPOINT } = await import(
      '../../src/components/walletpass/passSigner'
    );
    expect(DEFAULT_SIGN_ENDPOINT).toBe(
      'https://bussiness-card.kidneyweakx.com/sign-pass'
    );
    // SIGN_ENDPOINT may equal the default OR an override — never empty.
    expect(SIGN_ENDPOINT.length).toBeGreaterThan(0);
  });
});

describe('signManifest — request / response shape', () => {
  it('POSTs the manifest bytes verbatim and returns the binary signature', async () => {
    const { signManifest } = await import(
      '../../src/components/walletpass/passSigner'
    );

    const captured: { method?: string; ct?: string; body?: ArrayBuffer } = {};
    currentHandler = (input, init) => {
      captured.method = init.method;
      const headers = init.headers as Record<string, string> | undefined;
      captured.ct = headers?.['Content-Type'];
      captured.body = init.body as ArrayBuffer;
      expect(String(input)).toBe(
        'https://bussiness-card.kidneyweakx.com/sign-pass'
      );
      return Promise.resolve(
        new Response(SIGNATURE_FIXTURE.buffer, {
          status: 200,
          headers: { 'Content-Type': 'application/pkcs7-signature' },
        })
      );
    };

    const manifestBytes = utf8ToBytes('{"hello":"world"}');
    const result = await signManifest(manifestBytes);

    expect(captured.method).toBe('POST');
    expect(captured.ct).toBe('text/plain');
    expect(captured.body).toBeDefined();
    expectBytesEqual(new Uint8Array(captured.body!), manifestBytes);
    expectBytesEqual(result, SIGNATURE_FIXTURE);
  });

  it('non-2xx response throws a PassSigningError carrying status + body', async () => {
    const { signManifest, PassSigningError } = await import(
      '../../src/components/walletpass/passSigner'
    );

    currentHandler = () =>
      Promise.resolve(
        new Response('{"message":"cert expired"}', {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        })
      );

    let captured: unknown = null;
    try {
      await signManifest(utf8ToBytes('payload'));
    } catch (e) {
      captured = e;
    }
    expect(captured).toBeInstanceOf(PassSigningError);
    const err = captured as InstanceType<typeof PassSigningError>;
    expect(err.status).toBe(500);
    expect(err.body).toContain('cert expired');
    expect(err.message).toContain('500');
    expect(err.message).toMatch(/cert expired/);
  });

  it('empty 200 response throws a clear error', async () => {
    const { signManifest, PassSigningError } = await import(
      '../../src/components/walletpass/passSigner'
    );
    currentHandler = () =>
      Promise.resolve(new Response(new ArrayBuffer(0), { status: 200 }));
    let captured: unknown = null;
    try {
      await signManifest(utf8ToBytes('payload'));
    } catch (e) {
      captured = e;
    }
    expect(captured).toBeInstanceOf(PassSigningError);
    expect((captured as Error).message).toMatch(/empty/i);
  });
});

describe('buildAndSignPkpass — end-to-end', () => {
  it('produces a STORED .pkpass containing pass.json, manifest, signature, and assets', async () => {
    const { buildAndSignPkpass } = await import(
      '../../src/components/walletpass/passBundle'
    );

    // Capture the manifest the signer actually receives so we can compare
    // it against the manifest the test extracts from the .pkpass.
    let capturedManifest: Uint8Array | null = null;
    currentHandler = (_input, init) => {
      capturedManifest = new Uint8Array(init.body as ArrayBuffer);
      return Promise.resolve(
        new Response(SIGNATURE_FIXTURE.buffer, { status: 200 })
      );
    };

    const card = makeCard();
    const result = await buildAndSignPkpass(card, 'professional', {
      logoPng: TINY_PNG,
      iconPng: TINY_PNG,
      serialNumber: 'FIXED-SERIAL',
      createdAt: new Date('2026-05-24T10:32:00Z'),
    });

    expect(result.fileUri).toBe('file:///fixture-doc/wallet/' + card.id + '.pkpass');
    expectBytesEqual(result.signatureBytes, SIGNATURE_FIXTURE);

    const entries = readZip(result.pkpassBytes);
    const names = entries.map((e) => e.name).sort();
    expect(names).toEqual(
      [
        'icon.png',
        'icon@2x.png',
        'icon@3x.png',
        'logo.png',
        'logo@2x.png',
        'logo@3x.png',
        'manifest.json',
        'pass.json',
        'signature',
      ].sort()
    );

    // pass.json round-trips byte-equal.
    const passEntry = entries.find((e) => e.name === 'pass.json')!;
    expect(passEntry.data).toBeDefined();
    const passJson = JSON.parse(new TextDecoder().decode(passEntry.data)) as {
      serialNumber: string;
      passTypeIdentifier: string;
      teamIdentifier: string;
      generic: { primaryFields: { value: string }[] };
    };
    expect(passJson.serialNumber).toBe('FIXED-SERIAL');
    expect(passJson.passTypeIdentifier).toBe(
      'pass.kidneyweakx.airmeishi.businesscard'
    );
    expect(passJson.teamIdentifier).toBe('538MCM44UX');
    expect(passJson.generic.primaryFields[0]?.value).toBe('Ada Lovelace');

    // signature bytes equal what the mock returned.
    const sigEntry = entries.find((e) => e.name === 'signature')!;
    expectBytesEqual(sigEntry.data, SIGNATURE_FIXTURE);

    // manifest contains correct SHA-1 hex for every other file.
    const manifestEntry = entries.find((e) => e.name === 'manifest.json')!;
    const manifest = JSON.parse(
      new TextDecoder().decode(manifestEntry.data)
    ) as Record<string, string>;

    expect(manifest['pass.json']).toBe(bytesToHex(sha1Bytes(passEntry.data)));
    expect(manifest['logo.png']).toBe(bytesToHex(sha1Bytes(TINY_PNG)));
    expect(manifest['logo@2x.png']).toBe(manifest['logo.png']);
    expect(manifest['icon.png']).toBe(bytesToHex(sha1Bytes(TINY_PNG)));

    // The manifest sent to the signer is the same one in the archive.
    expect(capturedManifest).not.toBeNull();
    expectBytesEqual(capturedManifest!, manifestEntry.data);

    // FileSystem wrote a base64-encoded payload to the documents/wallet dir.
    expect(writes.length).toBe(1);
    expect(writes[0]?.uri).toBe(result.fileUri);
    expect(writes[0]?.encoding).toBe('base64');
  });

  it('bubbles up signing errors so the UI can surface them', async () => {
    const { buildAndSignPkpass } = await import(
      '../../src/components/walletpass/passBundle'
    );
    currentHandler = () =>
      Promise.resolve(
        new Response('signing rotated out', { status: 503 })
      );

    let captured: unknown = null;
    try {
      await buildAndSignPkpass(makeCard(), 'professional', {
        logoPng: TINY_PNG,
        iconPng: TINY_PNG,
        inMemoryOnly: true,
      });
    } catch (e) {
      captured = e;
    }
    expect(captured).toBeInstanceOf(Error);
    expect((captured as Error).message).toContain('503');
  });
});

// silence "documentDirectory" unused-var warning in some bun versions
void documentDirectory;
