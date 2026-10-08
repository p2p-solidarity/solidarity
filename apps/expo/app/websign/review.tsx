/**
 * webSign › Review — the consent screen for an App↔Web per-action signing
 * request (research notes-1.3.3 §4, grill G3/G4). A website (untrusted draft
 * surface) asks the app — the ONLY holder of the root key — to root-sign a
 * Profile Record. This screen:
 *   1. verifies the request (shared fail-closed boundary) and renders a
 *      per-field DIFF of what the draft changes vs the PROJECTION of the local
 *      record the website could see (a request built from the published page
 *      only ever saw the public links — `appSigner.ts`), including the signed
 *      Page layout;
 *   2. states honestly that the app CANNOT verify which website sent the
 *      request — the human-reviewed diff is the only security boundary (the
 *      web session signature proves payload integrity, not origin);
 *   3. gates approval on Face ID (the existing `getRootSigner()` signer), then
 *      root-signs the exact reviewed draft + the bound response envelope;
 *   4. offers both response channels (G3, action-selected): publish to Nostr
 *      via the existing save + publish path (the draft is folded over the
 *      links the website could not see, re-signed inside the same biometric
 *      grace window, and the web confirms by subscribing to 30078), and a
 *      response QR / copyable string for the offline / no-camera path.
 *
 * Data-driven states are exactly `error` (bad/expired/tampered request) or
 * `ready` (diff shown) — never a fabricated placeholder (CLAUDE.md Rule 8).
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { ScrollView, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PresentationProofQr } from '@/components/credentials/PresentationProofQr';
import { SettingsBackToolbar } from '@/components/settings/SettingsBlocks';
import { SfIcon } from '@/components/icons/SfIcon';
import { ThemedButton, ThemedSurface, ThemedText } from '@/components/themed';
import { Colors } from '@/constants/Colors';
import { showError } from '@/feedback/appAlert';
import { haptic } from '@/feedback/haptics';
import { pushToast } from '@/feedback/toast';
import { useTranslation } from '@/i18n';
import { getRootDid, getRootSigner } from '@/identity/rootKey';
import { buildPresentationQrPages } from '@/me/presentationQrPages';
import { safeBack } from '@/navigation/safeBack';
import {
  isBiometricCancellation,
  isNostrPublishOutcomeSuccessful,
  publishWithNostrAutoSetup,
} from '@/nostr/connectWizard';
import { DEFAULT_RELAYS } from '@/nostr/publish';
import { hasNostrKey, provisionFromRootMnemonic } from '@/nostr/userKey';
import { useProfileStore } from '@/profile/store';
import {
  approveWebSignRequest,
  reviewWebSignRequest,
  type WebSignDiff,
  type WebSignPageDiff,
  type WebSignPageItemRef,
  type WebSignReview,
} from '@/websign/appSigner';
import { useWebSignPending } from '@/websign/pendingRequest';
import { WEB_SIGN_MAX_AGE_SECONDS, type ProfileLink } from '@solidarity/shared';

type ReviewState =
  | { readonly kind: 'ready'; readonly review: WebSignReview }
  | { readonly kind: 'error'; readonly detail: string };

type Phase = 'review' | 'approving' | 'signed' | 'publishing' | 'published';

interface SignedResult {
  readonly profileJws: string;
  readonly responseJws: string;
}

/**
 * Reachable by every user (07-plan P3): the scanner and the deep-link router
 * hand a wrapped request here without a developer toggle. What protects the
 * root key is this screen — the diff and the Face ID prompt — not who can
 * open it.
 */
export default function WebSignReviewScreen(): ReactNode {
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();

  // Snapshot the handoff + current record once on mount. Everything the diff
  // and the merge need is captured here; nothing reactive can wipe it mid-flow.
  const [entry] = useState(() => {
    const pending = useWebSignPending.getState();
    const profile = useProfileStore.getState();
    return {
      requestJws: pending.requestJws,
      decodeError: pending.decodeError,
      currentRecord: profile.record,
      currentLinkVisibility: profile.linkVisibility,
    };
  });

  // Clear the handoff after the snapshot so a re-entry can't replay a stale
  // request (done in an effect, never during render).
  useEffect(() => {
    useWebSignPending.getState().clear();
  }, []);

  const state = useMemo<ReviewState>(() => {
    if (entry.decodeError !== null) return { kind: 'error', detail: entry.decodeError };
    if (entry.requestJws === null) return { kind: 'error', detail: 'no pending request' };
    const reviewed = reviewWebSignRequest(entry.requestJws, {
      currentRecord: entry.currentRecord,
      currentLinkVisibility: entry.currentLinkVisibility,
    });
    if (!reviewed.ok) return { kind: 'error', detail: reviewed.error.detail };
    return { kind: 'ready', review: reviewed.value };
  }, [entry]);

  const [phase, setPhase] = useState<Phase>('review');
  const [signed, setSigned] = useState<SignedResult | null>(null);

  const responsePages = useMemo(
    () => (signed ? buildPresentationQrPages(signed.responseJws) : []),
    [signed]
  );

  const onApprove = async (): Promise<void> => {
    if (state.kind !== 'ready') return;
    setPhase('approving');

    const didResult = await getRootDid();
    if (!didResult.ok) {
      setPhase('review');
      reportError(t, 'Root identity', didResult.error.kind);
      return;
    }
    const signerResult = await getRootSigner();
    if (!signerResult.ok) {
      setPhase('review');
      reportError(t, 'Root signer', signerResult.error.kind);
      return;
    }

    const iat = Math.floor(Date.now() / 1000);
    const approved = await approveWebSignRequest(state.review, {
      rootDid: didResult.value,
      rootSigner: signerResult.value,
      iat,
      exp: iat + WEB_SIGN_MAX_AGE_SECONDS,
    });
    if (!approved.ok) {
      setPhase('review');
      // A biometric cancel is a soft "not now", not an error to surface.
      if (approved.error.detail.toLowerCase().includes('biometric')) {
        haptic('warning');
        return;
      }
      haptic('error');
      showError({
        context: 'WebSign › Approve',
        summary: t('websign.errorTitle'),
        error: new Error(approved.error.detail),
      });
      return;
    }

    setSigned(approved.value);
    setPhase('signed');
    haptic('success');
  };

  const onPublish = async (): Promise<void> => {
    if (state.kind !== 'ready' || signed === null) return;
    setPhase('publishing');

    // Fold the approved draft into the FULL local profile: the draft's fields
    // verbatim, its links with their existing tiers, and every link the
    // website could not see kept unchanged (`review.merge`). `saveProfile`
    // re-signs the full record and both share projections inside the
    // biometric grace window the approval just opened, and carries the
    // draft's own `updatedAt` so the published projection stays
    // byte-identical to the record the website confirms against.
    const { draft } = state.review.request;
    const { merge } = state.review;
    const saved = await useProfileStore.getState().saveProfile(
      {
        displayName: draft.displayName,
        bio: draft.bio,
        links: merge.links,
        linkVisibility: merge.linkVisibility,
      },
      {
        avatar: draft.avatar,
        alsoKnownAs: draft.alsoKnownAs,
        badges: draft.badges,
        ...(draft.page ? { page: draft.page } : {}),
        updatedAt: draft.updatedAt,
      }
    );
    if (!saved.ok) {
      setPhase('signed');
      if (isBiometricCancellation(saved.error)) {
        haptic('warning');
        return;
      }
      haptic('error');
      showError({
        context: 'WebSign › Publish',
        summary: t('websign.publishFailed'),
        error: new Error(saved.error),
      });
      return;
    }

    const published = await publishWithNostrAutoSetup({
      hasKey: hasNostrKey,
      provision: provisionFromRootMnemonic,
      publish: async () => useProfileStore.getState().publishToNostr(DEFAULT_RELAYS),
    });
    if (!published.ok) {
      setPhase('signed');
      if (isBiometricCancellation(published.error)) {
        haptic('warning');
        return;
      }
      haptic('error');
      showError({
        context: 'WebSign › Publish',
        summary: t('websign.publishFailed'),
        error: new Error(published.error),
      });
      return;
    }
    if (!isNostrPublishOutcomeSuccessful(published.value)) {
      setPhase('signed');
      haptic('error');
      showError({
        context: 'WebSign › Publish',
        summary: t('websign.publishFailed'),
        error: new Error('publish quorum was not met'),
      });
      return;
    }

    setPhase('published');
    haptic('success');
    pushToast(t('websign.published'), 'success');
  };

  const onCopy = async (): Promise<void> => {
    if (signed === null) return;
    await Clipboard.setStringAsync(signed.responseJws);
    haptic('success');
    pushToast(t('websign.copied'), 'success');
  };

  return (
    <View className="flex-1 bg-pageBg" style={{ paddingTop: insets.top }}>
      <SettingsBackToolbar title={t('websign.back')} onPress={() => { safeBack(); }} />
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 40, gap: 18 }}
        keyboardShouldPersistTaps="handled"
      >
        <ThemedText variant="headlineLarge">{t('websign.title')}</ThemedText>

        {state.kind === 'error' ? (
          <ErrorPanel detail={state.detail} onBack={() => { safeBack(); }} />
        ) : (
          <>
            <SecurityBanner review={state.review} />
            <DiffPanel diff={state.review.diff} preservedCount={state.review.merge.preserved.length} />

            {signed === null ? (
              <View style={{ gap: 10 }}>
                <ThemedButton
                  label={phase === 'approving' ? t('websign.approving') : t('websign.approve')}
                  variant="primary"
                  fullWidth
                  loading={phase === 'approving'}
                  disabled={phase === 'approving'}
                  leadingIcon={<SfIcon name="checkmark.seal.fill" size={15} color={Colors.pageBg} />}
                  onPress={() => { void onApprove(); }}
                />
                <ThemedButton
                  label={t('websign.reject')}
                  variant="secondary"
                  fullWidth
                  disabled={phase === 'approving'}
                  onPress={() => { safeBack(); }}
                />
              </View>
            ) : (
              <SignedPanel
                phase={phase}
                pages={responsePages}
                onPublish={() => { void onPublish(); }}
                onCopy={() => { void onCopy(); }}
                onDone={() => { safeBack(); }}
              />
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}

type TFn = ReturnType<typeof useTranslation>['t'];

function reportError(t: TFn, context: string, detail: string): void {
  haptic('error');
  showError({
    context: `WebSign › ${context}`,
    summary: t('websign.errorTitle'),
    error: new Error(detail),
  });
}

function SecurityBanner({ review }: { readonly review: WebSignReview }): ReactNode {
  const { t } = useTranslation();
  const origin = review.request.originHint.trim();
  return (
    <ThemedSurface
      variant="outlined"
      padded
      style={{ borderColor: Colors.warning, gap: 8 }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <SfIcon name="exclamationmark.triangle.fill" size={16} color={Colors.warning} />
        <ThemedText variant="label" style={{ color: Colors.warning }}>
          {t('websign.securityTitle')}
        </ThemedText>
      </View>
      <ThemedText variant="bodySmall" tone="secondary">
        {t('websign.securityBody')}
      </ThemedText>
      <View style={{ gap: 2, marginTop: 4 }}>
        <ThemedText variant="caption" tone="tertiary">
          {t('websign.originClaimed')}
        </ThemedText>
        <ThemedText variant="bodySmall" selectable>
          {origin.length > 0 ? origin : t('websign.originNone')}
        </ThemedText>
        <ThemedText variant="caption" tone="tertiary" style={{ marginTop: 2 }}>
          {t('websign.originUnverified')}
        </ThemedText>
      </View>
    </ThemedSurface>
  );
}

function DiffPanel({
  diff,
  preservedCount,
}: {
  readonly diff: WebSignDiff;
  readonly preservedCount: number;
}): ReactNode {
  const { t } = useTranslation();
  const empty = t('websign.emptyValue');
  return (
    <ThemedSurface variant="card" padded style={{ gap: 14 }}>
      <ThemedText variant="label">
        {diff.isInitial ? t('websign.createHeading') : t('websign.changesHeading')}
      </ThemedText>

      {!diff.isInitial && !diff.hasChanges ? (
        <ThemedText variant="bodySmall" tone="secondary">
          {t('websign.noChanges')}
        </ThemedText>
      ) : null}

      {diff.displayName.changed ? (
        <FieldChangeRow
          label={t('websign.field.displayName')}
          before={diff.displayName.before || empty}
          after={diff.displayName.after || empty}
          initial={diff.isInitial}
        />
      ) : null}
      {diff.bio.changed ? (
        <FieldChangeRow
          label={t('websign.field.bio')}
          before={diff.bio.before || empty}
          after={diff.bio.after || empty}
          initial={diff.isInitial}
        />
      ) : null}
      {diff.avatar.changed ? (
        <FieldChangeRow
          label={t('websign.field.avatar')}
          before={diff.avatar.before ?? empty}
          after={diff.avatar.after ?? empty}
          initial={diff.isInitial}
        />
      ) : null}

      <ListDiffSection
        label={t('websign.field.links')}
        added={diff.links.added.map(linkText)}
        removed={diff.links.removed.map(linkText)}
        changed={diff.links.changed.map((c) => `${c.before} → ${c.after} · ${c.url}`)}
      />
      <ListDiffSection
        label={t('websign.field.alsoKnownAs')}
        added={diff.alsoKnownAs.added}
        removed={diff.alsoKnownAs.removed}
        changed={[]}
      />
      <ListDiffSection
        label={t('websign.field.badges')}
        added={diff.badges.added.map((b) => `${b.type} · ${b.subject}`)}
        removed={diff.badges.removed.map((b) => `${b.type} · ${b.subject}`)}
        changed={[]}
      />
      <PageDiffSection page={diff.page} />

      {preservedCount > 0 ? (
        <ThemedText variant="caption" tone="secondary">
          {t('websign.preservedLinks', { n: preservedCount })}
        </ThemedText>
      ) : null}
    </ThemedSurface>
  );
}

function linkText(link: ProfileLink): string {
  return `${link.label} · ${link.url}`;
}

function pageItemText(item: WebSignPageItemRef): string {
  return item.url === null ? item.title : `${item.title} · ${item.url}`;
}

function FieldChangeRow({
  label,
  before,
  after,
  initial,
}: {
  readonly label: string;
  readonly before: string;
  readonly after: string;
  readonly initial: boolean;
}): ReactNode {
  return (
    <View style={{ gap: 3 }}>
      <ThemedText variant="caption" tone="tertiary">{label}</ThemedText>
      {initial ? null : (
        <ThemedText
          variant="bodySmall"
          tone="tertiary"
          style={{ textDecorationLine: 'line-through' }}
          selectable
        >
          {before}
        </ThemedText>
      )}
      <ThemedText variant="bodyMedium" style={{ color: Colors.terminalGreen }} selectable>
        {after}
      </ThemedText>
    </View>
  );
}

function ListDiffSection({
  label,
  added,
  removed,
  changed,
}: {
  readonly label: string;
  readonly added: readonly string[];
  readonly removed: readonly string[];
  readonly changed: readonly string[];
}): ReactNode {
  const { t } = useTranslation();
  if (added.length === 0 && removed.length === 0 && changed.length === 0) return null;
  return (
    <View style={{ gap: 4 }}>
      <ThemedText variant="caption" tone="tertiary">{label}</ThemedText>
      {added.map((value, i) => (
        <DiffLine key={`a-${String(i)}`} tag={t('websign.added')} value={value} color={Colors.terminalGreen} />
      ))}
      {changed.map((value, i) => (
        <DiffLine key={`c-${String(i)}`} tag={t('websign.changed')} value={value} color={Colors.primaryBlue} />
      ))}
      {removed.map((value, i) => (
        <DiffLine key={`r-${String(i)}`} tag={t('websign.removed')} value={value} color={Colors.destructive} strike />
      ))}
    </View>
  );
}

/**
 * The signed Page layout is part of what a visitor sees, so a request that
 * injects, drops, or restyles block items must be consented to like any other
 * field. Item adds/removes are listed; a layout-only change (order, style,
 * appearance) is named as such rather than hidden.
 */
function PageDiffSection({ page }: { readonly page: WebSignPageDiff }): ReactNode {
  const { t } = useTranslation();
  if (!page.changed) return null;
  return (
    <View style={{ gap: 4 }}>
      <ThemedText variant="caption" tone="tertiary">{t('websign.field.page')}</ThemedText>
      {page.added.length === 0 && page.removed.length === 0 ? (
        <ThemedText variant="bodySmall" tone="secondary">
          {t('websign.pageLayoutChanged')}
        </ThemedText>
      ) : null}
      {page.added.map((item, i) => (
        <DiffLine key={`pa-${String(i)}`} tag={t('websign.added')} value={pageItemText(item)} color={Colors.terminalGreen} />
      ))}
      {page.removed.map((item, i) => (
        <DiffLine key={`pr-${String(i)}`} tag={t('websign.removed')} value={pageItemText(item)} color={Colors.destructive} strike />
      ))}
    </View>
  );
}

function DiffLine({
  tag,
  value,
  color,
  strike = false,
}: {
  readonly tag: string;
  readonly value: string;
  readonly color: string;
  readonly strike?: boolean;
}): ReactNode {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 6 }}>
      <ThemedText variant="caption" style={{ color, fontWeight: '600', minWidth: 56 }}>
        {tag}
      </ThemedText>
      <ThemedText
        variant="bodySmall"
        selectable
        style={{ flex: 1, ...(strike ? { textDecorationLine: 'line-through' } : {}) }}
      >
        {value}
      </ThemedText>
    </View>
  );
}

function SignedPanel({
  phase,
  pages,
  onPublish,
  onCopy,
  onDone,
}: {
  readonly phase: Phase;
  readonly pages: ReturnType<typeof buildPresentationQrPages>;
  readonly onPublish: () => void;
  readonly onCopy: () => void;
  readonly onDone: () => void;
}): ReactNode {
  const { t } = useTranslation();
  const publishing = phase === 'publishing';
  const published = phase === 'published';
  return (
    <View style={{ gap: 16 }}>
      <ThemedSurface variant="card" padded style={{ gap: 6 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <SfIcon name="checkmark.seal.fill" size={16} color={Colors.terminalGreen} />
          <ThemedText variant="label" style={{ color: Colors.terminalGreen }}>
            {t('websign.signedTitle')}
          </ThemedText>
        </View>
        <ThemedText variant="bodySmall" tone="secondary">
          {t('websign.signedBody')}
        </ThemedText>
      </ThemedSurface>

      <View style={{ gap: 8 }}>
        <ThemedButton
          label={published ? t('websign.published') : publishing ? t('websign.publishing') : t('websign.publish')}
          variant="primary"
          fullWidth
          loading={publishing}
          disabled={publishing || published}
          onPress={onPublish}
        />
        <ThemedText variant="caption" tone="secondary" style={{ textAlign: 'center' }}>
          {t('websign.publishHint')}
        </ThemedText>
      </View>

      <ThemedSurface variant="card" padded style={{ gap: 12, alignItems: 'center' }}>
        <ThemedText variant="label">{t('websign.responseTitle')}</ThemedText>
        <PresentationProofQr
          selectedClaims={[]}
          pages={pages}
          footerText={t('websign.responseHint')}
          qrSize={220}
        />
        <ThemedButton
          label={t('websign.copyResponse')}
          variant="secondary"
          fullWidth
          leadingIcon={<SfIcon name="doc.on.doc" size={14} color={Colors.text1} />}
          onPress={onCopy}
        />
      </ThemedSurface>

      <ThemedButton label={t('websign.done')} variant="secondary" fullWidth onPress={onDone} />
    </View>
  );
}

function ErrorPanel({
  detail,
  onBack,
}: {
  readonly detail: string;
  readonly onBack: () => void;
}): ReactNode {
  const { t } = useTranslation();
  return (
    <View style={{ gap: 16 }}>
      <ThemedSurface variant="outlined" padded style={{ borderColor: Colors.destructive, gap: 8 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <SfIcon name="exclamationmark.triangle.fill" size={16} color={Colors.destructive} />
          <ThemedText variant="label" style={{ color: Colors.destructive }}>
            {t('websign.errorTitle')}
          </ThemedText>
        </View>
        <ThemedText variant="bodySmall" tone="secondary">
          {t('websign.errorBody')}
        </ThemedText>
        <ThemedText variant="caption" tone="tertiary" selectable style={{ fontFamily: 'Menlo' }}>
          {detail}
        </ThemedText>
      </ThemedSurface>
      <ThemedButton label={t('websign.back')} variant="secondary" fullWidth onPress={onBack} />
    </View>
  );
}
