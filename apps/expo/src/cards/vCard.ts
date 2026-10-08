/**
 * Minimal vCard 3.0 writer — mirrors Swift BusinessCard.vCardData. Used
 * only for FILE sharing (`shareVCard` → OS share sheet / AirDrop as a
 * .vcf importable into iOS Contacts / Google Contacts) — it is never
 * rendered into a QR, and the scanner has no vCard parser
 * (`scan/envelopeHandler.ts` routes `BEGIN:VCARD` to raw). See
 * docs/ref/05-spec-qr-exchange.md §6-2.
 */
import type { BusinessCard } from '@solidarity/shared';

export function toVCard(card: BusinessCard): string {
  const lines: string[] = ['BEGIN:VCARD', 'VERSION:3.0'];
  lines.push(`FN:${escape(card.name)}`);
  if (card.title) lines.push(`TITLE:${escape(card.title)}`);
  if (card.company) lines.push(`ORG:${escape(card.company)}`);
  if (card.email) lines.push(`EMAIL;TYPE=INTERNET:${escape(card.email)}`);
  if (card.phone) lines.push(`TEL:${escape(card.phone)}`);
  lines.push('END:VCARD');
  return lines.join('\n');
}

function escape(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;');
}
