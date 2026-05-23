/**
 * Sakura profile (shoutout detail) — 1:1 port of
 * solidarity/Views/ShoutoutViews/ShoutoutDetailView.swift +
 * ShoutoutDetailView+Sections.swift.
 *
 * Sections (Swift parity):
 *   • Header: "Sakura Profile" title + animated avatar ring + name +
 *     title / company + verification pill.
 *   • Information: email + last interaction (+ latest Sakura snippet
 *     when a cached message exists).
 *   • Tags: chip cloud or "No tags available".
 *   • Message History: stored Shoutout messages from useShoutoutStore
 *     filtered by counterpart name.
 *   • Actions: Send Sakura (primary) / View Profile + Share / Delete Contact.
 */
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  Share,
  Text,
  View,
} from 'react-native';
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
import { DecorativeBlobs } from '@/components/decor/DecorativeBlobs';
import { SfIcon } from '@/components/icons/SfIcon';
import {
  SettingsBackToolbar,
  SettingsScreenTitle,
} from '@/components/settings/SettingsBlocks';
import { ThemedButton } from '@/components/themed';
import { Colors } from '@/constants/Colors';
import { useContact, useContactStore } from '@/contacts/repository';
import { pushToast } from '@/feedback/toast';
import { useShoutoutStore, type Shoutout } from '@/shoutouts/store';
import type { VerificationStatus } from '@solidarity/shared';

function verificationColor(status: VerificationStatus): string {
  switch (status) {
    case 'Verified':
      return Colors.terminalGreen;
    case 'Pending':
      return '#FF9500';
    case 'Failed':
      return Colors.destructive;
    default:
      return Colors.primaryBlue;
  }
}

function verificationIcon(status: VerificationStatus): import('expo-symbols').SFSymbol {
  switch (status) {
    case 'Verified':
      return 'checkmark.seal.fill';
    case 'Pending':
      return 'clock';
    case 'Failed':
      return 'xmark.circle.fill';
    default:
      return 'questionmark.circle';
  }
}

function initials(name: string): string {
  return name
    .split(/\s+/u)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('');
}

function relativeDate(d: Date | undefined): string {
  if (!d) return '';
  const deltaSec = (Date.now() - d.getTime()) / 1000;
  if (deltaSec < 60) return 'just now';
  if (deltaSec < 3600) return `${Math.floor(deltaSec / 60).toFixed(0)}m ago`;
  if (deltaSec < 86400) return `${Math.floor(deltaSec / 3600).toFixed(0)}h ago`;
  if (deltaSec < 86400 * 7) return `${Math.floor(deltaSec / 86400).toFixed(0)}d ago`;
  return d.toLocaleDateString();
}

function AvatarRing({
  name,
  status,
  animating,
}: {
  readonly name: string;
  readonly status: VerificationStatus;
  readonly animating: boolean;
}): ReactNode {
  const ring = useSharedValue(animating ? 1 : 0);
  const inner = useSharedValue(animating ? 1 : 0);

  useEffect(() => {
    if (animating) {
      ring.value = withRepeat(
        withTiming(1, { duration: 800, easing: Easing.inOut(Easing.ease) }),
        -1,
        true
      );
      inner.value = withRepeat(
        withTiming(1, { duration: 600, easing: Easing.inOut(Easing.ease) }),
        -1,
        true
      );
    } else {
      cancelAnimation(ring);
      cancelAnimation(inner);
      ring.value = 0;
      inner.value = 0;
    }
    return () => {
      cancelAnimation(ring);
      cancelAnimation(inner);
    };
  }, [animating, ring, inner]);

  const ringStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 1 + ring.value * 0.1 }],
  }));
  const innerStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 1 + inner.value * 0.05 }],
  }));

  return (
    <View style={{ width: 120, height: 120, alignItems: 'center', justifyContent: 'center' }}>
      <Animated.View
        style={[
          {
            position: 'absolute',
            width: 120,
            height: 120,
            borderRadius: 60,
            borderWidth: 3,
            borderColor: Colors.accentRose,
            opacity: 0.7,
          },
          ringStyle,
        ]}
      />
      <Animated.View
        style={[
          {
            width: 100,
            height: 100,
            borderRadius: 50,
            borderWidth: 3,
            borderColor: verificationColor(status),
            backgroundColor: Colors.primaryMauve,
            alignItems: 'center',
            justifyContent: 'center',
          },
          innerStyle,
        ]}
      >
        <Text className="text-cardBg" style={{ fontSize: 28, fontWeight: '700' }}>
          {initials(name)}
        </Text>
      </Animated.View>
    </View>
  );
}

function SectionCard({ children }: { readonly children: ReactNode }): ReactNode {
  return (
    <View
      className="bg-cardBg mx-4"
      style={{
        borderRadius: 12,
        padding: 16,
        marginTop: 24,
        borderWidth: 1,
        borderColor: Colors.divider,
      }}
    >
      {children}
    </View>
  );
}

function InfoRow({
  icon,
  title,
  value,
}: {
  readonly icon: import('expo-symbols').SFSymbol;
  readonly title: string;
  readonly value: string;
}): ReactNode {
  return (
    <View className="flex-row items-start" style={{ paddingVertical: 6 }}>
      <View style={{ width: 20, alignItems: 'center', marginTop: 2 }}>
        <SfIcon name={icon} size={14} color={Colors.text1} />
      </View>
      <View style={{ marginLeft: 8, flex: 1 }}>
        <Text className="text-text1" style={{ fontSize: 14 }}>
          {title}
        </Text>
        <Text className="text-text2" style={{ fontSize: 12, marginTop: 2 }}>
          {value}
        </Text>
      </View>
    </View>
  );
}

function MessageBullet({ message }: { readonly message: Shoutout }): ReactNode {
  return (
    <View className="flex-row items-start" style={{ paddingVertical: 4 }}>
      <View
        style={{
          width: 8,
          height: 8,
          borderRadius: 4,
          backgroundColor: Colors.accentRose,
          marginTop: 6,
        }}
      />
      <View style={{ marginLeft: 12, flex: 1 }}>
        <Text className="text-text1" style={{ fontSize: 15 }}>
          {message.body || message.subject}
        </Text>
        <Text className="text-text2" style={{ fontSize: 11, marginTop: 4 }}>
          {relativeDate(message.createdAt)}
        </Text>
      </View>
    </View>
  );
}

export default function ShoutoutDetail(): ReactNode {
  const insets = useSafeAreaInsets();
  const { id, name } = useLocalSearchParams<{ id: string; name?: string }>();
  const contact = useContact(id);
  const removeContact = useContactStore((s) => s.remove);
  const hydrateShoutouts = useShoutoutStore((s) => s.hydrate);
  const shoutoutItems = useShoutoutStore((s) => s.items);
  const [isSakuraAnimating, setIsSakuraAnimating] = useState(false);

  useEffect(() => {
    setIsSakuraAnimating(true);
    void hydrateShoutouts();
  }, [hydrateShoutouts]);

  const displayName = contact?.businessCard.name ?? name ?? 'Sakura';
  const status = contact?.verificationStatus ?? 'Unverified';
  const card = contact?.businessCard;
  const tags = contact?.tags ?? [];

  const messages = useMemo(
    () => shoutoutItems.filter((m) => m.counterpartName === displayName),
    [shoutoutItems, displayName]
  );
  const latestIncoming = useMemo(
    () => messages.find((m) => m.direction === 'incoming'),
    [messages]
  );

  const onSendSakura = (): void => {
    router.push({
      pathname: '/shoutouts/new',
      params: { id: id ?? '', name: displayName },
    });
  };

  const onViewProfile = (): void => {
    if (!contact) return;
    router.push({
      pathname: '/people/[id]' as const,
      params: { id: contact.id, name: contact.businessCard.name },
    });
  };

  const onShare = async (): Promise<void> => {
    try {
      await Share.share({ message: `Check out ${displayName} on Sakura!` });
    } catch {
      // ignore user cancel
    }
  };

  const onDelete = (): void => {
    if (!contact) return;
    Alert.alert(
      'Delete Contact?',
      `Are you sure you want to delete ${displayName}? This action cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            void removeContact(contact.id).then(() => {
              pushToast(`Deleted ${displayName}`, 'success');
              router.back();
            });
          },
        },
      ]
    );
  };

  return (
    <View className="flex-1 bg-pageBg" style={{ paddingTop: insets.top }}>
      <View pointerEvents="none" style={{ position: 'absolute', left: 100, top: -80 }}>
        <DecorativeBlobs />
      </View>

      <SettingsBackToolbar title="Close" onPress={() => { router.back(); }} />
      <SettingsScreenTitle title="Sakura Profile" />

      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingBottom: 60 + insets.bottom }}
      >
        <View style={{ paddingHorizontal: 24, paddingTop: 8, gap: 20 }}>
          <View className="flex-row items-center">
            <SakuraIcon size={32} color={Colors.accentRose} animating={isSakuraAnimating} />
            <Text
              className="text-text1"
              style={{ marginLeft: 8, fontSize: 22, fontWeight: '700' }}
            >
              Sakura Profile
            </Text>
          </View>

          <View className="items-center">
            <AvatarRing
              name={displayName}
              status={status}
              animating={isSakuraAnimating}
            />
          </View>

          <View className="items-center" style={{ gap: 4 }}>
            <Text className="text-text1" style={{ fontSize: 28, fontWeight: '700' }}>
              {displayName}
            </Text>
            {card?.title ? (
              <Text className="text-accentRose" style={{ fontSize: 17, fontWeight: '600' }}>
                {card.title}
              </Text>
            ) : null}
            {card?.company ? (
              <Text className="text-text2" style={{ fontSize: 15 }}>
                {card.company}
              </Text>
            ) : null}
          </View>

          <View className="items-center">
            <View
              className="flex-row items-center"
              style={{
                paddingHorizontal: 16,
                paddingVertical: 8,
                borderRadius: 16,
                backgroundColor: `${verificationColor(status)}1F`,
                borderWidth: 1,
                borderColor: verificationColor(status),
              }}
            >
              <SfIcon
                name={verificationIcon(status)}
                size={16}
                color={verificationColor(status)}
              />
              <Text
                className="text-text1"
                style={{ marginLeft: 8, fontSize: 15, fontWeight: '600' }}
              >
                {status}
              </Text>
              <View style={{ marginLeft: 8 }}>
                <SakuraIcon
                  size={16}
                  color={Colors.accentRose}
                  animating={isSakuraAnimating}
                />
              </View>
            </View>
          </View>
        </View>

        <SectionCard>
          <Text className="text-text1" style={{ fontSize: 17, fontWeight: '600' }}>
            Contact
          </Text>
          <View style={{ marginTop: 8 }}>
            {card?.email ? (
              <InfoRow icon="envelope" title="Email" value={card.email} />
            ) : null}
            <InfoRow
              icon="calendar"
              title="Last Interaction"
              value={relativeDate(contact?.lastInteraction ?? contact?.receivedAt)}
            />
            {latestIncoming ? (
              <>
                <View
                  style={{
                    height: 0.5,
                    backgroundColor: Colors.divider,
                    marginVertical: 10,
                  }}
                />
                <View className="flex-row" style={{ paddingTop: 2 }}>
                  <View style={{ marginTop: 2 }}>
                    <SakuraIcon size={20} color={Colors.accentRose} animating={true} />
                  </View>
                  <View style={{ marginLeft: 12, flex: 1 }}>
                    <Text className="text-accentRose" style={{ fontSize: 14 }}>
                      Latest Sakura
                    </Text>
                    <Text className="text-text1" style={{ fontSize: 15, marginTop: 4 }}>
                      {latestIncoming.body || latestIncoming.subject}
                    </Text>
                  </View>
                </View>
              </>
            ) : null}
          </View>
        </SectionCard>

        <SectionCard>
          <Text className="text-text1" style={{ fontSize: 17, fontWeight: '600' }}>
            Tags
          </Text>
          {tags.length === 0 ? (
            <Text className="text-text2" style={{ fontSize: 15, marginTop: 8 }}>
              No tags available
            </Text>
          ) : (
            <View
              className="flex-row flex-wrap"
              style={{ marginTop: 8, gap: 8 }}
            >
              {tags.map((tag) => (
                <View
                  key={tag}
                  className="bg-searchBg"
                  style={{
                    paddingHorizontal: 8,
                    paddingVertical: 4,
                    borderRadius: 8,
                  }}
                >
                  <Text className="text-text1" style={{ fontSize: 12 }}>
                    #{tag}
                  </Text>
                </View>
              ))}
            </View>
          )}
        </SectionCard>

        <SectionCard>
          <View className="flex-row items-center">
            <SakuraIcon
              size={20}
              color={Colors.accentRose}
              animating={isSakuraAnimating}
            />
            <Text
              className="text-text1"
              style={{ marginLeft: 8, fontSize: 17, fontWeight: '600' }}
            >
              Message History
            </Text>
            <View style={{ flex: 1 }} />
            {messages.length > 0 ? (
              <View
                className="bg-searchBg"
                style={{
                  paddingHorizontal: 8,
                  paddingVertical: 4,
                  borderRadius: 8,
                }}
              >
                <Text className="text-text2" style={{ fontSize: 12 }}>
                  {String(messages.length)}
                </Text>
              </View>
            ) : null}
          </View>
          {messages.length === 0 ? (
            <View
              className="flex-row items-center justify-center"
              style={{ paddingVertical: 16 }}
            >
              <SfIcon
                name="bubble.left.and.bubble.right"
                size={14}
                color={Colors.text2}
              />
              <Text className="text-text2" style={{ marginLeft: 8, fontSize: 15 }}>
                No message history yet
              </Text>
            </View>
          ) : (
            <View style={{ marginTop: 12, gap: 12 }}>
              {messages.slice(0, 5).map((m) => (
                <MessageBullet key={m.id} message={m} />
              ))}
              {messages.length > 5 ? (
                <Text
                  className="text-accentRose"
                  style={{ fontSize: 12, textAlign: 'center', marginTop: 4 }}
                >
                  + {String(messages.length - 5)} more messages
                </Text>
              ) : null}
            </View>
          )}
        </SectionCard>

        <View style={{ paddingHorizontal: 16, marginTop: 24, gap: 16 }}>
          <ThemedButton
            label="Send Sakura"
            fullWidth
            leadingIcon={<SakuraIcon size={20} color={Colors.cardBg} animating={isSakuraAnimating} />}
            onPress={onSendSakura}
          />
          <View className="flex-row" style={{ gap: 12 }}>
            <View style={{ flex: 1 }}>
              <ThemedButton
                variant="secondary"
                label="View Profile"
                fullWidth
                onPress={onViewProfile}
              />
            </View>
            <View style={{ flex: 1 }}>
              <ThemedButton
                variant="secondary"
                label="Share"
                fullWidth
                onPress={() => void onShare()}
              />
            </View>
          </View>
          <ThemedButton
            variant="destructive"
            label="Delete Contact"
            fullWidth
            onPress={onDelete}
          />
        </View>
      </ScrollView>
    </View>
  );
}
