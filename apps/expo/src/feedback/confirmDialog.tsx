/**
 * Confirm dialog — imperative themed alternative to `Alert.alert`.
 *
 * Why: RN's `Alert.alert` hands off to `UIAlertController` (iOS) and
 * `AlertDialog` (Android). The Android one uses the system Material
 * theme — gray rounded rect, ALL-CAPS teal buttons — which clashes
 * with the app's tokens and looks bolted-on. There's no styling API,
 * so the only way to match the rest of the UI is to render our own.
 *
 * API mirrors `pushToast`: imperative function returning a Promise so
 * call sites stay one-liners:
 *
 *   const ok = await confirmDialog({
 *     title: `Delete ${name}?`,
 *     message: 'This contact will be permanently removed.',
 *     confirmLabel: 'Delete',
 *     destructive: true,
 *   });
 *   if (!ok) return;
 *
 * Mount `<ConfirmDialogOverlay />` once near the top of `_layout.tsx`
 * (alongside ToastOverlay). Concurrent calls queue FIFO and resolve in
 * order — destructive confirms gated by user actions don't realistically
 * stack, but a queue is simpler to reason about than racy single-slot
 * replacement that would leave callers waiting on a Promise that
 * silently resolves false.
 */
import type { ReactNode } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { create } from 'zustand';

import { ThemedButton, ThemedSurface, ThemedText } from '@/components/themed';

interface ConfirmRequest {
  readonly id: number;
  readonly title: string;
  readonly message?: string;
  readonly confirmLabel: string;
  readonly cancelLabel: string;
  readonly destructive: boolean;
  readonly resolve: (ok: boolean) => void;
}

interface ConfirmStore {
  readonly queue: readonly ConfirmRequest[];
  readonly push: (req: Omit<ConfirmRequest, 'id'>) => void;
  readonly resolveHead: (ok: boolean) => void;
}

let nextId = 1;

const useConfirmStore = create<ConfirmStore>((set, get) => ({
  queue: [],
  push: (req) => {
    set((s) => ({ queue: [...s.queue, { ...req, id: nextId++ }] }));
  },
  resolveHead: (ok) => {
    const head = get().queue[0];
    if (!head) return;
    head.resolve(ok);
    set((s) => ({ queue: s.queue.slice(1) }));
  },
}));

export interface ConfirmOptions {
  readonly title: string;
  readonly message?: string;
  readonly confirmLabel?: string;
  readonly cancelLabel?: string;
  /** Render the confirm button in the destructive variant. Default false. */
  readonly destructive?: boolean;
}

/** Show a themed confirm dialog. Resolves `true` on confirm, `false` otherwise. */
export function confirmDialog(opts: ConfirmOptions): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    useConfirmStore.getState().push({
      title: opts.title,
      message: opts.message,
      confirmLabel: opts.confirmLabel ?? 'Confirm',
      cancelLabel: opts.cancelLabel ?? 'Cancel',
      destructive: opts.destructive ?? false,
      resolve,
    });
  });
}

/** Mount once near the top of `_layout.tsx`. */
export function ConfirmDialogOverlay(): ReactNode {
  const head = useConfirmStore((s) => s.queue[0]);
  const resolveHead = useConfirmStore((s) => s.resolveHead);

  const onDismiss = () => { resolveHead(false); };
  const onConfirm = () => { resolveHead(true); };

  return (
    <Modal
      transparent
      visible={head !== undefined}
      animationType="fade"
      onRequestClose={onDismiss}
      statusBarTranslucent
    >
      {head ? (
        <View style={styles.root}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={onDismiss}
            accessibilityLabel="Dismiss"
          />
          {/* Empty onPress absorbs taps so they don't bubble to the backdrop. */}
          <Pressable onPress={() => {}} style={styles.cardWrap}>
            <ThemedSurface variant="elevated" padded>
              <ThemedText variant="titleMedium" style={styles.title}>
                {head.title}
              </ThemedText>
              {head.message ? (
                <ThemedText
                  variant="bodyMedium"
                  tone="secondary"
                  style={styles.message}
                >
                  {head.message}
                </ThemedText>
              ) : null}
              <View style={styles.actions}>
                <ThemedButton
                  label={head.cancelLabel}
                  variant="secondary"
                  onPress={onDismiss}
                />
                <ThemedButton
                  label={head.confirmLabel}
                  variant={head.destructive ? 'destructive' : 'primary'}
                  onPress={onConfirm}
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
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 12,
  },
});
