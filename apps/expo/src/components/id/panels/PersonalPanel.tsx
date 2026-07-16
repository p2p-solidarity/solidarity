/**
 * PersonalPanel — the five-section list that backs both
 * `app/id/personal.tsx` (standalone screen) and the Personal tab inside
 * `app/id/dashboard.tsx`. Extracted so the two screens stay under the
 * apps/expo/CLAUDE.md 500-line cap.
 *
 * Mirrors solidarity/Views/IDViews/PersonalIdentityView.swift section by
 * section. See that file for copy verbatim.
 */
import * as Clipboard from 'expo-clipboard';
import { useState } from 'react';
import { ScrollView, View } from 'react-native';

import { IDBlockText, IDLabeledRow, IDSectionContainer, IDSectionHeader } from '@/components/id';
import { SfIcon } from '@/components/icons/SfIcon';
import { ThemedButton, ThemedText } from '@/components/themed';
import { Colors } from '@/constants/Colors';
import { pushToast } from '@/feedback/toast';

export interface PersonalIdentityState {
  readonly commitment: string | null;
  readonly activeDid: string | null;
  readonly jwkJson: string | null;
  readonly didDocumentJson: string | null;
  readonly serviceCount: number;
  readonly lastImportSummary: string | null;
  readonly lastImportKind: string | null;
  readonly lastImportTimestamp: Date | null;
  readonly lastError: string | null;
}

export const EMPTY_PERSONAL_STATE: PersonalIdentityState = {
  commitment: null,
  activeDid: null,
  jwkJson: null,
  didDocumentJson: null,
  serviceCount: 0,
  lastImportSummary: null,
  lastImportKind: null,
  lastImportTimestamp: null,
  lastError: null,
};

export function PersonalPanel({
  state,
  onRefresh,
  onClearError,
}: {
  readonly state: PersonalIdentityState;
  readonly onRefresh: () => void;
  readonly onClearError: () => void;
}): React.JSX.Element {
  const [jwkCopied, setJwkCopied] = useState(false);

  const onCopyJwk = async (): Promise<void> => {
    if (!state.jwkJson) return;
    await Clipboard.setStringAsync(state.jwkJson);
    setJwkCopied(true);
    setTimeout(() => {
      setJwkCopied(false);
    }, 1200);
  };

  const onExportDid = async (): Promise<void> => {
    if (!state.didDocumentJson) {
      pushToast('No DID document to export.', 'warning');
      return;
    }
    await Clipboard.setStringAsync(state.didDocumentJson);
    pushToast('DID document copied', 'success');
  };

  return (
    <View className="gap-5">
      <View className="gap-3">
        <IDSectionHeader tone="secondary" title="Semaphore Commitment" />
        <IDSectionContainer>
          {state.commitment ? (
            <IDLabeledRow
              label="Commitment"
              value={state.commitment}
              mono
              selectable
              tone="secondary"
            />
          ) : (
            <ThemedText variant="bodySmall" tone="secondary">
              No commitment available. Refresh to derive your identity.
            </ThemedText>
          )}
        </IDSectionContainer>
      </View>

      <View className="gap-3">
        <IDSectionHeader tone="secondary" title="Public Key" />
        <IDSectionContainer>
          {state.jwkJson ? (
            <>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <IDBlockText value={state.jwkJson} />
              </ScrollView>
              <View className="mt-2">
                <ThemedButton
                  variant="secondary"
                  label={jwkCopied ? 'Copied' : 'Copy JWK'}
                  fullWidth
                  disabled={jwkCopied}
                  leadingIcon={
                    <SfIcon
                      name={jwkCopied ? 'checkmark.circle' : 'doc.on.doc'}
                      size={14}
                      color={Colors.accentRose}
                    />
                  }
                  onPress={() => {
                    void onCopyJwk();
                  }}
                />
              </View>
            </>
          ) : (
            <ThemedText variant="bodySmall" tone="secondary">
              No cached JWK yet. Import or refresh your identity to populate the cache.
            </ThemedText>
          )}
        </IDSectionContainer>
      </View>

      <View className="gap-3">
        <IDSectionHeader tone="secondary" title="Cached Documents" />
        <IDSectionContainer>
          {state.didDocumentJson ? (
            <>
              <ThemedButton
                variant="secondary"
                label="Export DID Document"
                fullWidth
                leadingIcon={
                  <SfIcon name="square.and.arrow.up" size={14} color={Colors.accentRose} />
                }
                onPress={() => {
                  void onExportDid();
                }}
              />
              <IDLabeledRow label="Services" value={String(state.serviceCount)} />
            </>
          ) : (
            <ThemedText variant="bodySmall" tone="secondary">
              No DID document cached yet.
            </ThemedText>
          )}
        </IDSectionContainer>
      </View>

      <View className="gap-3">
        <IDSectionHeader tone="secondary" title="Recent Activity" />
        <IDSectionContainer>
          {state.lastImportSummary ? (
            <View className="gap-1">
              <ThemedText variant="bodyMedium">{state.lastImportSummary}</ThemedText>
              {state.lastImportKind ? (
                <ThemedText variant="caption" tone="secondary" className="capitalize">
                  {state.lastImportKind}
                </ThemedText>
              ) : null}
              {state.lastImportTimestamp ? (
                <ThemedText variant="caption" tone="secondary">
                  {state.lastImportTimestamp.toLocaleString()}
                </ThemedText>
              ) : null}
            </View>
          ) : (
            <ThemedText variant="bodySmall" tone="secondary">
              No identity events yet.
            </ThemedText>
          )}
          {state.lastError ? (
            <ThemedText variant="caption" tone="error" className="mt-1">
              {state.lastError}
            </ThemedText>
          ) : null}
        </IDSectionContainer>
      </View>

      <View className="gap-3">
        <IDSectionHeader tone="secondary" title="Actions" />
        <IDSectionContainer>
          <ThemedButton
            variant="secondary"
            label="Refresh Identity"
            fullWidth
            leadingIcon={<SfIcon name="arrow.clockwise" size={14} color={Colors.accentRose} />}
            onPress={onRefresh}
          />
          <ThemedButton
            variant="secondary"
            label="Clear Error State"
            fullWidth
            disabled={state.lastError === null}
            leadingIcon={<SfIcon name="xmark.circle" size={14} color={Colors.accentRose} />}
            onPress={onClearError}
          />
        </IDSectionContainer>
      </View>
    </View>
  );
}
