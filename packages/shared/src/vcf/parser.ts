/**
 * Minimal vCard 3.0 / 4.0 parser — covers the fields Solidarity actually
 * imports (FN, N, EMAIL, TEL, ORG, TITLE, NOTE, PHOTO). Mirrors what
 * Swift's ContactImportService extracts from the iOS Contacts framework
 * + .vcf documents.
 *
 * Not a full vCard parser — we ignore VERSION/SOURCE/UID/REV and any
 * structured X- extensions. Keep it small; the failure mode for unknown
 * fields is "silently skip", which matches the Swift importer.
 */

export interface ParsedVCard {
  readonly fullName: string;
  readonly givenName?: string;
  readonly familyName?: string;
  readonly emails: readonly string[];
  readonly phones: readonly string[];
  readonly organization?: string;
  readonly title?: string;
  readonly note?: string;
  /** Base64 photo bytes; undefined if BEGIN:VCARD had no PHOTO line. */
  readonly photoBase64?: string;
}

function unfold(input: string): string {
  // RFC 6350: a line beginning with a single space/tab continues the prior line.
  return input.replace(/\r?\n[ \t]/gu, '');
}

function parseLines(input: string): readonly { key: string; value: string }[] {
  return unfold(input)
    .split(/\r?\n/u)
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      const colonIdx = line.indexOf(':');
      if (colonIdx === -1) return null;
      const lhs = line.slice(0, colonIdx);
      const value = line.slice(colonIdx + 1);
      const semi = lhs.indexOf(';');
      const key = (semi === -1 ? lhs : lhs.slice(0, semi)).toUpperCase();
      return { key, value };
    })
    .filter((x): x is { key: string; value: string } => x !== null);
}

export function parseVCard(input: string): ParsedVCard | null {
  if (!input.includes('BEGIN:VCARD')) return null;
  const lines = parseLines(input);

  const get = (key: string): string | undefined =>
    lines.find((l) => l.key === key)?.value;
  const all = (key: string): readonly string[] =>
    lines.filter((l) => l.key === key).map((l) => l.value);

  const n = get('N')?.split(';') ?? [];
  const fn = get('FN') ?? [n[1], n[0]].filter(Boolean).join(' ');

  return {
    fullName: fn,
    familyName: n[0] || undefined,
    givenName: n[1] || undefined,
    emails: all('EMAIL'),
    phones: all('TEL'),
    organization: get('ORG'),
    title: get('TITLE'),
    note: get('NOTE'),
    photoBase64: get('PHOTO'),
  };
}

/** Parse multiple BEGIN:VCARD…END:VCARD blocks from a single .vcf payload. */
export function parseVCardBundle(input: string): readonly ParsedVCard[] {
  const blocks = input.split(/(?=BEGIN:VCARD)/gu).filter((b) => b.includes('BEGIN:VCARD'));
  return blocks.map(parseVCard).filter((c): c is ParsedVCard => c !== null);
}
