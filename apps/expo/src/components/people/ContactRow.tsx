import type { ReactNode } from 'react';
import { View } from 'react-native';

import { PressableScale } from '@/components/common/PressableScale';
import { SfIcon } from '@/components/icons/SfIcon';
import { ThemedText } from '@/components/themed';
import { Colors } from '@/constants/Colors';
import type { ContactManifestEntry } from '@/contacts/repository';
import { haptic } from '@/feedback/haptics';
import { useTranslation } from '@/i18n';

type Translate = ReturnType<typeof useTranslation>['t'];

export interface ContactRowProps {
  readonly contact: ContactManifestEntry;
  readonly selectionMode?: boolean;
  readonly selected?: boolean;
  readonly onPress?: () => void;
  readonly onLongPress?: () => void;
}

export function ContactRow({
  contact,
  selectionMode = false,
  selected = false,
  onPress,
  onLongPress,
}: ContactRowProps): ReactNode {
  const { t } = useTranslation();
  const source = contactSourceDescription(contact, t);

  return (
    <PressableScale
      onPress={onPress}
      onLongPress={() => {
        haptic('heavy');
        onLongPress?.();
      }}
      accessibilityRole="button"
      accessibilityLabel={contact.name}
      accessibilityState={selectionMode ? { selected } : undefined}
      className="flex-row items-center"
      style={{ minHeight: 58 }}
    >
      {selectionMode ? (
        <View style={{ width: 34, alignItems: 'flex-start' }}>
          <View
            style={{
              width: 22,
              height: 22,
              borderRadius: 11,
              borderWidth: 1.5,
              borderColor: selected ? Colors.primaryBlue : Colors.text3,
              backgroundColor: selected ? Colors.primaryBlue : 'transparent',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {selected ? (
              <SfIcon name="checkmark" size={12} weight="bold" color={Colors.invertedButtonText} />
            ) : null}
          </View>
        </View>
      ) : null}

      <View style={{ flex: 1, minWidth: 0, paddingVertical: 9, gap: 1 }}>
        <ThemedText variant="bodyMedium" numberOfLines={1}>
          {contact.name}
        </ThemedText>
        {source ? (
          <ThemedText variant="bodySmall" tone="secondary" numberOfLines={1}>
            {source}
          </ThemedText>
        ) : null}
      </View>

      {!selectionMode ? (
        <View style={{ width: 32, height: 44, alignItems: 'flex-end', justifyContent: 'center' }}>
          <SfIcon name="chevron.right" size={13} color={Colors.text3} />
        </View>
      ) : null}
    </PressableScale>
  );
}

/** Source copy is rendered only from persisted manifest fields (never mock context). */
export function contactSourceDescription(
  contact: Pick<ContactManifestEntry, 'source' | 'tags'>,
  t: Translate,
): string | undefined {
  if (contact.source === 'Manual') return t('peopleList.sourceManual');
  const source = contactSourceTag(contact, t);
  return source ? t('peopleList.sourceCard', { source }) : undefined;
}

export function contactSourceTag(
  contact: Pick<ContactManifestEntry, 'source' | 'tags'>,
  t: Translate,
): string | undefined {
  if (contact.source === 'Manual') return t('peopleList.sourceManual');
  return contact.tags
    .map((tag) => tag.trim())
    .find((tag) => tag.length > 0) ?? sourceName(contact.source, t);
}

export function sourceName(
  source: ContactManifestEntry['source'],
  t: Translate,
): string | undefined {
  switch (source) {
    case 'QR Code':
      return t('peopleList.sourceQr');
    case 'Proximity':
      return t('peopleList.sourceProximity');
    case 'App Clip':
      return t('peopleList.sourceAppClip');
    case 'AirDrop':
      return t('peopleList.sourceAirDrop');
    case 'Manual':
      return t('peopleList.sourceManual');
  }
}
