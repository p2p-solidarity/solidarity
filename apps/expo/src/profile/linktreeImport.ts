/**
 * Linktree import — 1.3.3 Task A2.4 (US-19), the migration funnel from a
 * plaintext link-in-bio page (Linktree, or any similar personal page) into
 * a Solidarity Profile Record (Me › Edit) or a People "declared" contact.
 *
 * `fetchLinkPage` is pure(ish): it takes an injectable `fetchImpl` (same DI
 * convention as `src/oidc/credentialOffer.ts`'s `fetchCredentialOffer`) so
 * unit tests never touch the network — see
 * `__tests__/unit/linktreeImport.test.ts` and its fixtures under
 * `__tests__/unit/fixtures/linktreeImport/`.
 *
 * No HTML DOM parser is available in this RN runtime, so extraction is
 * regex-based (same pragmatic style as `feedback/webhookManager.ts`'s host
 * regex) in two passes, tried in order:
 *
 *   1. linktr.ee-shaped: Linktree (and any Next.js-rendered page) embeds
 *      its full page data as JSON in a `<script id="__NEXT_DATA__">` tag —
 *      the REAL data the page is built from, not a guess. `findLinkArray`
 *      walks that JSON looking for the first array of `{url, title}`-shaped
 *      objects, which is robust to Linktree's exact key nesting changing
 *      over time without hardcoding a brittle path.
 *   2. Generic fallback: every `<a href="http…">…</a>` anchor in the raw
 *      HTML, in document order.
 *
 * Every candidate — from either pass — is normalized through the same
 * filter before being returned: trimmed, `http(s)://`-only (this also
 * drops `mailto:`/`tel:`/`javascript:`/relative hrefs/bare `#anchor`
 * fragments in one step, since none of those match the scheme regex),
 * de-duped by URL, and never the source page's own URL. This guarantees
 * every returned link already satisfies `@solidarity/shared`'s
 * `profileLinkSchema` (no leading/trailing whitespace, `http(s)://` only).
 *
 * CLAUDE.md rule 8 (no fake data): a network failure, non-HTML response, or
 * a page with zero real links after filtering returns `err(reason)` — never
 * a fabricated/placeholder link list. `reason` is a closed set of machine
 * codes (mirrors `VerifiedPageErrorReason` in
 * `src/scan/verifiedPageHandler.ts`) that UI callers map to a real i18n
 * string via `t(\`meEdit.linktreeImport.reason.${reason}\`)`.
 */
import { err, ok, type Result } from '@solidarity/shared';

export type LinkPageImportErrorReason =
  | 'invalidUrl'
  | 'networkError'
  | 'httpError'
  | 'nonHtmlResponse'
  | 'noLinksFound';

export interface LinkPageLink {
  readonly label: string;
  readonly url: string;
}

export interface LinkPageImport {
  readonly title: string | null;
  readonly links: readonly LinkPageLink[];
}

/** QR/preview-list budget — an unbounded scrape of a huge page would make
 * the confirm checklist unusable and inflate the eventual Profile Record. */
const MAX_LINKS = 50;

const HTTP_URL_RE = /^https?:\/\//i;

export async function fetchLinkPage(
  url: string,
  fetchImpl: typeof fetch = fetch
): Promise<Result<LinkPageImport, LinkPageImportErrorReason>> {
  const sourceUrl = url.trim();
  if (!HTTP_URL_RE.test(sourceUrl)) return err('invalidUrl');

  let response: Response;
  try {
    response = await fetchImpl(sourceUrl);
  } catch {
    return err('networkError');
  }
  if (!response.ok) return err('httpError');

  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.length > 0 && !contentType.toLowerCase().includes('html')) {
    return err('nonHtmlResponse');
  }

  let html: string;
  try {
    html = await response.text();
  } catch {
    return err('networkError');
  }

  const title = extractTitle(html);
  const jsonCandidates = extractNextDataLinks(html);
  const rawCandidates = jsonCandidates.length > 0 ? jsonCandidates : extractAnchorLinks(html);
  const links = normalizeCandidates(rawCandidates, sourceUrl);

  if (links.length === 0) return err('noLinksFound');

  return ok({ title, links });
}

// ── Title extraction — real page metadata only, never fabricated ──────────

function extractTitle(html: string): string | null {
  // Quote char captured as a backreference (not a `[^"']` class) so a
  // straight apostrophe inside a double-quoted `content="…"` value (e.g.
  // "Bob's Home Page") doesn't truncate the match.
  const og =
    /<meta[^>]+property=["']og:title["'][^>]*content=(["'])([\s\S]*?)\1[^>]*>/i.exec(html) ??
    /<meta[^>]+content=(["'])([\s\S]*?)\1[^>]*property=["']og:title["'][^>]*>/i.exec(html);
  const ogTitle = og?.[2] !== undefined ? decodeHtmlEntities(og[2]).trim() : '';
  if (ogTitle.length > 0) return ogTitle;

  const titleTag = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const tagTitle = titleTag?.[1] !== undefined ? decodeHtmlEntities(titleTag[1]).trim() : '';
  return tagTitle.length > 0 ? tagTitle : null;
}

// ── Pass 1: linktr.ee / Next.js embedded __NEXT_DATA__ JSON ────────────────

const NEXT_DATA_RE = /<script[^>]*\bid=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i;

function extractNextDataLinks(html: string): readonly { readonly label: string; readonly url: string }[] {
  const match = NEXT_DATA_RE.exec(html);
  if (!match?.[1]) return [];
  let json: unknown;
  try {
    json = JSON.parse(match[1]);
  } catch {
    return [];
  }
  return findLinkArray(json, 0) ?? [];
}

/** Recursively search a parsed JSON value for the first array whose entries
 * are `{url: string, ...}`-shaped objects with an http(s) url — that array
 * IS the page's real link list, regardless of exactly where Linktree nests
 * it. Depth-capped so a pathological payload can't recurse unboundedly. */
function findLinkArray(
  node: unknown,
  depth: number
): readonly { readonly label: string; readonly url: string }[] | null {
  if (depth > 8 || node === null || typeof node !== 'object') return null;

  if (Array.isArray(node)) {
    const candidates: { readonly label: string; readonly url: string }[] = [];
    for (const item of node) {
      if (item !== null && typeof item === 'object') {
        const rec = item as Record<string, unknown>;
        const url = rec['url'];
        const label = rec['title'] ?? rec['label'];
        if (typeof url === 'string' && HTTP_URL_RE.test(url.trim())) {
          candidates.push({ label: typeof label === 'string' ? label : '', url });
        }
      }
    }
    if (candidates.length > 0) return candidates;
    for (const item of node) {
      const found = findLinkArray(item, depth + 1);
      if (found) return found;
    }
    return null;
  }

  const obj = node as Record<string, unknown>;
  for (const key of Object.keys(obj)) {
    const found = findLinkArray(obj[key], depth + 1);
    if (found) return found;
  }
  return null;
}

// ── Pass 2: generic <a href="http…">…</a> anchor scrape ────────────────────

const ANCHOR_RE = /<a\b[^>]*\bhref\s*=\s*(["'])([\s\S]*?)\1[^>]*>([\s\S]*?)<\/a>/gi;

function extractAnchorLinks(html: string): readonly { readonly label: string; readonly url: string }[] {
  const out: { readonly label: string; readonly url: string }[] = [];
  ANCHOR_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = ANCHOR_RE.exec(html)) !== null) {
    const rawUrl = match[2] ?? '';
    const rawInner = match[3] ?? '';
    out.push({ label: extractText(rawInner), url: rawUrl.trim() });
  }
  return out;
}

function extractText(innerHtml: string): string {
  const noTags = innerHtml.replace(/<[^>]+>/g, ' ');
  return decodeHtmlEntities(noTags).replace(/\s+/g, ' ').trim();
}

function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCharCode(parseInt(code, 16)));
}

// ── Shared normalization: the ONE gate every candidate (from either pass)
// must clear before it's returned — see module doc. ────────────────────────

function normalizeCandidates(
  candidates: readonly { readonly label: string; readonly url: string }[],
  sourceUrl: string
): readonly LinkPageLink[] {
  const seen = new Set<string>();
  const out: LinkPageLink[] = [];
  for (const candidate of candidates) {
    const url = candidate.url.trim();
    // http(s)-only also drops mailto:/tel:/javascript:/data:, relative
    // hrefs, and bare `#anchor` fragments in one check.
    if (!HTTP_URL_RE.test(url)) continue;
    if (url === sourceUrl) continue; // same-page self-link (e.g. a header logo)
    if (seen.has(url)) continue;
    seen.add(url);
    const label = candidate.label.trim();
    out.push({ label: label.length > 0 ? label : hostnameOf(url), url });
    if (out.length >= MAX_LINKS) break;
  }
  return out;
}

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}
