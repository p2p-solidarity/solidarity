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
const EDITABLE_HANDLE_RE = /^@?[a-zA-Z0-9._-]+$/u;

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

const PRESET_LABELS: Readonly<Record<LinkLabelPreset, string>> = {
  linkedin: 'LinkedIn',
  instagram: 'Instagram',
  telegram: 'Telegram',
  x: 'X',
  github: 'GitHub',
  youtube: 'YouTube',
  website: 'Website',
};

export interface DetectedLink {
  readonly preset: LinkLabelPreset | null;
  readonly label: string;
  readonly url: string;
}

export function linkPresetForHostname(hostname: string): LinkLabelPreset | null {
  const normalized = hostname.toLowerCase().replace(/^www\./u, '');
  if (normalized === 'linkedin.com' || normalized.endsWith('.linkedin.com')) return 'linkedin';
  if (normalized === 'instagram.com' || normalized.endsWith('.instagram.com')) return 'instagram';
  if (normalized === 't.me' || normalized === 'telegram.me') return 'telegram';
  if (normalized === 'x.com' || normalized === 'twitter.com') return 'x';
  if (normalized === 'github.com' || normalized.endsWith('.github.com')) return 'github';
  if (normalized === 'youtube.com' || normalized === 'youtu.be') return 'youtube';
  return null;
}

export function detectLinkFromUrl(raw: string): DetectedLink | null {
  const normalized = normalizeLinkUrl(raw);
  if (!isHttpsLinkUrl(normalized)) return null;
  const hostname = new URL(normalized).hostname;
  const preset = linkPresetForHostname(hostname);
  return {
    preset,
    label: preset === null ? hostname.toLowerCase().replace(/^www\./u, '') : PRESET_LABELS[preset],
    url: normalized,
  };
}

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

// ── In-field input model ─────────────────────────────────────────────────
// The URL field renders the fixed part of the address as a read-only inline
// prefix (`https://`, `t.me/`, `instagram.com/` …) and the user types only
// what follows it. The row still STORES the full https URL (schema + save
// path unchanged); these helpers map between the two.

const FULL_SCHEME_RE = /^https?:\/\//iu;

export interface LinkInputModel {
  /** The fixed part shown inside the field (scheme omitted for platforms). */
  readonly prefix: string;
  /** True when the expected input is a platform handle, not a URL tail. */
  readonly handle: boolean;
}

/** Derived from HANDLE_URL_BUILDERS so the visible prefix can never drift
 * from the composed URL. */
export function linkInputModelFor(preset: LinkLabelPreset | null): LinkInputModel {
  const builder = preset === null ? undefined : HANDLE_URL_BUILDERS[preset];
  if (!builder) return { prefix: 'https://', handle: false };
  return { prefix: builder('').slice('https://'.length), handle: true };
}

/** Compose the stored full URL from what the user typed after the prefix.
 * A pasted full URL (it carries its own scheme) REPLACES the prefix mode
 * entirely (http upgraded to https). Under a platform preset everything
 * else is the handle — leading @ stripped, dots/underscores allowed (real
 * Instagram/Telegram handles have them, so no bare-handle shape guard here
 * unlike expandLinkPresetHandle's blur-time heuristic). */
export function composeLinkUrl(preset: LinkLabelPreset | null, display: string): string {
  const trimmed = display.trim();
  if (trimmed.length === 0) return '';
  if (FULL_SCHEME_RE.test(trimmed)) return normalizeLinkUrl(trimmed);
  const builder = preset === null ? undefined : HANDLE_URL_BUILDERS[preset];
  if (builder) {
    const handle = trimmed.startsWith('@') ? trimmed.slice(1) : trimmed;
    return handle.length > 0 ? builder(handle) : '';
  }
  return normalizeLinkUrl(trimmed);
}

/** Inverse of composeLinkUrl for rendering: strip the in-field prefix from
 * the stored full URL. A URL that does not carry the active prefix renders
 * verbatim — pair with urlMatchesPreset so the row falls back to the
 * generic https mode instead. */
export function displayLinkText(preset: LinkLabelPreset | null, url: string): string {
  if (url.length === 0) return '';
  // Legacy drafts may still carry http://. Render them against the same
  // upgraded prefix that Save will persist, including platform-handle mode.
  const editableUrl = HTTP_SCHEME_RE.test(url) ? normalizeLinkUrl(url) : url;
  const model = linkInputModelFor(preset);
  const fullPrefix = model.handle ? `https://${model.prefix}` : 'https://';
  if (editableUrl.toLowerCase().startsWith(fullPrefix.toLowerCase())) {
    return editableUrl.slice(fullPrefix.length);
  }
  return editableUrl;
}

/** Whether the stored URL still belongs to the active preset's platform.
 * False means a pasted URL replaced it and the row should drop back to the
 * generic https prefix. */
export function urlMatchesPreset(preset: LinkLabelPreset | null, url: string): boolean {
  const builder = preset === null ? undefined : HANDLE_URL_BUILDERS[preset];
  if (!builder) return true;
  return url.length === 0 || url.toLowerCase().startsWith(builder('').toLowerCase());
}

/** Whether a value is safe to compose as the single handle segment used by
 * the platform builders. Slashes, query strings, fragments, and schemes stay
 * in generic URL mode rather than producing a misleading handle editor. */
export function isLinkPresetHandleInput(value: string): boolean {
  return EDITABLE_HANDLE_RE.test(value.trim());
}

/** Keep a detected preset as an editable handle only when the stored URL is
 * the preset's canonical profile shape. Aliases (`twitter.com`, `www.*`) and
 * other platform URLs (videos, posts, query-bearing links) still retain their
 * detected label/icon, but use the lossless generic URL editor. */
export function linkPresetForEditableUrl(
  preset: LinkLabelPreset | null,
  url: string
): LinkLabelPreset | null {
  if (preset === null) return null;
  const model = linkInputModelFor(preset);
  if (!model.handle) return preset;
  const normalized = normalizeLinkUrl(url);
  if (!urlMatchesPreset(preset, normalized)) return null;
  return isLinkPresetHandleInput(displayLinkText(preset, normalized))
    ? preset
    : null;
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
