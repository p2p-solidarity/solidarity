export type BadgeRecoveryAction = 'retry' | 'republish' | 'reconnectBluesky';

export interface BadgeRecoveryEvidence {
  readonly platform: 'nostr' | 'bluesky';
  readonly visual: 'verified' | 'declared' | 'stale';
  readonly direction1: boolean;
  readonly direction2: boolean | null;
}

/**
 * Maps the verifier's existing evidence to recovery actions. This does not
 * reinterpret badge state: unknown reverse evidence remains a retry, while an
 * observed missing reverse copy can offer the platform's existing repair flow.
 */
export function badgeRecoveryActions(
  evidence: BadgeRecoveryEvidence
): readonly BadgeRecoveryAction[] {
  if (evidence.visual === 'verified') return [];

  const actions: BadgeRecoveryAction[] = ['retry'];
  if (evidence.platform === 'nostr' && evidence.direction2 === false) {
    actions.push('republish');
  }
  if (evidence.platform === 'bluesky' && (!evidence.direction1 || evidence.direction2 === false)) {
    actions.push('reconnectBluesky');
  }
  return actions;
}
