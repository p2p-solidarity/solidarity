/**
 * TrustGraphContactRow — 1:1 port of
 * solidarity/Views/PeopleViews/TrustGraphContactRow.swift.
 * Figma 723:2195 — round avatar | name + subtitle + context tag | radar
 * icon + ISO date column.
 *
 * Consumes a `ContactManifestEntry` (non-PII view of a Contact) so the row
 * stays paintable on frame 1 from the MMKV manifest, before full record
 * decryption resolves. The Swift `notes` fallback in the subtitle is
 * intentionally dropped here — notes stay encrypted-only and only surface
 * on the detail screen.
 */
import { Pressable, Text, View } from 'react-native';

import { SfIcon } from '@/components/icons/SfIcon';
import { Colors } from '@/constants/Colors';
import type { ContactManifestEntry } from '@/contacts/repository';

import { RadarTickIcon } from './RadarTickIcon';

export type TrustGraphContactRowProps = {
  contact: ContactManifestEntry;
  onPress?: () => void;
  onLongPress?: () => void;
};

export function TrustGraphContactRow({
  contact,
  onPress,
  onLongPress,
}: TrustGraphContactRowProps) {
  const isVerified = contact.verificationStatus === 'Verified';
  const subtitle = subtitleText(contact);
  const tag = contextTag(contact);

  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      accessibilityRole="button"
      className="active:opacity-80"
    >
      <View className="flex-col">
        <View className="flex-row items-start gap-4 p-3">
          <View
            className="overflow-hidden rounded-full bg-searchBg"
            style={{ width: 38, height: 38, borderWidth: 0.5, borderColor: Colors.searchBg }}
          >
            <View
              style={{
                flex: 1,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: Colors.searchBg,
              }}
            >
              <Text className="text-text2 text-[14px] font-medium">
                {initial(contact.name)}
              </Text>
            </View>
            {isVerified ? (
              <View
                style={{
                  position: 'absolute',
                  right: -2,
                  bottom: -2,
                  width: 14,
                  height: 14,
                  borderRadius: 7,
                  backgroundColor: Colors.pageBg,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <SfIcon
                  name="checkmark.seal.fill"
                  size={12}
                  color={Colors.terminalGreen}
                />
              </View>
            ) : null}
          </View>

          <View className="flex-1 gap-2">
            <View className="flex-row items-start gap-3">
              <View className="flex-1 gap-0.5">
                <Text
                  numberOfLines={1}
                  className="text-text1 text-[16px] font-medium"
                >
                  {contact.name}
                </Text>
                {subtitle ? (
                  <Text
                    numberOfLines={1}
                    ellipsizeMode="tail"
                    className="text-text2 text-[14px]"
                  >
                    {subtitle}
                  </Text>
                ) : null}
              </View>

              <View className="flex-row items-center gap-1">
                <RadarTickIcon size={16} />
                <Text className="text-text2 text-[10px]">
                  {formatIsoDate(contact.receivedAt)}
                </Text>
              </View>
            </View>

            {tag ? (
              <View className="flex-row gap-1.5">
                <View className="rounded-sm2 bg-searchBg px-1 py-0.5 self-start">
                  <Text className="text-text2 text-[10px]">{tag}</Text>
                </View>
              </View>
            ) : null}
          </View>
        </View>

        <View
          style={{ height: 1, backgroundColor: Colors.searchBg, marginHorizontal: 0 }}
        />
      </View>
    </Pressable>
  );
}

function initial(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length === 0) return '?';
  return trimmed.charAt(0).toUpperCase();
}

function subtitleText(c: ContactManifestEntry): string | undefined {
  const parts = [c.company, c.title]
    .map((p) => (p ?? '').trim())
    .filter((p) => p.length > 0);
  if (parts.length > 0) return parts.join(' • ');
  return undefined;
}

function contextTag(c: ContactManifestEntry): string | undefined {
  const customTag = c.tags
    .map((t) => t.trim())
    .find((t) => t.length > 0);
  if (customTag) return customTag;
  const source = c.source.trim().toLowerCase();
  switch (source) {
    case 'imported':
      return '#Phone Contacts';
    case 'manual':
      return 'Added manually';
    case 'qrcode':
    case 'qr_code':
    case 'qr code':
    case 'proximity':
    case 'appclip':
    case 'app_clip':
    case 'app clip':
    case 'airdrop':
      return 'Met in person';
    default:
      return undefined;
  }
}

function formatIsoDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}
