import { describe, expect, it } from 'bun:test';

import {
  focusedEditorMode,
  shouldReturnAfterFocusedCancel,
} from '@/components/me/focusedEditorReturn';

describe('focused editor return contract', () => {
  it('returns only an untouched add/avatar shortcut to Me', () => {
    expect(focusedEditorMode({ add: '1' })).toBe('add');
    expect(focusedEditorMode({ avatar: '1' })).toBe('avatar');
    expect(focusedEditorMode({ add: '1', avatar: '1' })).toBe('avatar');
    expect(focusedEditorMode({})).toBeNull();

    expect(shouldReturnAfterFocusedCancel('add', false)).toBe(true);
    expect(shouldReturnAfterFocusedCancel('avatar', false)).toBe(true);
    expect(shouldReturnAfterFocusedCancel('add', true)).toBe(false);
    expect(shouldReturnAfterFocusedCancel(null, false)).toBe(false);
  });
});
