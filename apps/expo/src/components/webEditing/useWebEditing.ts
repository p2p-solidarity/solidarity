import { useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { AppState, Linking } from 'react-native';

import { pushToast } from '@/feedback/toast';
import { useTranslation } from '@/i18n';
import { haptic } from '@/feedback/haptics';
import {
  connectStoredRootIdentityWithNativePasskey,
  getStoredRootVaultIdentityBinding,
} from '@/identity/rootVaultSync';
import { getRootVaultSyncState, setRootVaultSyncState } from '@/identity/rootVaultSyncState';

import type { Operation, WebEditingState } from './webEditingViewModel';

export type { Connection, Operation, WebEditingState } from './webEditingViewModel';
export const WEB_EDITOR_URL = 'https://creds.id/edit';

export function useWebEditing(): {
  state: WebEditingState;
  refresh: () => Promise<void>;
  binding: string | null;
  addPasskey: (retryOnly?: boolean) => Promise<void>;
  openEditor: () => Promise<void>;
} {
  const { t } = useTranslation();
  const [state, setState] = useState<WebEditingState>({ kind: 'loading' });
  const current = useRef(state);
  const focused = useRef(false);
  const generation = useRef(0);
  const operating = useRef(false);
  const binding = useRef<string | null>(null);

  const publish = useCallback((next: WebEditingState) => {
    current.current = next;
    setState(next);
  }, []);

  const refresh = useCallback(async (): Promise<void> => {
    // System authentication sheets can emit foreground events mid-operation.
    if (!focused.current || operating.current) return;
    const request = ++generation.current;
    const isCurrent = () => focused.current && request === generation.current;
    const previous = current.current.kind === 'ready'
      ? current.current.connection
      : current.current.kind === 'error' ? current.current.previous : null;
    publish({ kind: 'loading' });
    try {
      const nextBinding = await getStoredRootVaultIdentityBinding();
      if (!isCurrent()) return;
      binding.current = nextBinding;
      if (nextBinding === null) {
        publish({ kind: 'error', operation: 'load', previous });
        return;
      }
      publish({
        kind: 'ready',
        connection: getRootVaultSyncState(nextBinding) === 'connected' ? 'connected' : 'notConnected',
        busy: null,
      });
    } catch {
      if (isCurrent()) {
        publish({ kind: 'error', operation: 'load', previous });
      }
    }
  }, [publish]);

  useFocusEffect(useCallback(() => {
    focused.current = true;
    void refresh();
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'active') void refresh();
    });
    return () => {
      focused.current = false;
      ++generation.current;
      subscription.remove();
    };
  }, [refresh]));

  const openCheckedEditor = useCallback(async (isCurrent: () => boolean): Promise<void> => {
    let nextBinding: string | null;
    try {
      nextBinding = await getStoredRootVaultIdentityBinding();
    } catch {
      nextBinding = null;
    }
    if (!isCurrent()) return;
    if (nextBinding === null) {
      publish({ kind: 'error', operation: 'load', previous: 'connected' });
      return;
    }
    const matches = nextBinding === binding.current && getRootVaultSyncState(nextBinding) === 'connected';
    binding.current = nextBinding;
    if (!matches) {
      publish({ kind: 'ready', connection: 'notConnected', busy: null });
      return;
    }
    // Only this branch opens a URL; its errors are never passkey failures.
    await Linking.openURL(WEB_EDITOR_URL);
    if (isCurrent()) publish({ kind: 'ready', connection: 'connected', busy: null });
  }, [publish]);

  const run = useCallback(async (operation: Operation, retryOnly = false): Promise<void> => {
    if (!focused.current || operating.current) return;
    const before = current.current;
    const previous = before.kind === 'ready'
      ? before.connection
      : before.kind === 'error' && before.operation === operation ? before.previous : null;
    if (previous === null || (operation === 'open' && previous !== 'connected')) return;

    // Ref guard closes the interval before React commits the disabled control.
    operating.current = true;
    const request = ++generation.current;
    const isCurrent = () => focused.current && request === generation.current;
    publish({ kind: 'ready', connection: previous, busy: operation });
    try {
      if (operation === 'open') {
        await openCheckedEditor(isCurrent);
        return;
      }

      const result = await connectStoredRootIdentityWithNativePasskey(retryOnly);
      // A successful sync belongs to its returned binding even if the user left.
      if (result.ok) setRootVaultSyncState('connected', result.value);
      if (!isCurrent()) return;
      if (result.ok) {
        binding.current = result.value;
        publish({ kind: 'ready', connection: 'connected', busy: null });
        haptic('success');
      } else if (result.error.kind === 'cancelled') {
        publish({ kind: 'ready', connection: previous, busy: null });
      } else {
        publish({ kind: 'ready', connection: previous, busy: null });
        pushToast(t(result.error.kind === 'alreadyRegistered' ? 'passkeys.alreadyRegistered' : 'passkeys.addFailed'), 'info');
      }
    } catch {
      if (isCurrent()) publish({ kind: 'error', operation, previous });
    } finally {
      operating.current = false;
      // If focus returned while an older operation was finishing, load afresh.
      if (!isCurrent()) void refresh();
    }
  }, [openCheckedEditor, publish, refresh, t]);

  return {
    state,
    refresh,
    binding: binding.current,
    addPasskey: (retryOnly = false) => run('add', retryOnly),
    openEditor: () => run('open'),
  };
}
