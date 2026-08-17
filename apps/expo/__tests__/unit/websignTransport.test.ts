/**
 * webSign transport (src/websign/transport.ts) — the entry-point plumbing that
 * turns a scanned QR string / deep link into the raw request JWS the review
 * flow consumes. Pins: the wrapped forms are recognised, a bare JWS or an
 * unrelated URL is NOT (so a request can never collide with card-exchange
 * payloads), and the `req` param decodes deterministically whether it carries
 * a raw compact JWS or its compressed fragment form.
 */
import { describe, expect, it } from 'bun:test';

import { classifyWebSignScan, decodeWebSignRequestParam } from '../../src/websign/transport';
import { encodeFragment } from '@solidarity/shared';

describe('classifyWebSignScan', () => {
  it('extracts req from the custom-scheme query form', () => {
    expect(classifyWebSignScan('solidarity://websign?req=aaa.bbb.ccc')).toBe('aaa.bbb.ccc');
    expect(classifyWebSignScan('airmeishi://websign?req=blobblob')).toBe('blobblob');
  });

  it('extracts req from the https fragment form', () => {
    expect(classifyWebSignScan('https://solidarity.gg/websign#req=BLOB_VALUE')).toBe('BLOB_VALUE');
  });

  it('returns null for a webSign wrapper with no req', () => {
    expect(classifyWebSignScan('solidarity://websign')).toBeNull();
    expect(classifyWebSignScan('https://solidarity.gg/websign')).toBeNull();
  });

  it('does not treat a bare JWS, a plain fragment, or an unrelated URL as webSign', () => {
    expect(classifyWebSignScan('eyJhbGciOiJFUzI1NiJ9.eyJhIjoxfQ.sig')).toBeNull();
    expect(classifyWebSignScan('https://solidarity.gg/#somefragment')).toBeNull();
    expect(classifyWebSignScan('solidarity://card/f47ac10b-58cc-4372-a567-0e02b2c3d479')).toBeNull();
    expect(classifyWebSignScan('not a url')).toBeNull();
  });
});

describe('decodeWebSignRequestParam', () => {
  it('passes through a raw 3-part compact JWS unchanged', () => {
    const r = decodeWebSignRequestParam('header.payload.signature');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe('header.payload.signature');
  });

  it('inflates the compressed fragment form back to the original JWS', () => {
    const jws = 'header.payload.signature';
    const { fragment } = encodeFragment(jws);
    expect(fragment.includes('.')).toBe(false); // fragment is dot-free base64url
    const r = decodeWebSignRequestParam(fragment);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe(jws);
  });

  it('fails closed on empty or corrupt input', () => {
    expect(decodeWebSignRequestParam('').ok).toBe(false);
    expect(decodeWebSignRequestParam('not-valid-fragment-!!!').ok).toBe(false);
  });
});
