/**
 * Forgiving link-URL normalization for the Me › Edit link rows (1.3.3 Task
 * A2.2 UX pass). The profile schema (`@solidarity/shared`'s
 * `profileLinkSchema`) requires every `links[].url` to match `^https?://`
 * with no surrounding whitespace — a security rule (the web viewer renders
 * each url as an `<a href>`, so `javascript:`/`data:`/scheme-less input must
 * never reach an anchor). That rule is the SAVE gate and stays unchanged;
 * this helper only makes TYPING kinder, run on blur so a user who types
 * `example.com` gets `https://example.com` instead of a rejection.
 *
 * Rules (deliberately conservative — never turn an invalid scheme into a
 * plausible-looking https URL, that would defeat the error the user needs):
 *  - trim surrounding whitespace;
 *  - empty → '' (a blank row is dropped from the saved payload anyway);
 *  - already carries a URL scheme → leave verbatim, so `https://x` is
 *    untouched AND a `ftp://x` / `javascript:alert(1)` still fails the save
 *    schema loudly instead of being rewritten into `https://ftp://x` /
 *    `https://javascript:…` (note: a scheme need not include `//`, so a
 *    plain `javascript:` URI must be caught too);
 *  - otherwise (a bare host/path, no scheme) → prefix `https://`.
 *
 * Pure + import-safe (no React Native): unit-tested directly in
 * `__tests__/unit/linkUrl.test.ts`.
 */

// A URL scheme is `ALPHA *( ALPHA / DIGIT / "+" / "-" / "." )` followed by
// ':' (RFC 3986 §3.1). The negative lookahead for a digit after the colon
// keeps `example.com:8080` (host:port, no scheme) from being misread as a
// scheme — that still gets an `https://` prefix.
const HAS_SCHEME_RE = /^[a-zA-Z][a-zA-Z0-9+.-]*:(?![0-9])/;

export function normalizeLinkUrl(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return '';
  if (HAS_SCHEME_RE.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}
