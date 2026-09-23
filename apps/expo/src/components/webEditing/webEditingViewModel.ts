export type Connection = 'connected' | 'notConnected';
export type Operation = 'connect' | 'reconnect' | 'open';
export type WebEditingState =
  | { kind: 'loading' }
  | { kind: 'ready'; connection: Connection; busy: Operation | null }
  | { kind: 'error'; operation: 'load' | Operation; previous: Connection | null };

interface WebEditingViewModel {
  readonly copyKey: string;
  readonly statusKey: string | null;
  readonly primary: {
    readonly action: 'refresh' | Operation;
    readonly labelKey: string;
    readonly disabled: boolean;
  } | null;
}

/** A single primary slot prevents competing Connect / Open / Retry CTAs. */
export function webEditingViewModel(state: WebEditingState): WebEditingViewModel {
  if (state.kind === 'loading') {
    return { copyKey: 'webEditing.loading', statusKey: null, primary: null };
  }
  if (state.kind === 'error') {
    const load = state.operation === 'load';
    const open = state.operation === 'open';
    return {
      copyKey: load ? 'webEditing.checkFailed' : open ? 'webEditing.openFailed' : 'rootVault.failed.body',
      statusKey: load ? 'webEditing.unavailable' : open ? null : 'rootVault.failed.title',
      primary: {
        action: state.operation === 'load' ? 'refresh' : state.operation,
        labelKey: 'webEditing.retry',
        disabled: false,
      },
    };
  }
  const connected = state.connection === 'connected';
  return {
    copyKey: connected ? 'webEditing.connectedBody' : 'webEditing.connectBody',
    statusKey: connected ? 'webEditing.connected' : 'webEditing.notConnected',
    primary: {
      action: connected ? 'open' : 'connect',
      labelKey: state.busy === 'open'
        ? 'webEditing.opening'
        : state.busy !== null
          ? 'webEditing.connecting'
          : connected ? 'webEditing.open' : 'webEditing.connect',
      disabled: state.busy !== null,
    },
  };
}
