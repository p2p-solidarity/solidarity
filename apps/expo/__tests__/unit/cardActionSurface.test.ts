import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';

const source = (relativePath: string): string =>
  readFileSync(new URL(relativePath, import.meta.url), 'utf8');

describe('business-card actions', () => {
  it('awaits deletion before closing the actions sheet and exposes failure', () => {
    const sheet = source('../../src/components/cards/BusinessCardActionsSheet.tsx');
    const cards = source('../../app/cards/index.tsx');

    expect(sheet).toContain('await onDelete(card)');
    expect(sheet.indexOf('await onDelete(card)')).toBeLessThan(sheet.indexOf('onClose();'));
    expect(sheet).toContain('showError({');
    expect(cards).toContain('await remove(card.id)');
  });

  it('hydrates the selected card and shares a real vCard instead of its display name', () => {
    const cards = source('../../app/cards/index.tsx');
    const contactShare = source('../../src/contacts/shareContactVCard.ts');
    const vCardShare = source('../../src/cards/shareVCard.ts');

    expect(cards).toContain('await loadDetail(card.id)');
    expect(cards).toContain('await shareVCard(toVCard(detail)');
    expect(cards).not.toContain('Share.share');
    expect(contactShare).toContain('await shareVCard(bundle, dialogTitle)');
    expect(vCardShare).toContain('FileSystem.writeAsStringAsync');
    expect(vCardShare).toContain('Sharing.shareAsync');
    expect(vCardShare).toContain("mimeType: 'text/vcard'");
  });
});
