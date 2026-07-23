import type { ReactNode } from 'react';
import { useState } from 'react';
import { Modal, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PressableScale } from '@/components/common/PressableScale';
import { SfIcon } from '@/components/icons/SfIcon';
import { ThemedButton, ThemedSurface, ThemedText, ThemedTextInput } from '@/components/themed';
import { Colors } from '@/constants/Colors';
import { useTranslation } from '@/i18n';
import {
  composeLinkUrl,
  detectLinkFromUrl,
  displayLinkText,
  expandLinkPresetHandle,
  isHttpsLinkUrl,
  isLinkPresetHandleInput,
  LINK_LABEL_PRESETS,
  linkInputModelFor,
  linkPresetForEditableUrl,
  normalizeLinkUrl,
  type LinkLabelPreset,
} from '@/profile/linkUrl';
import { linkIconNameFor } from '@/profile/linkPresentation';
import type { LinkVisibility } from '@/profile/projection';

import { LinkVisibilityControl } from './PublishPreviewSheet';

export interface LinkSheetValue {
  readonly label: string;
  readonly url: string;
  readonly preset: LinkLabelPreset | null;
  readonly visibility: LinkVisibility;
}

export interface AddLinkSheetProps {
  readonly visible: boolean;
  /** `null` opens the label-free add flow; a value opens the full edit flow. */
  readonly initialLink: LinkSheetValue | null;
  readonly onSubmit: (link: LinkSheetValue) => void;
  readonly onClose: () => void;
}

interface SheetState {
  readonly step: 'paste' | 'details';
  readonly preset: LinkLabelPreset | null;
  readonly input: string;
  readonly label: string;
  readonly visibility: LinkVisibility;
}

function initialState(initialLink: LinkSheetValue | null): SheetState {
  if (initialLink === null) {
    return { step: 'paste', preset: null, input: '', label: '', visibility: 'public' };
  }
  const detected = detectLinkFromUrl(initialLink.url);
  const detectedPreset = initialLink.preset ?? detected?.preset ?? null;
  const normalizedUrl = normalizeLinkUrl(initialLink.url);
  const preset = linkPresetForEditableUrl(detectedPreset, normalizedUrl);
  return {
    step: 'details',
    preset,
    input: displayLinkText(preset, normalizedUrl),
    label: initialLink.label,
    visibility: initialLink.visibility,
  };
}

function detailsUrl(preset: LinkLabelPreset | null, input: string): string {
  const trimmed = input.trim();
  const model = linkInputModelFor(preset);
  if (model.handle) {
    if (!isLinkPresetHandleInput(trimmed)) return '';
    const expanded = expandLinkPresetHandle(preset, trimmed);
    return expanded === trimmed
      ? composeLinkUrl(preset, trimmed)
      : normalizeLinkUrl(expanded);
  }
  return composeLinkUrl(preset, trimmed);
}

export function AddLinkSheet({
  visible,
  initialLink,
  onSubmit,
  onClose,
}: AddLinkSheetProps): ReactNode {
  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}>
      {visible ? (
        <AddLinkSheetContent
          initialLink={initialLink}
          onSubmit={onSubmit}
          onClose={onClose}
        />
      ) : null}
    </Modal>
  );
}

function AddLinkSheetContent({
  initialLink,
  onSubmit,
  onClose,
}: Omit<AddLinkSheetProps, 'visible'>): ReactNode {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const editing = initialLink !== null;
  const [state, setState] = useState<SheetState>(() => initialState(initialLink));

  const detected = state.step === 'paste' ? detectLinkFromUrl(state.input) : null;
  const preparedUrl =
    state.step === 'details' ? detailsUrl(state.preset, state.input) : '';
  const urlValid =
    state.step === 'paste' ? detected !== null : isHttpsLinkUrl(preparedUrl);
  const labelValid = !editing || state.label.trim().length > 0;
  const canSubmit = urlValid && labelValid;
  const inputError =
    state.input.trim().length > 0 && !urlValid ? t('profileLink.httpsOnly') : null;
  const inputModel = linkInputModelFor(state.preset);

  const submit = () => {
    if (!canSubmit) return;
    if (state.step === 'paste') {
      if (detected === null) return;
      onSubmit({
        ...detected,
        preset: linkPresetForEditableUrl(detected.preset, detected.url),
        visibility: 'public',
      });
      return;
    }
    const presetLabel =
      state.preset === null ? '' : t(`profileLink.preset.${state.preset}`);
    onSubmit({
      label: editing ? state.label.trim() : presetLabel,
      url: preparedUrl,
      preset: state.preset,
      visibility: editing ? state.visibility : 'public',
    });
  };

  const choosePreset = (preset: LinkLabelPreset) => {
    setState({
      step: 'details',
      preset,
      input: '',
      label: '',
      visibility: 'public',
    });
  };

  const backToPaste = () => {
    setState({
      step: 'paste',
      preset: null,
      input: '',
      label: '',
      visibility: 'public',
    });
  };

  return (
    <View
      className="flex-1 bg-pageBg"
      style={{ paddingTop: insets.top, paddingBottom: insets.bottom + 12 }}>
      <SheetHeader
        editing={editing}
        canGoBack={state.step === 'details'}
        onBack={backToPaste}
        onClose={onClose}
      />

      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: 16, gap: 20 }}>
        {state.step === 'paste' ? (
          <>
            <ThemedTextInput
              kind="url"
              label={t('meEdit.linkSheet.pasteLabel')}
              value={state.input}
              onChangeText={(input) => {
                setState((current) => ({ ...current, input }));
              }}
              placeholder={t('meEdit.linkSheet.pastePlaceholder')}
              error={inputError}
              autoFocus
              showPaste
              showClear
              returnKeyType="done"
              onSubmitEditing={canSubmit ? submit : undefined}
            />
            <ThemedButton
              label={t('meEdit.linkSheet.add')}
              variant="primary"
              fullWidth
              disabled={!canSubmit}
              onPress={submit}
            />

            <View className="gap-2">
              <ThemedText variant="label" tone="tertiary">
                {t('meEdit.linkSheet.choosePlatform')}
              </ThemedText>
              {LINK_LABEL_PRESETS.map((preset) => (
                <PlatformRow
                  key={preset}
                  preset={preset}
                  label={t(`profileLink.preset.${preset}`)}
                  onPress={() => {
                    choosePreset(preset);
                  }}
                />
              ))}
            </View>
          </>
        ) : (
          <>
            {editing ? (
              <ThemedTextInput
                label={t('meEdit.linkLabelPlaceholder')}
                value={state.label}
                onChangeText={(label) => {
                  setState((current) => ({ ...current, label }));
                }}
                placeholder={t('meEdit.linkLabelPlaceholder')}
                autoFocus
                showClear
              />
            ) : null}
            <ThemedTextInput
              kind={inputModel.handle ? 'handle' : 'url'}
              label={t(
                inputModel.handle
                  ? 'meEdit.linkSheet.handleLabel'
                  : 'meEdit.linkSheet.urlLabel'
              )}
              value={state.input}
              onChangeText={(input) => {
                setState((current) => ({ ...current, input }));
              }}
              inlinePrefix={inputModel.prefix}
              placeholder={
                inputModel.handle
                  ? t('profileLink.handlePlaceholder')
                  : t('profileLink.urlPlaceholder')
              }
              error={inputError}
              autoFocus={!editing}
              showClear
              returnKeyType="done"
              onSubmitEditing={canSubmit ? submit : undefined}
            />
            {editing ? (
              <LinkVisibilityControl
                selected={state.visibility}
                onSelect={(visibility) => {
                  setState((current) => ({ ...current, visibility }));
                }}
              />
            ) : null}
            <ThemedButton
              label={t(
                editing ? 'meEdit.linkSheet.save' : 'meEdit.linkSheet.add'
              )}
              variant="primary"
              fullWidth
              disabled={!canSubmit}
              onPress={submit}
            />
          </>
        )}
      </ScrollView>
    </View>
  );
}

function SheetHeader({
  editing,
  canGoBack,
  onBack,
  onClose,
}: {
  readonly editing: boolean;
  readonly canGoBack: boolean;
  readonly onBack: () => void;
  readonly onClose: () => void;
}): ReactNode {
  const { t } = useTranslation();
  return (
    <View className="min-h-14 flex-row items-center justify-between border-b border-divider px-4">
      {!editing && canGoBack ? (
        <PressableScale
          haptic="tap"
          onPress={onBack}
          accessibilityRole="button"
          accessibilityLabel={t('meEdit.linkSheet.back')}
          style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
          <SfIcon name="chevron.left" size={16} color={Colors.text1} />
        </PressableScale>
      ) : (
        <View style={{ width: 44 }} />
      )}
      <ThemedText variant="titleMedium">
        {t(editing ? 'meEdit.linkSheet.editTitle' : 'meEdit.linkSheet.addTitle')}
      </ThemedText>
      <PressableScale
        haptic="tap"
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel={t('meEdit.linkSheet.close')}
        style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
        <SfIcon name="xmark" size={16} color={Colors.text1} />
      </PressableScale>
    </View>
  );
}

function PlatformRow({
  preset,
  label,
  onPress,
}: {
  readonly preset: LinkLabelPreset;
  readonly label: string;
  readonly onPress: () => void;
}): ReactNode {
  const model = linkInputModelFor(preset);
  return (
    <PressableScale
      haptic="tap"
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}>
      <ThemedSurface
        variant="outlined"
        className="min-h-14 flex-row items-center gap-3 rounded-none px-4 py-3">
        <View className="w-7 items-center">
          <SfIcon
            name={linkIconNameFor(preset, '')}
            size={18}
            color={Colors.primaryBlue}
          />
        </View>
        <View className="flex-1 gap-0.5">
          <ThemedText variant="bodyMedium">{label}</ThemedText>
          <ThemedText variant="caption" tone="tertiary">
            {model.prefix}
          </ThemedText>
        </View>
        <SfIcon name="chevron.right" size={13} color={Colors.text3} />
      </ThemedSurface>
    </PressableScale>
  );
}
