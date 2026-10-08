import { describe, expect, it } from 'bun:test';

import { webEditingViewModel } from '../../src/components/webEditing/webEditingViewModel';

describe('web editing actions', () => {
  it('shows neutral loading copy without a Connect action', () => {
    const view = webEditingViewModel({ kind: 'loading' });
    expect(view.copyKey).toBe('webEditing.loading');
    expect(view.primary).toBeNull();
  });

  it('offers exactly one primary action for each ready connection', () => {
    const disconnected = webEditingViewModel({ kind: 'ready', connection: 'notConnected', busy: null });
    expect(disconnected.copyKey).toBe('webEditing.connectBody');
    expect(disconnected.primary).toEqual({ action: 'add', labelKey: 'passkeys.add', disabled: false });
    const connected = webEditingViewModel({ kind: 'ready', connection: 'connected', busy: null });
    expect(connected.copyKey).toBe('webEditing.connectedBody');
    expect(connected.primary).toEqual({ action: 'open', labelKey: 'webEditing.open', disabled: false });
  });

  it('disables the primary action throughout connect, reconnect, and open', () => {
    for (const connection of ['connected', 'notConnected'] as const) {
      for (const busy of ['add', 'open'] as const) {
        const view = webEditingViewModel({ kind: 'ready', connection, busy });
        expect(view.primary?.disabled).toBe(true);
        expect(view.primary?.labelKey).toBe(busy === 'open' ? 'webEditing.opening' : 'webEditing.connecting');
      }
    }
  });

  it('offers only Retry for errors, with operation-specific copy and recovery', () => {
    const cases = [
      ['load', 'refresh', 'webEditing.checkFailed', null],
      ['add', 'add', 'passkeys.addFailed', 'notConnected'],
      ['open', 'open', 'webEditing.openFailed', 'connected'],
    ] as const;
    for (const [operation, action, copyKey, previous] of cases) {
      const view = webEditingViewModel({ kind: 'error', operation, previous });
      expect(view.copyKey).toBe(copyKey);
      expect(view.primary).toEqual({ action, labelKey: 'webEditing.retry', disabled: false });
    }
    // A binding read failure remains a load retry even after a known connection.
    expect(webEditingViewModel({ kind: 'error', operation: 'load', previous: 'connected' }).primary?.action).toBe('refresh');
  });
});
