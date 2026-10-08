import type { ListedPasskey } from '@/identity/passkeyRegistry';

export type PasskeysState =
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'ready'; rows: ListedPasskey[] };

export function passkeysViewModel(state: PasskeysState, busy: boolean) {
  if (state.kind !== 'ready') {
    return { rows: [], canAdd: false, messageKey: state.kind === 'loading' ? 'passkeys.loading' : 'passkeys.loadFailed' };
  }
  return {
    rows: state.rows,
    canAdd: !busy && !state.rows.some(row => !('legacy' in row) && row.status === 'pending'),
    messageKey: state.rows.length === 0 ? 'passkeys.empty' : null,
  };
}
