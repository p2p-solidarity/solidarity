/**
 * ZK Settings — 1:1 port of Swift ZKSettingsView
 *   (solidarity/Views/IDViews/ZKSettingsView.swift).
 *
 * Layout (Swift parity):
 *   • Nav title "ZK Settings" (inline) + chevron.left "Settings" leading
 *   • Identity Status block:
 *       – commitment row (shield.checkered + truncated middle commitment)
 *         OR "Not initialized" info row (circle.dashed icon)
 *       – Proofs Supported info row (checkmark.seal + Yes/No)
 *   • Actions block:
 *       – Destructive "Delete Identity" row (disabled when no identity)
 *   • Delete confirmation Alert + delete-error Alert (mirrors Swift)
 *
 * TODO(android): wire SemaphoreIdentityManager.shared once the Nitro
 * module lands. For now the screen reads a placeholder commitment from
 * the credentials store metadata (none today → "Not initialized" state).
 */
import { useEffect, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';

import { IDNavBar } from '@/components/id';
import { shortCommitment } from '@/components/id/shortDid';
import { SfIcon } from '@/components/icons/SfIcon';
import {
  SettingsBlockDangerRow,
  SettingsBlockInfoRow,
  SettingsBlockRow,
  SettingsBlockSection,
} from '@/components/settings/SettingsBlocks';
import { Colors } from '@/constants/Colors';
import { showError } from '@/feedback/appAlert';
import { confirmDialog } from '@/feedback/confirmDialog';
import { pushToast } from '@/feedback/toast';
import { useTranslation } from '@/i18n';
import { requireBiometric } from '@/keychain/biometric';
import {
  useProofsSupported,
  useZkIdentity,
  useZkIdentityCommitment,
} from '@/zk';

export default function ZkSettings(): React.JSX.Element {
  const commitment = useZkIdentityCommitment();
  const proofsSupported = useProofsSupported();
  const seedFromNative = useZkIdentity((s) => s.seedFromNative);
  const deleteIdentity = useZkIdentity((s) => s.deleteIdentity);
  const createIdentity = useZkIdentity((s) => s.createIdentity);
  const isWorking = useZkIdentity((s) => s.isWorking);
  const { t } = useTranslation();
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    void seedFromNative();
  }, [seedFromNative]);

  const performCreate = async (): Promise<void> => {
    try {
      await createIdentity();
      pushToast('ZK identity created', 'success');
    } catch (e) {
      showError({ context: 'ZK › Create Identity', summary: t('zk.createFailed'), error: e });
    }
  };

  const performDelete = async (): Promise<void> => {
    setIsDeleting(true);
    try {
      const ok = await requireBiometric('delete');
      if (!ok) {
        pushToast('Biometric authentication required', 'warning');
        return;
      }
      await deleteIdentity();
      pushToast('Identity deleted', 'success');
    } catch (e) {
      showError({ context: 'ZK › Delete Identity', summary: t('zk.deleteFailed'), error: e });
    } finally {
      setIsDeleting(false);
    }
  };

  const confirmDelete = (): void => {
    void (async () => {
      const ok = await confirmDialog({
        title: t('zk.delete.confirmTitle'),
        message: t('zk.delete.confirmMessage'),
        confirmLabel: t('zk.delete.confirmAction'),
        destructive: true,
      });
      if (!ok) return;
      await performDelete();
    })();
  };

  return (
    <View className="flex-1 bg-pageBg">
      <IDNavBar title="ZK Settings" leadingLabel="Settings" />

      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingVertical: 24 }}
      >
        <View className="gap-6">
          <SettingsBlockSection title="Identity Status">
            {commitment ? (
              <CommitmentRow commitment={commitment} />
            ) : (
              <SettingsBlockInfoRow
                icon="circle.dashed"
                title="Identity"
                value="Not initialized"
              />
            )}

            <SettingsBlockInfoRow
              icon="checkmark.seal"
              title="Proofs Supported"
              value={proofsSupported ? 'Yes' : 'No'}
            />
          </SettingsBlockSection>

          <SettingsBlockSection title="Actions">
            {commitment === null ? (
              <SettingsBlockRow
                icon="plus"
                title="Create Identity"
                subtitle={isWorking ? 'Working…' : 'Generate a Semaphore commitment'}
                showsChevron={false}
                disabled={isWorking}
                onPress={() => { void performCreate(); }}
              />
            ) : null}
            <View
              style={{
                opacity: commitment === null || isDeleting ? 0.5 : 1,
              }}
            >
              <SettingsBlockDangerRow
                icon="trash"
                title="Delete Identity"
                subtitle={commitment === null ? 'No identity to delete' : undefined}
                onPress={
                  commitment === null || isDeleting ? undefined : confirmDelete
                }
              />
            </View>
          </SettingsBlockSection>
        </View>
      </ScrollView>
    </View>
  );
}

function CommitmentRow({ commitment }: { readonly commitment: string }): React.JSX.Element {
  return (
    <View
      className="bg-mutedSurface rounded-xl"
      style={{ paddingHorizontal: 14, paddingVertical: 12 }}
    >
      <View className="flex-row items-center" style={{ gap: 12, marginBottom: 8 }}>
        <View
          style={{ width: 20, height: 20, alignItems: 'center', justifyContent: 'center' }}
        >
          <SfIcon name="shield.checkered" size={14} color={Colors.text1} />
        </View>
        <Text className="text-text1 text-[15px] flex-1">Commitment</Text>
      </View>
      <Text
        selectable
        numberOfLines={2}
        ellipsizeMode="middle"
        style={{ fontFamily: 'Menlo' }}
        className="text-text2 text-[11px]"
      >
        {shortCommitment(commitment)}
      </Text>
    </View>
  );
}
