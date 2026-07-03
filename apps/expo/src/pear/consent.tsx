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
import type { ReactNode } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { create } from 'zustand';

import { ThemedButton, ThemedSurface, ThemedText } from '@/components/themed';
import { useTranslation } from '@/i18n';

import type { ConsentDecision } from './cardRelease';

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
