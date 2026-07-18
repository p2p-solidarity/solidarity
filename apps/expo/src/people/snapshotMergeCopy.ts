/**
 * UI copy mapping for a `SnapshotMergeOutcome` (T5) — the ONE honest place
 * that turns "what the freshness/conflict merge actually did" into a toast
 * message + tone. Shared by every surface that saves a verified page
 * (`VerifiedPageResultSheet`, `PearConnectSection`, `CardExchangeSection`)
 * so none of them can drift into always claiming "Saved" when the merge in
 * fact kept a newer local copy or flagged a conflict (CLAUDE.md rule 8).
 *
 * Pure: takes the outcome kind, returns an i18n key + `ToastTone`. The caller
 * resolves the key via `t(...)` and calls `pushToast`. `ToastTone` is a
 * type-only import, so this module pulls no React Native runtime.
 */
import type { ToastTone } from '@/feedback/toast';
import type { SnapshotMergeOutcome } from '@/people/profileSnapshots';

export interface SnapshotMergeToast {
  readonly i18nKey: string;
  readonly tone: ToastTone;
}

export function snapshotMergeToast(kind: SnapshotMergeOutcome['kind']): SnapshotMergeToast {
  switch (kind) {
    case 'saved':
      return { i18nKey: 'snapshotMerge.saved', tone: 'success' };
    case 'alreadyCurrent':
      return { i18nKey: 'snapshotMerge.alreadyCurrent', tone: 'success' };
    case 'keptNewer':
      return { i18nKey: 'snapshotMerge.keptNewer', tone: 'info' };
    case 'conflict':
      return { i18nKey: 'snapshotMerge.conflict', tone: 'warning' };
  }
}
