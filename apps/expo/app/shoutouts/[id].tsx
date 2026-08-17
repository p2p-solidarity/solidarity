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
 *
 * Visual helpers (AvatarRing, SectionCard, InfoRow, …) live in
 * `@/shoutouts/ui` so this file stays under 500 LOC.
 */
import { router, useLocalSearchParams } from 'expo-router';
import { safeBack } from '@/navigation/safeBack';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { ScrollView, Share, Text, View } from 'react-native';
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
import { confirmDialog } from '@/feedback/confirmDialog';
import { pushToast } from '@/feedback/toast';
import { useShoutoutStore } from '@/shoutouts/store';
import {
  AvatarRing,
  InfoRow,
  MessageBullet,
  SectionCard,
  relativeDate,
  verificationColor,
  verificationIcon,
} from '@/shoutouts/ui';

export default function ShoutoutDetail(): ReactNode {
  const insets = useSafeAreaInsets();
  const { id, name } = useLocalSearchParams<{ id: string; name?: string }>();
  const contact = useContact(id);
  const removeContact = useContactStore((s) => s.remove);
  const seedFromManifest = useShoutoutStore((s) => s.seedFromManifest);
  const hydrateShoutouts = useShoutoutStore((s) => s.hydrate);
  const shoutoutItems = useShoutoutStore((s) => s.items);
  const shoutoutManifest = useShoutoutStore((s) => s.manifest);
  const [isSakuraAnimating, setIsSakuraAnimating] = useState(false);

  useEffect(() => {
    setIsSakuraAnimating(true);
    // Seed the manifest synchronously so the per-counterpart message
    // count badge can paint on frame 1 even before `hydrate()` decrypts
    // the bodies needed for the bullet list.
    seedFromManifest();
    void hydrateShoutouts();
  }, [hydrateShoutouts, seedFromManifest]);

  const displayName = contact?.businessCard.name ?? name ?? 'Sakura';
  const status = contact?.verificationStatus ?? 'Unverified';
  const card = contact?.businessCard;
  const tags = contact?.tags ?? [];

  const messages = useMemo(
    () => shoutoutItems.filter((m) => m.counterpartName === displayName),
    [shoutoutItems, displayName]
  );
  // Frame-1 count: read from the manifest so the badge renders without
  // waiting for `hydrate()` to decrypt every body. Falls back to the
  // hydrated `messages` length once details land (same number, but
  // recomputed defensively in case a new send happens mid-screen).
  const messageCount = messages.length > 0
    ? messages.length
    : shoutoutManifest.filter((m) => m.counterpartName === displayName).length;
  const latestIncoming = useMemo(
    () => messages.find((m) => m.direction === 'incoming'),
    [messages]
  );

  const onSendSakura = (): void => {
    router.push({
      pathname: '/shoutouts/new',
      params: { id, name: displayName },
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
    void (async () => {
      const ok = await confirmDialog({
        title: 'Delete Contact?',
        message: `Are you sure you want to delete ${displayName}? This action cannot be undone.`,
        confirmLabel: 'Delete',
        destructive: true,
      });
      if (!ok) return;
      await removeContact(contact.id);
      pushToast(`Deleted ${displayName}`, 'success');
      safeBack();
    })();
  };

  return (
    <View className="flex-1 bg-pageBg" style={{ paddingTop: insets.top }}>
      <View pointerEvents="none" style={{ position: 'absolute', left: 100, top: -80 }}>
        <DecorativeBlobs />
      </View>

      <SettingsBackToolbar title="Close" onPress={() => { safeBack(); }} />
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
            {messageCount > 0 ? (
              <View
                className="bg-searchBg"
                style={{
                  paddingHorizontal: 8,
                  paddingVertical: 4,
                  borderRadius: 8,
                }}
              >
                <Text className="text-text2" style={{ fontSize: 12 }}>
                  {String(messageCount)}
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
