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
 *  - `http://` → upgrade to `https://`;
 *  - any other existing URL scheme → leave verbatim, so `https://x` is
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
const HTTP_SCHEME_RE = /^http:\/\//iu;
const BARE_HANDLE_RE = /^@?[a-zA-Z0-9_-]+$/u;

export const LINK_LABEL_PRESETS = [
  'linkedin',
  'instagram',
  'telegram',
  'x',
  'github',
  'youtube',
  'website',
] as const;

export type LinkLabelPreset = (typeof LINK_LABEL_PRESETS)[number];

const HANDLE_URL_BUILDERS: Readonly<
  Partial<Record<LinkLabelPreset, (handle: string) => string>>
> = {
  linkedin: (handle) => `https://linkedin.com/in/${handle}`,
  instagram: (handle) => `https://instagram.com/${handle}`,
  telegram: (handle) => `https://t.me/${handle}`,
  x: (handle) => `https://x.com/${handle}`,
  github: (handle) => `https://github.com/${handle}`,
  youtube: (handle) => `https://youtube.com/@${handle}`,
};

export function normalizeLinkUrl(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return '';
  if (HTTP_SCHEME_RE.test(trimmed)) return `https://${trimmed.slice(trimmed.indexOf('//') + 2)}`;
  if (HAS_SCHEME_RE.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

/** App-layer save gate. The shared schema intentionally remains http(s) so
 * already-published legacy records still render in People. */
export function isHttpsLinkUrl(value: string): boolean {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

/** Expand a selected platform preset's bare handle into its canonical URL.
 * Pasted hosts/URLs stay untouched and then flow through normalizeLinkUrl. */
export function expandLinkPresetHandle(preset: LinkLabelPreset | null, raw: string): string {
  const trimmed = raw.trim();
  if (preset === null || !BARE_HANDLE_RE.test(trimmed)) return trimmed;
  const builder = HANDLE_URL_BUILDERS[preset];
  if (!builder) return trimmed;
  const handle = trimmed.startsWith('@') ? trimmed.slice(1) : trimmed;
  return handle.length > 0 ? builder(handle) : trimmed;
}
