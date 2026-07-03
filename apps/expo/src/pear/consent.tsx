/**
 * Pear card-request consent sheet — A5.2. Mirrors `feedback/confirmDialog.tsx`'s
 * imperative-queue pattern: `askCardConsent(peerLabel)` pushes a request and
 * returns a Promise the caller (`cardRelease.ts`'s composed handler, via
 * `useCardExchange.ts`) awaits; `<PearConsentOverlay />` (mounted once in
 * `app/_layout.tsx`, alongside `ConfirmDialogOverlay`/`AppAlertOverlay`)
 * renders whatever's at the head of the queue. FIFO queue rather than a
 * single slot for the same reason `confirmDialog`'s doc gives — simpler to
 * reason about than racy replacement, even though in practice this app's
 * "reachable" mode (`useCardExchange.ts`) only ever has one peer's session
 * live at a time, so more than one queued request would be unusual.
 *
 * HONESTY (CLAUDE.md rule 8 + this task's brief — "the consent sheet must
 * show WHO is asking using only VERIFIED identity"): this module receives
 * only a pre-formatted `peerLabel` STRING from its caller — never a did,
 * never a raw wire frame. `protocol.ts`'s `CardRequestHandler` type takes NO
 * arguments at all (`() => Promise<CardRequestHandlerResult>`), so there is
 * structurally no wire-supplied display data available to leak here even by
 * accident. The caller is responsible for building that label via
 * `cardRelease.ts`'s `formatPeerLabel(peerDid, verifiedDisplayName)` — a
 * verified display name (from a `VerifiedSnapshot` this device already
 * checked) or the short did, never anything claimed over the channel.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { create } from 'zustand';

import { SfIcon } from '@/components/icons/SfIcon';
import { ThemedButton, ThemedSurface, ThemedText } from '@/components/themed';
import { Colors } from '@/constants/Colors';
import { useTranslation } from '@/i18n';

import type { ConsentDecision } from './cardRelease';
import type { PresentableClaim } from './presentBuilder';
import type { PresentConsentDecision } from './presentRelease';

interface ConsentRequest {
  readonly id: number;
  readonly peerLabel: string;
  readonly resolve: (decision: ConsentDecision) => void;
}

interface ConsentStore {
  readonly queue: readonly ConsentRequest[];
  readonly push: (req: Omit<ConsentRequest, 'id'>) => void;
  readonly resolveHead: (decision: ConsentDecision) => void;
}

let nextId = 1;

/** Absorbs taps on the card so they don't bubble to the dismiss backdrop. */
const absorbPress = (): void => undefined;

const useConsentStore = create<ConsentStore>((set, get) => ({
  queue: [],
  push: (req) => {
    set((s) => ({ queue: [...s.queue, { ...req, id: nextId++ }] }));
  },
  resolveHead: (decision) => {
    const head = get().queue[0];
    if (!head) return;
    head.resolve(decision);
    set((s) => ({ queue: s.queue.slice(1) }));
  },
}));

/**
 * Show the consent sheet for an incoming `card.request` from `peerLabel`
 * (see module doc re: what that string is allowed to contain). Resolves
 * once the user taps Share or Decline — dismissing the sheet (backdrop tap
 * / hardware back) counts as Decline, matching "a decline path must always
 * be reachable" and never defaulting to an implicit share.
 */
export function askCardConsent(peerLabel: string): Promise<ConsentDecision> {
  return new Promise((resolve) => {
    useConsentStore.getState().push({ peerLabel, resolve });
  });
}

/** Mount once near the top of `app/_layout.tsx`. */
export function PearConsentOverlay(): ReactNode {
  const head = useConsentStore((s) => s.queue[0]);
  const resolveHead = useConsentStore((s) => s.resolveHead);
  const { t } = useTranslation();

  const onDecline = (): void => {
    resolveHead('decline');
  };
  const onShare = (): void => {
    resolveHead('share');
  };

  return (
    <Modal
      transparent
      visible={head !== undefined}
      animationType="fade"
      onRequestClose={onDecline}
      statusBarTranslucent
    >
      {head ? (
        <View style={styles.root}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={onDecline}
            accessibilityLabel="Dismiss"
          />
          <Pressable onPress={absorbPress} style={styles.cardWrap}>
            <ThemedSurface variant="elevated" padded>
              <ThemedText variant="titleMedium" style={styles.title}>
                {t('pearExchange.consent.title', { name: head.peerLabel })}
              </ThemedText>
              <ThemedText variant="bodyMedium" tone="secondary" style={styles.message}>
                {t('pearExchange.consent.message')}
              </ThemedText>
              <View style={styles.actions}>
                <ThemedButton
                  label={t('pearExchange.consent.decline')}
                  variant="secondary"
                  fullWidth
                  onPress={onDecline}
                />
                <ThemedButton
                  label={t('pearExchange.consent.share')}
                  variant="primary"
                  fullWidth
                  onPress={onShare}
                />
              </View>
            </ThemedSurface>
          </Pressable>
        </View>
      ) : null}
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  cardWrap: {
    width: '100%',
    paddingHorizontal: 32,
  },
  title: {
    marginBottom: 8,
  },
  message: {
    marginBottom: 20,
  },
  actions: {
    gap: 10,
  },
});

/**
 * Pear present-request consent sheet — A5.3. Same imperative-queue pattern
 * as `askCardConsent` above (see that function's doc for the FIFO-vs-single-
 * slot reasoning and the "only verified identity is ever shown" honesty
 * contract, both unchanged here), extended with the one thing a present
 * request needs that a card request doesn't: SELECTIVE DISCLOSURE — the
 * user picks WHICH of the matched claims to actually disclose, not just
 * yes/no. `presentRelease.ts`'s `makePresentRequestHandler` already
 * guarantees `getMatchedClaims` ran (and found at least one match) before
 * this sheet is ever shown — see that module's doc.
 */
interface PresentConsentRequest {
  readonly id: number;
  readonly peerLabel: string;
  readonly claims: readonly PresentableClaim[];
  readonly resolve: (decision: PresentConsentDecision) => void;
}

interface PresentConsentStore {
  readonly queue: readonly PresentConsentRequest[];
  readonly push: (req: Omit<PresentConsentRequest, 'id'>) => void;
  readonly resolveHead: (decision: PresentConsentDecision) => void;
}

let nextPresentId = 1;

const usePresentConsentStore = create<PresentConsentStore>((set, get) => ({
  queue: [],
  push: (req) => {
    set((s) => ({ queue: [...s.queue, { ...req, id: nextPresentId++ }] }));
  },
  resolveHead: (decision) => {
    const head = get().queue[0];
    if (!head) return;
    head.resolve(decision);
    set((s) => ({ queue: s.queue.slice(1) }));
  },
}));

/**
 * Show the claim-selection consent sheet for an incoming `present.request`
 * from `peerLabel`, offering exactly `claims` (already filtered to what
 * this device can actually present — `presentBuilder.ts`'s
 * `matchPresentableClaims`, never wire-supplied). Resolves once the user
 * taps Share (with a selection) or Decline; dismissing the sheet counts as
 * Decline, matching `askCardConsent`'s "a decline path must always be
 * reachable" rule.
 */
export function askPresentConsent(
  peerLabel: string,
  claims: readonly PresentableClaim[]
): Promise<PresentConsentDecision> {
  return new Promise((resolve) => {
    usePresentConsentStore.getState().push({ peerLabel, claims, resolve });
  });
}

/** Mount once near the top of `app/_layout.tsx`, alongside `PearConsentOverlay`. */
export function PearPresentConsentOverlay(): ReactNode {
  const head = usePresentConsentStore((s) => s.queue[0]);
  const resolveHead = usePresentConsentStore((s) => s.resolveHead);
  const { t } = useTranslation();

  // Selection state is keyed to the head request's id so a NEW request
  // always starts from a fresh default (every matched claim pre-selected —
  // same "select everything by default, let the user narrow it" pattern
  // `credentials/presentationProof.ts`'s `initialPresentationClaimIds`
  // already uses for the OIDC present flow), never carrying over a
  // previous request's selection.
  const [forId, setForId] = useState<number | null>(null);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());

  useEffect(() => {
    if (head && head.id !== forId) {
      setSelected(new Set(head.claims.map((c) => c.id)));
      setForId(head.id);
    }
  }, [head, forId]);

  const toggle = (id: string): void => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const onDecline = (): void => {
    resolveHead({ decision: 'decline' });
  };
  const onShare = (): void => {
    resolveHead({ decision: 'share', selectedClaimIds: [...selected] });
  };

  return (
    <Modal
      transparent
      visible={head !== undefined}
      animationType="fade"
      onRequestClose={onDecline}
      statusBarTranslucent
    >
      {head ? (
        <View style={styles.root}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={onDecline}
            accessibilityLabel="Dismiss"
          />
          <Pressable onPress={absorbPress} style={styles.cardWrap}>
            <ThemedSurface variant="elevated" padded>
              <ThemedText variant="titleMedium" style={styles.title}>
                {t('pearExchange.presentConsent.title', {
                  name: head.peerLabel,
                  claims: head.claims.map((c) => c.title).join(', '),
                })}
              </ThemedText>
              <ThemedText variant="bodyMedium" tone="secondary" style={styles.message}>
                {t('pearExchange.presentConsent.message')}
              </ThemedText>
              <View style={{ gap: 4, marginBottom: 20 }}>
                {head.claims.map((claim) => {
                  const isOn = selected.has(claim.id);
                  return (
                    <Pressable
                      key={claim.id}
                      onPress={() => {
                        toggle(claim.id);
                      }}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: isOn }}
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: 10,
                        paddingVertical: 8,
                      }}
                    >
                      <SfIcon
                        name={isOn ? 'checkmark.square.fill' : 'square'}
                        size={18}
                        color={isOn ? Colors.accentRose : Colors.text3}
                      />
                      <ThemedText variant="bodyMedium" style={{ flex: 1 }}>
                        {claim.title}
                      </ThemedText>
                    </Pressable>
                  );
                })}
              </View>
              <View style={styles.actions}>
                <ThemedButton
                  label={t('pearExchange.presentConsent.decline')}
                  variant="secondary"
                  fullWidth
                  onPress={onDecline}
                />
                <ThemedButton
                  label={t('pearExchange.presentConsent.share')}
                  variant="primary"
                  fullWidth
                  disabled={selected.size === 0}
                  onPress={onShare}
                />
              </View>
            </ThemedSurface>
          </Pressable>
        </View>
      ) : null}
    </Modal>
  );
}
