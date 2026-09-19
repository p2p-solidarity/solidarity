/**
 * appAlert + error-report sheet — themed replacement for `Alert.alert`.
 *
 * Why: RN's `Alert.alert` hands off to `UIAlertController` (iOS) /
 * `AlertDialog` (Android). Both are unstyled system chrome that clashes with
 * the app's tokens (the Android one is worse — grey rect, ALL-CAPS teal
 * buttons). We render our own so every popup is "ours".
 *
 * Two shapes, one queue (mirrors `confirmDialog`'s zustand-queue + Modal):
 *   • `appAlert({ title, message?, buttons? })` — info / multi-button, a
 *     centered elevated card. Drop-in for the common `Alert.alert` calls.
 *   • `showError({ context, message, error?, code? })` — a bottom sheet that
 *     ABSORBS the error: shows a friendly summary, a collapsible technical
 *     trace, and a primary "Send report" action that emails the trace to
 *     err@solidarity.gg (see `errorReport.ts`), plus "Copy details".
 *
 * For yes/no confirmations keep using `confirmDialog` — this module is for
 * acknowledgements, multi-choice prompts, and absorbed errors.
 *
 * Mount `<AppAlertOverlay />` once near the top of `_layout.tsx` (alongside
 * ToastOverlay / ConfirmDialogOverlay). Requests queue FIFO.
 */
import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { create } from 'zustand';

import { WindowOverlay } from '@/components/common/WindowOverlay';
import { SfIcon } from '@/components/icons/SfIcon';
import { ThemedButton, ThemedSurface, ThemedText } from '@/components/themed';
import type { ButtonVariant } from '@/components/themed';
import { Colors } from '@/constants/Colors';
import { haptic } from '@/feedback/haptics';
import { pushToast } from '@/feedback/toast';
import { useTranslation } from '@/i18n';
import {
  buildErrorReport,
  copyErrorReport,
  sendErrorReport,
  type ErrorReportInput,
  type ResolvedErrorReport,
} from '@/feedback/errorReport';

export type AlertButtonStyle = 'default' | 'cancel' | 'destructive';

export interface AppAlertButton {
  readonly label: string;
  readonly style?: AlertButtonStyle;
  readonly onPress?: () => void;
}

interface AlertRequest {
  readonly id: number;
  readonly kind: 'info';
  readonly title: string;
  readonly message?: string;
  readonly buttons: readonly AppAlertButton[];
}

interface ErrorRequest {
  readonly id: number;
  readonly kind: 'error';
  /** Optional override; overlay falls back to the localized default. */
  readonly title?: string;
  readonly report: ResolvedErrorReport;
  readonly onClose?: () => void;
}

type Request = AlertRequest | ErrorRequest;

interface AlertStore {
  readonly queue: readonly Request[];
  readonly push: (req: Request) => void;
  readonly dismissHead: () => void;
}

let nextId = 1;

/** Absorbs taps on the card so they don't bubble to the dismiss backdrop. */
const absorbPress = (): void => undefined;

const useAlertStore = create<AlertStore>((set, get) => ({
  queue: [],
  push: (req) => { set((s) => ({ queue: [...s.queue, req] })); },
  dismissHead: () => {
    const head = get().queue[0];
    if (!head) return;
    set((s) => ({ queue: s.queue.slice(1) }));
  },
}));

export interface AppAlertOptions {
  readonly title: string;
  readonly message?: string;
  /** Defaults to a single "OK" button. */
  readonly buttons?: readonly AppAlertButton[];
}

/** Themed acknowledgement / multi-button popup. Replaces info `Alert.alert`. */
export function appAlert(opts: AppAlertOptions): void {
  useAlertStore.getState().push({
    id: nextId++,
    kind: 'info',
    title: opts.title,
    message: opts.message,
    // Empty → overlay renders a single localized "OK".
    buttons: opts.buttons ?? [],
  });
}

export interface ShowErrorOptions extends ErrorReportInput {
  /** Sheet title. Defaults to "Something went wrong". */
  readonly title?: string;
  readonly onClose?: () => void;
}

/**
 * Absorb an error into the themed report sheet instead of a native alert.
 * The sheet's primary action emails the trace to err@solidarity.gg.
 */
export function showError(opts: ShowErrorOptions): void {
  useAlertStore.getState().push({
    id: nextId++,
    kind: 'error',
    title: opts.title,
    report: buildErrorReport(opts),
    onClose: opts.onClose,
  });
}

function variantFor(style: AlertButtonStyle | undefined, index: number): ButtonVariant {
  if (style === 'destructive') return 'destructive';
  if (style === 'cancel') return 'secondary';
  // First default button reads as the primary action.
  return index === 0 ? 'primary' : 'secondary';
}

function InfoCard({ req, onDone }: { readonly req: AlertRequest; readonly onDone: () => void }): ReactNode {
  const { t } = useTranslation();
  const buttons: readonly AppAlertButton[] = req.buttons.length > 0
    ? req.buttons
    : [{ label: t('alert.ok'), style: 'default' }];
  return (
    <View style={styles.centerRoot}>
      <Pressable style={StyleSheet.absoluteFill} onPress={onDone} accessibilityLabel="Dismiss" />
      <Pressable onPress={absorbPress} style={styles.cardWrap}>
        <ThemedSurface variant="elevated" padded>
          <ThemedText variant="titleMedium" style={styles.title}>
            {req.title}
          </ThemedText>
          {req.message ? (
            <ThemedText variant="bodyMedium" tone="secondary" style={styles.message}>
              {req.message}
            </ThemedText>
          ) : null}
          <View style={styles.infoActions}>
            {buttons.map((b, i) => (
              <ThemedButton
                key={`${b.label}-${String(i)}`}
                label={b.label}
                variant={variantFor(b.style, i)}
                fullWidth
                onPress={() => { b.onPress?.(); onDone(); }}
              />
            ))}
          </View>
        </ThemedSurface>
      </Pressable>
    </View>
  );
}

function ErrorSheet({ req, onDone }: { readonly req: ErrorRequest; readonly onDone: () => void }): ReactNode {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const [showDetail, setShowDetail] = useState(false);
  const [sending, setSending] = useState(false);
  const translateY = useSharedValue(40);
  const opacity = useSharedValue(0);

  useEffect(() => {
    haptic('warning');
    translateY.value = withTiming(0, { duration: 220 });
    opacity.value = withTiming(1, { duration: 220 });
  }, [opacity, translateY]);

  const animStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: translateY.value }],
  }));

  const onSend = async () => {
    setSending(true);
    try {
      const sent = await sendErrorReport(req.report);
      if (!sent) {
        await copyErrorReport(req.report);
        pushToast(t('error.report.mailUnavailable'), 'warning');
      }
    } finally {
      setSending(false);
      onDone();
    }
  };

  const onCopy = async () => {
    await copyErrorReport(req.report);
    pushToast(t('error.report.copied'), 'success');
  };

  const r = req.report;

  return (
    <View style={styles.sheetRoot}>
      <Pressable style={StyleSheet.absoluteFill} onPress={onDone} accessibilityLabel="Dismiss" />
      <Animated.View style={[animStyle, styles.sheetWrap, { paddingBottom: 16 + insets.bottom }]}>
        <ThemedSurface variant="elevated" padded>
          <View style={styles.sheetHeader}>
            <SfIcon name="xmark.circle.fill" size={26} color={Colors.destructive} />
            <View style={styles.sheetHeaderText}>
              <ThemedText variant="titleMedium">{req.title ?? t('error.report.title')}</ThemedText>
              <ThemedText variant="bodyMedium" tone="secondary" style={styles.sheetSummary}>
                {r.summary}
              </ThemedText>
            </View>
          </View>

          <Pressable
            onPress={() => { setShowDetail((v) => !v); }}
            accessibilityRole="button"
            style={styles.detailToggle}
          >
            <SfIcon
              name={showDetail ? 'chevron.down' : 'chevron.right'}
              size={12}
              color={Colors.text3}
            />
            <ThemedText variant="caption" tone="secondary">
              {showDetail ? t('error.report.hideDetails') : t('error.report.showDetails')}
            </ThemedText>
          </Pressable>

          {showDetail ? (
            <ThemedSurface variant="inset" style={styles.detailBox}>
              <ScrollView style={styles.detailScroll} nestedScrollEnabled>
                <ThemedText variant="caption" tone="secondary" style={styles.detailText}>
                  {r.code ? `${r.code}\n` : ''}
                  {r.detail || '(no further detail)'}
                </ThemedText>
              </ScrollView>
            </ThemedSurface>
          ) : null}

          <View style={styles.sheetActions}>
            <ThemedButton
              label={sending ? t('error.report.opening') : t('error.report.sendReport')}
              variant="primary"
              fullWidth
              loading={sending}
              leadingIcon={<SfIcon name="paperplane.fill" size={15} color={Colors.pageBg} />}
              onPress={() => { void onSend(); }}
            />
            <ThemedButton
              label={t('error.report.copy')}
              variant="secondary"
              fullWidth
              onPress={() => { void onCopy(); }}
            />
            <ThemedButton label={t('error.report.dismiss')} variant="secondary" fullWidth onPress={onDone} />
          </View>
        </ThemedSurface>
      </Animated.View>
    </View>
  );
}

/** Mount once near the top of `_layout.tsx`. */
export function AppAlertOverlay(): ReactNode {
  const head = useAlertStore((s) => s.queue[0]);
  const dismissHead = useAlertStore((s) => s.dismissHead);

  const close = () => {
    if (head?.kind === 'error') head.onClose?.();
    dismissHead();
  };

  return (
    <WindowOverlay
      visible={head !== undefined}
      onRequestClose={close}
    >
      {head?.kind === 'error' ? (
        <ErrorSheet key={head.id} req={head} onDone={close} />
      ) : head?.kind === 'info' ? (
        <InfoCard key={head.id} req={head} onDone={close} />
      ) : null}
    </WindowOverlay>
  );
}

const styles = StyleSheet.create({
  centerRoot: {
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
  infoActions: {
    gap: 10,
  },
  sheetRoot: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  sheetWrap: {
    paddingHorizontal: 12,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    marginBottom: 14,
  },
  sheetHeaderText: {
    flex: 1,
    gap: 4,
  },
  sheetSummary: {
    lineHeight: 20,
  },
  detailToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 6,
  },
  detailBox: {
    marginTop: 4,
    marginBottom: 12,
    padding: 12,
  },
  detailScroll: {
    maxHeight: 180,
  },
  detailText: {
    fontFamily: 'Menlo',
    lineHeight: 17,
  },
  sheetActions: {
    gap: 10,
    marginTop: 4,
  },
});
