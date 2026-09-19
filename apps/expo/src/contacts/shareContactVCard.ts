import { shareVCard } from '@/cards/shareVCard';
import {
  prepareContactVCardBundle,
  type ContactDetailLoader,
} from '@/contacts/vCardBundle';

/** Share one or more fully hydrated contacts through the native vCard sheet. */
export async function shareContactVCard(
  contactIds: readonly string[],
  loadDetail: ContactDetailLoader,
  dialogTitle: string,
): Promise<void> {
  const bundle = await prepareContactVCardBundle(contactIds, loadDetail);
  await shareVCard(bundle, dialogTitle);
}
