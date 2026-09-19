import { useMemo, type ReactElement, type ReactNode } from 'react';
import { View } from 'react-native';
import { FlashList } from '@shopify/flash-list';

import { ThemedText } from '@/components/themed';
import type { ContactManifestEntry } from '@/contacts/repository';

export interface ContactSection {
  readonly title: string;
  readonly contacts: readonly ContactManifestEntry[];
}

export type ContactListItem =
  | { readonly kind: 'header'; readonly key: string; readonly title: string }
  | { readonly kind: 'contact'; readonly key: string; readonly contact: ContactManifestEntry };

const NAME_COLLATOR = new Intl.Collator('en', {
  usage: 'sort',
  sensitivity: 'base',
  numeric: true,
});

/**
 * Filter and group contacts for the A–Z list.
 *
 * Sorting rules are intentionally locale-stable: trim the name, fold Latin
 * diacritics (so “Élodie” belongs under E), group ASCII A–Z first, and put
 * every non-Latin/unnamed contact in one trailing “#” section. Names within a
 * section use case-insensitive natural ordering, with the opaque id as the
 * deterministic tie-breaker.
 */
export function groupContactsByInitial(
  contacts: readonly ContactManifestEntry[],
  query: string,
): readonly ContactSection[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const matching = normalizedQuery.length === 0
    ? contacts
    : contacts.filter((contact) => {
        const searchable = [contact.name, contact.company, contact.title]
          .filter((value): value is string => typeof value === 'string')
          .join('\n')
          .toLocaleLowerCase();
        return searchable.includes(normalizedQuery);
      });

  const sorted = [...matching].sort((a, b) => {
    const sectionOrder = compareSectionTitles(sectionTitle(a.name), sectionTitle(b.name));
    if (sectionOrder !== 0) return sectionOrder;
    const nameOrder = NAME_COLLATOR.compare(a.name.trim(), b.name.trim());
    return nameOrder !== 0 ? nameOrder : a.id.localeCompare(b.id);
  });

  const sections: { title: string; contacts: ContactManifestEntry[] }[] = [];
  for (const contact of sorted) {
    const title = sectionTitle(contact.name);
    const current = sections[sections.length - 1];
    if (current?.title === title) current.contacts.push(contact);
    else sections.push({ title, contacts: [contact] });
  }
  return sections;
}

export interface ContactsListProps {
  readonly sections: readonly ContactSection[];
  readonly renderContact: (contact: ContactManifestEntry) => ReactElement | null;
  readonly showSectionHeaders: boolean;
  readonly bottomInset?: number;
  readonly extraData?: unknown;
}

export function ContactsList({
  sections,
  renderContact,
  showSectionHeaders,
  bottomInset = 16,
  extraData,
}: ContactsListProps): ReactNode {
  const data = useMemo(
    () => flattenContactSections(sections, showSectionHeaders),
    [sections, showSectionHeaders],
  );

  return (
    <FlashList
      data={data}
      keyExtractor={(item) => item.key}
      getItemType={(item) => item.kind}
      contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: bottomInset }}
      keyboardShouldPersistTaps="handled"
      extraData={extraData}
      renderItem={({ item }) => item.kind === 'header'
        ? <ContactSectionHeader title={item.title} />
        : renderContact(item.contact)}
    />
  );
}

export function flattenContactSections(
  sections: readonly ContactSection[],
  showSectionHeaders: boolean,
): readonly ContactListItem[] {
  return sections.flatMap<ContactListItem>((section) => [
    ...(showSectionHeaders
      ? [{ kind: 'header' as const, key: `header:${section.title}`, title: section.title }]
      : []),
    ...section.contacts.map((contact) => ({
      kind: 'contact' as const,
      key: contact.id,
      contact,
    })),
  ]);
}

export function ContactSectionHeader({ title }: { readonly title: string }): ReactNode {
  return (
    <View style={{ minHeight: 34, justifyContent: 'flex-end', paddingBottom: 4 }}>
      <ThemedText variant="label" tone="secondary">
        {title}
      </ThemedText>
    </View>
  );
}

function sectionTitle(name: string): string {
  const first = name
    .trim()
    .normalize('NFKD')
    .replace(/\p{Mark}/gu, '')
    .charAt(0)
    .toUpperCase();
  return /^[A-Z]$/u.test(first) ? first : '#';
}

function compareSectionTitles(a: string, b: string): number {
  if (a === b) return 0;
  if (a === '#') return 1;
  if (b === '#') return -1;
  return a.localeCompare(b);
}
