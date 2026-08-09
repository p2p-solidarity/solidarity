import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';

import en from '../../src/i18n/locales/en.json';
import zhHant from '../../src/i18n/locales/zh-Hant.json';

const enCatalog: Readonly<Record<string, string>> = en;
const zhHantCatalog: Readonly<Record<string, string>> = zhHant;

const source = (relativePath: string): string =>
  readFileSync(new URL(relativePath, import.meta.url), 'utf8');

describe('v2 Contacts surface', () => {
  it('uses the exact normal and selection header order', () => {
    const people = source('../../app/(tabs)/people/index.tsx');
    const header = people.slice(
      people.indexOf('function ContactsHeader'),
      people.indexOf('function EmptyState'),
    );

    expect(header).toContain("t('peopleList.select')");
    expect(header).toContain("t('peopleList.title')");
    expect(header).toContain("t('peopleList.add')");
    expect(header).toContain("t('peopleList.done')");
    expect(header).toContain("t('peopleList.selectAll')");
    expect(header).toContain("t('peopleList.deselectAll')");

    const normal = header.slice(header.indexOf('if (!editMode)'));
    expect(normal.indexOf("t('peopleList.select')")).toBeLessThan(
      normal.indexOf("t('peopleList.title')"),
    );
    expect(normal.indexOf("t('peopleList.title')")).toBeLessThan(
      normal.indexOf("t('peopleList.add')"),
    );
  });

  it('orders search, real contacts, Saved Pages, then the selection action bar', () => {
    const people = source('../../app/(tabs)/people/index.tsx');

    expect(people).toContain('<PeopleSearchField');
    expect(people).toContain('<FlashList');
    expect(people).toContain(
      'ListFooterComponent={editMode ? null : <VerifiedPagesSection />}',
    );
    expect(people).toContain('<EmptyContactsContent');
    expect(people).toContain('<BatchActionBar');
    expect(people).not.toMatch(/LeaveCards|RecentUpdates|peopleList\.inbox|peopleList\.feed/u);
  });

  it('keeps Add Contact first in the empty state and orders add-sheet actions by priority', () => {
    const people = source('../../app/(tabs)/people/index.tsx');
    const addSheet = source('../../src/components/people/ContactsAddSheet.tsx');
    const empty = people.slice(
      people.indexOf('function EmptyState'),
      people.indexOf('function EmptySearchState'),
    );

    expect(empty.indexOf("t('peopleList.add')")).toBeLessThan(
      empty.indexOf("t('peopleList.importFromPhone')"),
    );

    const orderedKeys = [
      'peopleList.scanTheirQr',
      'peopleList.enterByHand',
      'peopleList.importFromPhone',
      'peopleList.importVcfFile',
      'peopleList.pasteLinkPage',
    ] as const;
    const positions = orderedKeys.map((key) => addSheet.indexOf(`t('${key}')`));
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));

    const noResults = people.slice(
      people.indexOf('function EmptySearchState'),
      people.indexOf('function filterContacts'),
    );
    expect(noResults).toContain("t('peopleList.add')");
    expect(noResults).toContain("t('peopleList.importFromPhone')");
  });

  it('hydrates selected encrypted details before one real vCard share', () => {
    const people = source('../../app/(tabs)/people/index.tsx');

    expect(people).toContain("from '@/contacts/vCardBundle'");
    expect(people).toContain('orderedContacts.filter');
    expect(people).toContain('prepareContactVCardBundle(ids, loadDetail)');
    expect(people).toContain('FileSystem.writeAsStringAsync');
    expect(people).toContain('FileSystem.EncodingType.UTF8');
    expect(people).toContain('Sharing.isAvailableAsync()');
    expect(people).toContain('Sharing.shareAsync');
    expect(people).toContain("mimeType: 'text/vcard'");
    expect(people).toContain("UTI: 'public.vcard'");
    expect(people).toContain('.vcf`');
    expect(people).not.toContain('toVCard(');
  });

  it('lists every selected name and states deletion consequences without fake Undo', () => {
    const sheet = source('../../src/components/people/DeleteContactsSheet.tsx');

    expect(sheet).toContain('contacts.map');
    expect(sheet).toContain("t('peopleList.deleteCardsNotes')");
    expect(sheet).toContain("t('peopleList.deleteOthersUnaffected')");
    expect(sheet).toContain("t('peopleList.deleteNoUndo')");
    expect(sheet).not.toMatch(/onUndo|undoLabel/u);
  });

  it('ships canonical v2 Contacts vocabulary in zh-Hant and English', () => {
    const expected = {
      'peopleList.title': ['Contacts', '聯絡人'],
      'peopleList.search': ['Search', '搜尋'],
      'peopleList.select': ['Select', '選取'],
      'peopleList.selectAll': ['Select All', '全選'],
      'peopleList.deselectAll': ['Deselect All', '取消全選'],
      'peopleList.done': ['Done', '完成'],
      'peopleList.countSelected': ['{{count}} Selected', '已選 {{count}} 位'],
      'peopleList.exportVCard': ['Export vCard', '匯出 vCard'],
      'peopleList.emptyTitle': ['No Contacts Yet', '還沒有聯絡人'],
      'peopleList.emptyBody': [
        "People you've exchanged cards with appear here, and their details update themselves.",
        '交換過的人會出現在這裡，對方改了資料會自己更新。',
      ],
      'peopleList.add': ['Add Contact', '新增聯絡人'],
      'peopleList.scanTheirQr': ['Scan Their QR', '掃描對方的 QR'],
      'peopleList.enterByHand': ['Enter It by Hand', '手動輸入'],
      'peopleList.importFromPhone': ['Import from Address Book', '從通訊錄匯入'],
      'peopleList.importVcfFile': ['Import VCF File', '匯入 VCF 檔案'],
      'peopleList.pasteLinkPage': ['Paste Link Page', '貼上連結頁'],
      'peopleList.savedPagesHeader': ['Saved Pages', '已儲存頁面'],
    } as const;

    for (const [key, [english, chinese]] of Object.entries(expected)) {
      expect(enCatalog[key]).toBe(english);
      expect(zhHantCatalog[key]).toBe(chinese);
    }
  });
});
