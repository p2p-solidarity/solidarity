/**
 * ReceivedCardSheet — incoming Card preview and save ceremony.
 *
 * Bottom-sheet preview for an incoming BusinessCard handed to the app
 * by a deep link. Mirrors the Swift screen: SakuraIcon ring header,
 * card-detail block (avatar + name + title + company + verification +
 * email + phone) and the v2 reciprocal-exchange CTAs.
 *
 * Scanner provenance, verification status, and the sealed reply route stay
 * attached until the Contact is persisted from the app root.
 */
import { useState, type ReactNode } from 'react';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { SakuraIcon } from '@/components/brand/SakuraIcon';
import { PeerAvatar } from '@/components/cards/PeerAvatar';
import { buildContactFromReceivedCard } from '@/cards/receivedCard';
import { DecorativeBlobs } from '@/components/decor/DecorativeBlobs';
import { SfIcon } from '@/components/icons/SfIcon';
import { ThemedButton } from '@/components/themed/ThemedButton';
import { Colors } from '@/constants/Colors';
import { haptic } from '@/feedback/haptics';
import { pushToast } from '@/feedback/toast';
import { useTranslation } from '@/i18n';
import { uuid } from '@solidarity/shared';
import type {
  BusinessCard,
  Contact,
  ContactSource,
  VerificationStatus,
} from '@solidarity/shared';

export interface ReceivedCardSheetProps {
  readonly visible: boolean;
  readonly card: BusinessCard | null;
  readonly verificationStatus: VerificationStatus;
  readonly source: ContactSource;
  readonly sealedRoute?: string;
  readonly onSave: (contact: Contact) => void | Promise<void>;
  readonly onShowMine: () => void;
  readonly onDismiss: () => void;
}

export function ReceivedCardSheet({
  visible,
  card,
  verificationStatus,
  source,
  sealedRoute,
  onSave,
  onShowMine,
  onDismiss,
}: ReceivedCardSheetProps): ReactNode {
  return (
    <Modal
      visible={visible && card !== null}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onDismiss}
    >
      {card ? (
        <ReceivedCardContent
          card={card}
          verificationStatus={verificationStatus}
          source={source}
          sealedRoute={sealedRoute}
          onSave={onSave}
          onShowMine={onShowMine}
          onDismiss={onDismiss}
        />
      ) : null}
    </Modal>
  );
}

function ReceivedCardContent({
  card,
  verificationStatus,
  source,
  sealedRoute,
  onSave,
  onShowMine,
  onDismiss,
}: {
  readonly card: BusinessCard;
  readonly verificationStatus: VerificationStatus;
  readonly source: ContactSource;
  readonly sealedRoute?: string;
  readonly onSave: (contact: Contact) => void | Promise<void>;
  readonly onShowMine: () => void;
  readonly onDismiss: () => void;
}): ReactNode {
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const [isSaved, setIsSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  const handleSave = async (showMine: boolean): Promise<void> => {
    if (isSaved || saving) return;
    const contact = buildContactFromReceivedCard({
      id: uuid(),
      card,
      receivedAt: new Date(),
      source,
      verificationStatus,
      sealedRoute,
    });
    setSaving(true);
    try {
      await onSave(contact);
      setIsSaved(true);
      haptic('success');
      pushToast(t('receivedCard.savedToast', { name: card.name }), 'success');
      if (showMine) {
        onShowMine();
      } else {
        onDismiss();
      }
    } catch {
      haptic('error');
      pushToast(t('receivedCard.saveFailed'), 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: Colors.pageBg }}>
      <View style={{ paddingTop: insets.top }}>
        <Toolbar onDone={onDismiss} />
      </View>

      <View
        pointerEvents="none"
        style={{ position: 'absolute', top: 60, right: -120 }}
      >
        <DecorativeBlobs />
      </View>

      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: 16,
          paddingBottom: 32,
          rowGap: 24,
        }}
      >
        <View style={{ alignItems: 'center', rowGap: 16, paddingVertical: 16 }}>
          <View
            style={{
              width: 100,
              height: 100,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Animated.View
              entering={FadeIn.duration(220)}
              style={{
                position: 'absolute',
                width: 100,
                height: 100,
                borderRadius: 50,
                borderWidth: 4,
                borderColor: Colors.accentRose,
              }}
            />
            <SakuraIcon size={40} color={Colors.accentRose} animating />
          </View>

          <View style={{ alignItems: 'center', rowGap: 8 }}>
            <Text
              style={{
                fontSize: 28,
                fontWeight: '700',
                color: Colors.text1,
                textAlign: 'center',
              }}
            >
              {t('receivedCard.title')}
            </Text>
            <Text
              style={{
                fontSize: 16,
                color: Colors.text2,
                textAlign: 'center',
                paddingHorizontal: 24,
              }}
            >
              {isSaved
                ? t('receivedCard.saved')
                : t('receivedCard.saveHint')}
            </Text>
          </View>
        </View>

        <CardDetailBlock card={card} verificationStatus={verificationStatus} />

        <View style={{ rowGap: 12 }}>
          <ThemedButton
            label={t('receivedCard.saveAndPresent')}
            variant="primary"
            size="lg"
            fullWidth
            loading={saving}
            disabled={isSaved}
            leadingIcon={
              <SfIcon name="square.and.arrow.up" size={18} color={Colors.cardBg} />
            }
            onPress={() => {
              void handleSave(true);
            }}
          />
          <ThemedButton
            label={t('receivedCard.justAdd')}
            variant="secondary"
            size="lg"
            fullWidth
            disabled={isSaved || saving}
            leadingIcon={
              <SfIcon name="square.and.arrow.down" size={18} color={Colors.text1} />
            }
            onPress={() => {
              void handleSave(false);
            }}
          />
        </View>
      </ScrollView>
    </View>
  );
}

function CardDetailBlock({
  card,
  verificationStatus,
}: {
  readonly card: BusinessCard;
  readonly verificationStatus: VerificationStatus;
}): ReactNode {
  const { t } = useTranslation();
  return (
    <View
      style={{
        backgroundColor: Colors.cardSurface,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: Colors.cardBorder,
        padding: 16,
        rowGap: 16,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <Text
          style={{
            fontSize: 17,
            fontWeight: '600',
            color: Colors.text1,
            flex: 1,
          }}
        >
          {t('receivedCard.details')}
        </Text>
        <SakuraIcon size={24} color={Colors.accentRose} animating />
      </View>

      <View style={{ flexDirection: 'row', alignItems: 'center', columnGap: 12 }}>
        {card.animal ? (
          <PeerAvatar animal={card.animal} size={56} ringColor={Colors.accentRose} />
        ) : (
          <InitialAvatar name={card.name} />
        )}
        <Text
          style={{
            fontSize: 20,
            fontWeight: '700',
            color: Colors.text1,
            flexShrink: 1,
          }}
        >
          {card.name}
        </Text>
      </View>

      {card.title ? (
        <Text style={{ fontSize: 17, fontWeight: '600', color: Colors.accentRose }}>
          {card.title}
        </Text>
      ) : null}

      {card.company ? (
        <Text style={{ fontSize: 15, color: Colors.text2 }}>{card.company}</Text>
      ) : null}

      <VerificationChip status={verificationStatus} />

      {card.email ? (
        <ContactLine icon="envelope.fill" tint={Colors.primaryBlue} text={card.email} />
      ) : null}

      {card.phone ? (
        <ContactLine icon="phone.fill" tint={Colors.terminalGreen} text={card.phone} />
      ) : null}
    </View>
  );
}

function VerificationChip({ status }: { readonly status: VerificationStatus }): ReactNode {
  const { t } = useTranslation();
  const tint = verificationTint(status);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', columnGap: 6 }}>
      <SfIcon name={verificationIcon(status)} size={12} color={tint} />
      <Text style={{ fontSize: 12, color: Colors.text2 }}>
        {t(verificationStatusKey(status))}
      </Text>
    </View>
  );
}

function ContactLine({
  icon,
  tint,
  text,
}: {
  readonly icon: 'envelope.fill' | 'phone.fill';
  readonly tint: string;
  readonly text: string;
}): ReactNode {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', columnGap: 8 }}>
      <SfIcon name={icon} size={14} color={tint} />
      <Text style={{ fontSize: 15, color: tint, flexShrink: 1 }}>{text}</Text>
    </View>
  );
}

function InitialAvatar({ name }: { readonly name: string }): ReactNode {
  const initial = name.trim().charAt(0).toUpperCase() || '?';
  return (
    <View
      style={{
        width: 56,
        height: 56,
        borderRadius: 28,
        backgroundColor: Colors.searchBg,
        borderWidth: 1,
        borderColor: Colors.accentRose,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Text
        style={{
          fontFamily: 'Menlo',
          fontSize: 22,
          fontWeight: '700',
          color: Colors.text1,
        }}
      >
        {initial}
      </Text>
    </View>
  );
}

function Toolbar({ onDone }: { readonly onDone: () => void }): ReactNode {
  const { t } = useTranslation();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 16,
        height: 44,
      }}
    >
      <View style={{ width: 60 }} />
      <Text style={{ fontSize: 17, fontWeight: '600', color: Colors.text1 }}>
        {t('receivedCard.toolbar')}
      </Text>
      <Pressable accessibilityRole="button" onPress={onDone} hitSlop={8}>
        <Text style={{ fontSize: 16, color: Colors.text1, fontWeight: '600' }}>
          {t('peopleList.done')}
        </Text>
      </Pressable>
    </View>
  );
}

function verificationStatusKey(status: VerificationStatus): string {
  switch (status) {
    case 'Verified':
      return 'receivedCard.status.verified';
    case 'Pending':
      return 'receivedCard.status.pending';
    case 'Failed':
      return 'receivedCard.status.failed';
    case 'Unverified':
    default:
      return 'receivedCard.status.unverified';
  }
}

function verificationIcon(
  status: VerificationStatus
): 'checkmark.seal.fill' | 'clock.fill' | 'questionmark.circle' | 'xmark.octagon.fill' {
  switch (status) {
    case 'Verified':
      return 'checkmark.seal.fill';
    case 'Pending':
      return 'clock.fill';
    case 'Failed':
      return 'xmark.octagon.fill';
    case 'Unverified':
    default:
      return 'questionmark.circle';
  }
}

function verificationTint(status: VerificationStatus): string {
  switch (status) {
    case 'Verified':
      return Colors.terminalGreen;
    case 'Pending':
      return Colors.warning;
    case 'Failed':
      return Colors.destructive;
    case 'Unverified':
    default:
      return Colors.text3;
  }
}
