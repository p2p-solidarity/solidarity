/**
 * ReceivedCardSheet — 1:1 port of solidarity/Views/Common/ReceivedCardView.swift.
 *
 * Bottom-sheet preview for an incoming BusinessCard handed to the app
 * by a deep link. Mirrors the Swift screen: SakuraIcon ring header,
 * card-detail block (avatar + name + title + company + verification +
 * email + phone) and two CTAs (Save to Contacts / Continue).
 *
 * Integration point — `apps/expo/src/deeplink/router.ts` currently
 * navigates to `/people/[id]` after persisting; for a true "card just
 * arrived, save?" flow we still need to:
 *   1. emit a `card-received` event from `handleDeepLink` (e.g. via
 *      `DeviceEventEmitter`) carrying the decoded BusinessCard payload,
 *   2. subscribe in `app/_layout.tsx` and mount this sheet with
 *      `visible / card / onSaved / onDismiss` props,
 *   3. call `useContactStore().upsert(...)` on save then route to the
 *      person detail page.
 * Touching the router lives outside this commit so the sheet ships
 * standalone and the wiring is one small follow-up patch.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { SakuraIcon } from '@/components/brand/SakuraIcon';
import { PeerAvatar } from '@/components/cards/PeerAvatar';
import { DecorativeBlobs } from '@/components/decor/DecorativeBlobs';
import { SfIcon } from '@/components/icons/SfIcon';
import { ThemedButton } from '@/components/themed/ThemedButton';
import { Colors } from '@/constants/Colors';
import { pushToast } from '@/feedback/toast';
import { uuid } from '@solidarity/shared';
import type { BusinessCard, Contact, VerificationStatus } from '@solidarity/shared';

export interface ReceivedCardSheetProps {
  readonly visible: boolean;
  readonly card: BusinessCard | null;
  readonly verificationStatus?: VerificationStatus;
  readonly onSave: (contact: Contact) => void | Promise<void>;
  readonly onDismiss: () => void;
}

export function ReceivedCardSheet({
  visible,
  card,
  verificationStatus = 'Unverified',
  onSave,
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
          onSave={onSave}
          onDismiss={onDismiss}
        />
      ) : null}
    </Modal>
  );
}

function ReceivedCardContent({
  card,
  verificationStatus,
  onSave,
  onDismiss,
}: {
  readonly card: BusinessCard;
  readonly verificationStatus: VerificationStatus;
  readonly onSave: (contact: Contact) => void | Promise<void>;
  readonly onDismiss: () => void;
}): ReactNode {
  const insets = useSafeAreaInsets();
  const [isSaved, setIsSaved] = useState(false);
  const ringScale = useSharedValue(1);

  useEffect(() => {
    ringScale.value = withRepeat(
      withTiming(1.1, { duration: 800, easing: Easing.inOut(Easing.ease) }),
      -1,
      true
    );
    return () => {
      cancelAnimation(ringScale);
    };
  }, [ringScale]);

  const ringStyle = useAnimatedStyle(() => ({
    transform: [{ scale: ringScale.value }],
  }));

  const handleSave = async (): Promise<void> => {
    if (isSaved) return;
    const now = new Date();
    const contact: Contact = {
      id: uuid(),
      businessCard: card,
      receivedAt: now,
      source: 'Proximity',
      tags: [],
      verificationStatus: 'Unverified',
    };
    await onSave(contact);
    setIsSaved(true);
    pushToast(`Saved ${card.name}`, 'success');
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
              style={[
                {
                  position: 'absolute',
                  width: 100,
                  height: 100,
                  borderRadius: 50,
                  borderWidth: 4,
                  borderColor: Colors.accentRose,
                },
                ringStyle,
              ]}
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
              Sakura Card Received
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
                ? 'Business card has been saved to your contacts'
                : 'Tap save to add this card to your contacts'}
            </Text>
          </View>
        </View>

        <CardDetailBlock card={card} verificationStatus={verificationStatus} />

        <View style={{ rowGap: 12 }}>
          {isSaved ? null : (
            <ThemedButton
              label="Save to Contacts"
              variant="primary"
              size="lg"
              fullWidth
              leadingIcon={
                <SfIcon name="square.and.arrow.down" size={18} color={Colors.cardBg} />
              }
              onPress={() => {
                void handleSave();
              }}
            />
          )}
          <ThemedButton
            label="Continue"
            variant="secondary"
            size="lg"
            fullWidth
            leadingIcon={
              <SfIcon name="checkmark.circle" size={18} color={Colors.text1} />
            }
            onPress={onDismiss}
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
          Card Details
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
  const tint = verificationTint(status);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', columnGap: 6 }}>
      <SfIcon name={verificationIcon(status)} size={12} color={tint} />
      <Text style={{ fontSize: 12, color: Colors.text2 }}>{status}</Text>
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
        Sakura Received
      </Text>
      <Pressable accessibilityRole="button" onPress={onDone} hitSlop={8}>
        <Text style={{ fontSize: 16, color: Colors.text1, fontWeight: '600' }}>
          Done
        </Text>
      </Pressable>
    </View>
  );
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
