import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';

const source = (relativePath: string): string =>
  readFileSync(new URL(relativePath, import.meta.url), 'utf8');

describe('contact mutation failure surfaces', () => {
  it('shares a complete vCard from the top bar without a duplicate hero edit control', () => {
    const detail = source('../../app/people/[id].tsx');

    expect(detail).toContain("from '@/contacts/shareContactVCard'");
    expect(detail).toContain('await shareContactVCard([target.id], loadDetail');
    expect(detail).not.toContain('Share.share');
    expect(detail).not.toContain('function HeroEditButton');
    expect(detail).not.toContain('<HeroEditButton');
    expect(detail).toContain('<HeroNoteLine note={note} onEditNote={onEditNote} />');
  });

  it('awaits detail deletion before navigating and reports persistence failure', () => {
    const detail = source('../../app/people/[id].tsx');
    const handler = detail.slice(detail.indexOf('const onDelete'), detail.indexOf('return ('));

    expect(handler).toContain('await remove(target.id)');
    expect(handler).toContain("t('peopleList.contactDeleted')");
    expect(handler).toContain("summary: t('peopleList.deleteFailed')");
    expect(handler.indexOf('await remove(target.id)')).toBeLessThan(handler.indexOf('safeBack()'));
  });

  it('keeps manual and edit sheets open when persistence rejects', () => {
    const cases = [
      ['../../src/components/people/ManualContactEntrySheet.tsx', 'await upsert(contact)'],
      ['../../src/components/people/EditContactSheet.tsx', 'await upsert(next)'],
    ] as const;

    for (const [path, mutation] of cases) {
      const file = source(path);
      expect(file).toContain('const [saving, setSaving] = useState(false)');
      expect(file).toContain(mutation);
      expect(file).toContain('showError({');
      expect(file).toContain('setSaving(false)');
    }
  });
});
