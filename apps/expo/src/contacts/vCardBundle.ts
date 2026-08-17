import { toVCard } from '@/cards/vCard';
import type { Contact } from '@solidarity/shared';

export type ContactDetailLoader = (id: string) => Promise<Contact | null>;

/**
 * Hydrate every selected encrypted Contact before producing one complete vCard
 * bundle. Promise.all invokes every requested loader immediately while
 * retaining the caller's selection order in the resolved array.
 */
export async function prepareContactVCardBundle(
  selectedContactIds: readonly string[],
  loadDetail: ContactDetailLoader,
): Promise<string> {
  const contacts = await Promise.all(
    selectedContactIds.map(async (id) => {
      const contact = await loadDetail(id);
      if (contact === null) throw new Error(`Contact detail unavailable: ${id}`);
      return contact;
    }),
  );

  return contacts.map((contact) => toVCard(contact.businessCard)).join('\n');
}
