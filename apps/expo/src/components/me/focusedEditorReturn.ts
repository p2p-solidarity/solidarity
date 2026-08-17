export type FocusedEditorMode = 'add' | 'avatar' | null;

export function focusedEditorMode(params: {
  readonly add?: string;
  readonly avatar?: string;
}): FocusedEditorMode {
  if (params.avatar === '1') return 'avatar';
  if (params.add === '1') return 'add';
  return null;
}

export function shouldReturnAfterFocusedCancel(
  mode: FocusedEditorMode,
  hasDraftEdits: boolean
): boolean {
  return mode !== null && !hasDraftEdits;
}
