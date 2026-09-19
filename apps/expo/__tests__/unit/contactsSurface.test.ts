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

  it('orders search, real pending activity, recent updates, then contacts', () => {
    const people = source('../../app/(tabs)/people/index.tsx');
    const activity = source('../../src/components/people/ContactsActivitySections.tsx');
    const snapshots = source('../../src/people/profileSnapshots.ts');
    const notifications = source('../../app/settings/notifications.tsx');
    const normalContent = people.slice(
      people.indexOf('<PeopleSearchField'),
      people.indexOf('<BatchActionBar'),
    );

    expect(people).toContain('<PeopleSearchField');
    expect(people).toContain("import { ContactsActivitySections } from '@/components/people/ContactsActivitySections'");
    expect(normalContent).toContain('<ContactsActivitySections');
    expect(people).toContain('<FlashList');
    expect(people).toContain('<EmptyContactsContent');
    expect(people).toContain('<BatchActionBar');
    expect(normalContent.indexOf('<PeopleSearchField')).toBeLessThan(
      normalContent.indexOf('<ContactsActivitySections'),
    );
    expect(normalContent.indexOf('<ContactsActivitySections')).toBeLessThan(
      normalContent.indexOf('<FlashList'),
    );

    // Neither v2 activity surface may invent content before its persisted
    // source has successfully hydrated.
    expect(activity).toContain("pendingStatus === 'ready' && pending.length > 0");
    expect(activity).toContain("updatesStatus === 'ready' && enabled && updates.length > 0");
    expect(activity).toContain('contactFromLeaveCard');
    expect(activity).toContain('accept');
    expect(activity).toContain('skip');
    expect(activity).toContain('block');
    expect(activity).not.toContain('receiverNotConnected');

    // A feed item is created only by a newly saved, already-known profile
    // snapshot — not by a first scan, a stale result, or the screen itself.
    expect(snapshots).toContain("if (existing && outcome.kind === 'saved')");
    expect(snapshots).toContain('recordMerge(existing.record, record)');
    expect(activity).not.toContain('recordMerge(');

    // Closing the feed is reversible through the notifications setting; reset
    // returns it to the product default (enabled).
    expect(notifications).toContain("from '@/contacts/recentUpdates'");
    expect(notifications).toContain('const recentUpdatesEnabled = useRecentUpdatesStore');
    expect(notifications).toContain("title={t('notifications.contactUpdates.title')}");
    expect(notifications).toContain('setRecentUpdatesEnabled(true)');
  });

  it('uses the mock’s square contact rows and compact pending/update treatments', () => {
    const row = source('../../src/components/people/TrustGraphContactRow.tsx');
    const activity = source('../../src/components/people/ContactsActivitySections.tsx');
    const search = source('../../src/components/people/PeopleSearchField.tsx');

    expect(row).toContain('borderBottomWidth: 0.5');
    expect(row).toContain('borderRadius: 0');
    expect(activity).toContain('borderRadius: 0');
    expect(activity).toContain('borderWidth: 0.5');
    expect(search).toContain('borderRadius: 12');
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
    expect(noResults).toContain('<ThemedText');
    expect(noResults).not.toMatch(/<Text(?:\s|>)/u);
  });

  it('turns a hydration rejection into an explicit retryable error state', () => {
    const people = source('../../app/(tabs)/people/index.tsx');
    const hook = source('../../src/people/usePeopleScreen.ts');

    expect(hook).toContain('readonly error: boolean');
    expect(hook).toContain('readonly retry: () => void');
    expect(hook).toContain('setLoadError(true)');
    expect(people).toContain('const { contacts, loading, error, refresh, retry } = usePeopleScreen()');
    expect(people).toContain('error ? (');
    expect(people).toContain('<ContactsLoadError onRetry={retry} />');
    expect(people).toContain("t('peopleList.loadErrorTitle')");
    expect(people).toContain("t('peopleList.loadErrorBody')");
    expect(people).toContain("t('peopleList.tryAgain')");
  });

  it('hydrates selected encrypted details before one real vCard share', () => {
    const people = source('../../app/(tabs)/people/index.tsx');
    const share = source('../../src/contacts/shareContactVCard.ts');
    const vCardShare = source('../../src/cards/shareVCard.ts');

    expect(people).toContain("from '@/contacts/shareContactVCard'");
    expect(people).toContain('orderedContacts.filter');
    expect(people).toContain('shareContactVCard(ids, loadDetail');
    expect(share).toContain('prepareContactVCardBundle(contactIds, loadDetail)');
    expect(vCardShare).toContain('FileSystem.writeAsStringAsync');
    expect(vCardShare).toContain('FileSystem.EncodingType.UTF8');
    expect(vCardShare).toContain('Sharing.isAvailableAsync()');
    expect(vCardShare).toContain('Sharing.shareAsync');
    expect(vCardShare).toContain("mimeType: 'text/vcard'");
    expect(vCardShare).toContain("UTI: 'public.vcard'");
    expect(vCardShare).toContain("'solidarity-contacts.vcf'");
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
      'peopleList.pendingCount': ['{{count}} Cards Pending', '{{count}} 張留卡待確認'],
      'peopleList.recentUpdates': ['Recent Updates', '最近更新'],
      'peopleList.turnOffRecentUpdates': ['Turn Off Recent Updates', '關閉最近更新'],
      'peopleList.noCardsPending': ['No Cards Pending', '沒有待確認的留卡'],
      'notifications.contactUpdates.title': ['Show Recent Updates', '顯示「最近更新」'],
    } as const;

    for (const [key, [english, chinese]] of Object.entries(expected)) {
      expect(enCatalog[key]).toBe(english);
      expect(zhHantCatalog[key]).toBe(chinese);
    }
  });
});
