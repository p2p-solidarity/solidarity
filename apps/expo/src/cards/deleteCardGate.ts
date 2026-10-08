/**
 * The Face ID gate every card-deletion surface passes — the cards list's
 * long-press sheet and the edit screen alike. One helper so the two cannot
 * drift: the first cut gated only the edit screen, which left long-press →
 * Delete on the list un-gated while the Security screen implied otherwise.
 *
 * Deleting a card is ACCESS-LEVEL, so it follows the user's Face ID mode
 * (`exportGraph` tier) rather than the red line: a card is recoverable from a
 * dated archive, and the Security footer promises exactly four always-ask
 * actions. The mapping is recorded in `src/keychain/sensitiveActionPolicy.ts`.
 *
 * The gate lives at the surface, never in `cardManager`: restore and sync
 * reconcile records through the store and must not raise a Face ID sheet.
 */
import type { TFunction } from 'i18next';

import { pushToast } from '@/feedback/toast';
import { requireSensitiveAction } from '@/keychain';

/** True when the user may proceed; on refusal the reason has been toasted. */
export async function authorizeCardDeletion(t: TFunction): Promise<boolean> {
  const gate = await requireSensitiveAction('exportGraph', t('security.prompt.deleteCard'));
  if (gate.success) return true;
  pushToast(t(`security.error.${gate.reason}`), 'warning');
  return false;
}
