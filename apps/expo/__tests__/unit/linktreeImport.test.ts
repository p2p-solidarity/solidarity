/**
 * Linktree import parser — 1.3.3 Task A2.4 (US-19),
 * `apps/expo/src/profile/linktreeImport.ts`.
 *
 * Pure(ish) — `fetchLinkPage` takes an injectable `fetchImpl` so this suite
 * never touches the network. Every fixture lives under
 * `__tests__/unit/fixtures/linktreeImport/` as a real static HTML file (not
 * an inline template string) so the linktr.ee-shaped / generic / empty
 * cases each read like an actual saved page.
 *
 * What this suite pins:
 *   1. linktr.ee-shaped page → links come from the embedded __NEXT_DATA__
 *      JSON, not a naive anchor scrape of the (deliberately different)
 *      server-rendered fallback markup.
 *   2. Generic page → `<a href="http…">` anchors only; non-http(s) schemes
 *      (mailto/tel/javascript), relative hrefs, same-page anchors
 *      (`#section`), and the page's own URL are all dropped; duplicates by
 *      URL are deduped; whitespace inside an href is trimmed; nested-tag
 *      inner text and HTML entities are decoded; an anchor with no visible
 *      text falls back to its hostname as the label (never fabricated
 *      link-specific copy).
 *   3. Zero-link / malformed pages → `err('noLinksFound')`, never a
 *      fabricated result (CLAUDE.md rule 8).
 *   4. Network/HTTP/scheme/content-type failures each surface their own
 *      reason, and a >50-link page is capped to the first 50.
 */
import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { fetchLinkPage } from '../../src/profile/linktreeImport';

function fixture(name: string): string {
  return readFileSync(join(__dirname, 'fixtures', 'linktreeImport', name), 'utf-8');
}

function htmlResponse(body: string, opts: { readonly status?: number; readonly contentType?: string } = {}): Response {
  return new Response(body, {
    status: opts.status ?? 200,
    headers: { 'content-type': opts.contentType ?? 'text/html; charset=utf-8' },
  });
}

function fetchReturning(response: Response): typeof fetch {
  return (async () => response) as unknown as typeof fetch;
}

describe('fetchLinkPage — linktr.ee-shaped page (embedded __NEXT_DATA__ JSON)', () => {
  it('extracts links from the JSON payload, not the fallback markup', async () => {
    const fetchImpl = fetchReturning(htmlResponse(fixture('linktree.html')));
    const result = await fetchLinkPage('https://linktr.ee/alicechen', fetchImpl);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.title).toBe('Alice Chen | Linktree');
    expect(result.value.links).toEqual([
      { label: 'My Portfolio', url: 'https://alicechen.example/portfolio' },
      { label: 'Twitter / X', url: 'https://x.com/alicechen' },
      { label: 'Newsletter', url: 'https://buttondown.email/alicechen' },
      { label: 'cal.com', url: 'https://cal.com/alicechen' },
    ]);
    // Fallback markup's "Back to top" #top anchor never leaks in.
    expect(result.value.links.some((l) => l.url.includes('#top'))).toBe(false);
  });
});

describe('fetchLinkPage — generic page (anchor scrape fallback)', () => {
  it('keeps only http(s) links, dedups, trims, decodes entities/nested tags, and falls back to hostname for blank labels', async () => {
    const fetchImpl = fetchReturning(htmlResponse(fixture('generic.html')));
    const result = await fetchLinkPage('https://bob.example/', fetchImpl);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.title).toBe("Bob's Home Page"); // og:title wins over <title>

    const urls = result.value.links.map((l) => l.url);
    // Self-link to the fetched page itself is dropped.
    expect(urls).not.toContain('https://bob.example/');
    // Non-http(s) schemes and relative/anchor hrefs are all dropped.
    expect(urls.every((u) => /^https?:\/\//i.test(u))).toBe(true);
    expect(urls).not.toContain('mailto:bob@example.com');
    expect(urls).not.toContain('tel:+15550100');
    expect(urls.some((u) => u.startsWith('javascript:'))).toBe(false);

    // Duplicate GitHub link appears once (first occurrence's label wins).
    const github = result.value.links.filter((l) => l.url === 'https://github.com/bobexample');
    expect(github.length).toBe(1);
    expect(github[0]?.label).toBe('GitHub');

    // Whitespace inside the href attribute is trimmed off the surviving URL.
    expect(urls).toContain('https://mastodon.example/@bob');

    // Nested <span> inner text is extracted as the label.
    expect(result.value.links.find((l) => l.url === 'https://twitter.com/bobexample')?.label).toBe('Twitter');

    // HTML entities in the label are decoded.
    expect(result.value.links.find((l) => l.url === 'https://amp.example/deals')?.label).toBe(
      'Fish & Chips <Shop>'
    );

    // An anchor with no visible text falls back to its hostname, not a blank/fabricated label.
    expect(result.value.links.find((l) => l.url === 'https://icon.example')?.label).toBe('icon.example');
  });

  it('caps the result to the first 50 links', async () => {
    const anchors = Array.from({ length: 60 }, (_, i) => `<a href="https://example.com/link${i}">Link ${i}</a>`).join('\n');
    const html = `<html><head><title>Many links</title></head><body>${anchors}</body></html>`;
    const fetchImpl = fetchReturning(htmlResponse(html));
    const result = await fetchLinkPage('https://example.com/', fetchImpl);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.links.length).toBe(50);
    expect(result.value.links[0]?.url).toBe('https://example.com/link0');
    expect(result.value.links[49]?.url).toBe('https://example.com/link49');
  });
});

describe('fetchLinkPage — no fabricated results on failure (CLAUDE.md rule 8)', () => {
  it('a page with zero real links returns err(noLinksFound)', async () => {
    const fetchImpl = fetchReturning(htmlResponse(fixture('empty.html')));
    const result = await fetchLinkPage('https://nobody.example/', fetchImpl);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('noLinksFound');
  });

  it('rejects a non-http(s) input URL without ever calling fetch', async () => {
    let called = false;
    const fetchImpl = (async () => {
      called = true;
      return htmlResponse('<html></html>');
    }) as unknown as typeof fetch;
    const result = await fetchLinkPage('javascript:alert(1)', fetchImpl);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('invalidUrl');
    expect(called).toBe(false);
  });

  it('a thrown fetch (offline / DNS failure) surfaces networkError', async () => {
    const fetchImpl = (async () => {
      throw new Error('getaddrinfo ENOTFOUND');
    }) as unknown as typeof fetch;
    const result = await fetchLinkPage('https://offline.example/', fetchImpl);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('networkError');
  });

  it('a non-2xx HTTP response surfaces httpError', async () => {
    const fetchImpl = fetchReturning(htmlResponse('<html></html>', { status: 404 }));
    const result = await fetchLinkPage('https://gone.example/', fetchImpl);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('httpError');
  });

  it('a non-HTML content-type surfaces nonHtmlResponse', async () => {
    const fetchImpl = fetchReturning(
      htmlResponse('{"not":"html"}', { contentType: 'application/json' })
    );
    const result = await fetchLinkPage('https://api.example/', fetchImpl);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('nonHtmlResponse');
  });
});
