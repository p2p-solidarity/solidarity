import type { ReactNode } from 'react';
import { Modal, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedButton, ThemedSurface, ThemedText } from '@/components/themed';
import type { ContactManifestEntry } from '@/contacts/repository';
import { Colors } from '@/constants/Colors';
import { useTranslation } from '@/i18n';

export interface DeleteContactsSheetProps {
  readonly visible: boolean;
  readonly contacts: readonly ContactManifestEntry[];
  readonly deleting: boolean;
  readonly onConfirm: () => void;
  readonly onClose: () => void;
}

export function DeleteContactsSheet({
  visible,
  contacts,
  deleting,
  onConfirm,
  onClose,
}: DeleteContactsSheetProps): ReactNode {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={() => {
        if (!deleting) onClose();
      }}
    >
      <View
        style={{
          flex: 1,
          backgroundColor: Colors.pageBg,
          paddingTop: insets.top,
        }}
      >
        <ScrollView
          contentContainerStyle={{
            paddingHorizontal: 16,
            paddingTop: 12,
            paddingBottom: 24,
            gap: 16,
          }}
        >
          <ThemedText variant="titleLarge">
            {t('peopleList.deleteCountTitle', { count: contacts.length })}
          </ThemedText>

          <ThemedSurface variant="card" padded>
            <View style={{ gap: 10 }}>
              <ThemedText variant="bodyMedium" tone="secondary">
                {t('peopleList.deleteCardsNotes')}
              </ThemedText>
              <ThemedText variant="bodyMedium" tone="secondary">
                {t('peopleList.deleteOthersUnaffected')}
              </ThemedText>
              <ThemedText variant="bodyMedium" tone="error">
                {t('peopleList.deleteNoUndo')}
              </ThemedText>
            </View>
          </ThemedSurface>

          <ThemedSurface variant="outlined">
            {contacts.map((contact, index) => (
              <View
                key={contact.id}
                className="flex-row items-center px-4"
                style={{
                  minHeight: 52,
                  borderBottomWidth: index === contacts.length - 1 ? 0 : 0.5,
                  borderBottomColor: Colors.divider,
                  gap: 12,
                }}
              >
                <View
                  className="items-center justify-center rounded-full bg-searchBg"
                  style={{ width: 32, height: 32 }}
                >
                  <ThemedText variant="bodySmall" tone="secondary">
                    {initial(contact.name)}
                  </ThemedText>
                </View>
                <ThemedText variant="bodyLarge" numberOfLines={1} style={{ flex: 1 }}>
                  {contact.name}
                </ThemedText>
              </View>
            ))}
          </ThemedSurface>
        </ScrollView>

        <View
          style={{
            paddingHorizontal: 16,
            paddingTop: 12,
            paddingBottom: Math.max(insets.bottom, 12),
            gap: 10,
          }}
        >
          <ThemedButton
            fullWidth
            variant="destructive"
            label={t('peopleList.delete')}
            loading={deleting}
            disabled={contacts.length === 0}
            onPress={onConfirm}
          />
          <ThemedButton
            fullWidth
            variant="secondary"
            label={t('peopleList.cancel')}
            disabled={deleting}
            onPress={onClose}
          />
        </View>
      </View>
    </Modal>
  );
}

function initial(name: string): string {
  const trimmed = name.trim();
  return trimmed.length === 0 ? '?' : trimmed.charAt(0).toUpperCase();
}
