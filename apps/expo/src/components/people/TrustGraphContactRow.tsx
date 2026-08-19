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
import { Pressable, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';

import { SfIcon } from '@/components/icons/SfIcon';
import { ThemedText } from '@/components/themed';
import { Colors } from '@/constants/Colors';
import type { ContactManifestEntry } from '@/contacts/repository';
import { haptic } from '@/feedback/haptics';
import { SCALE, SPRING } from '@/feedback/motion';
import { useTranslation } from '@/i18n';

export interface TrustGraphContactRowProps {
  contact: ContactManifestEntry;
  onPress?: () => void;
  onLongPress?: () => void;
}

export function TrustGraphContactRow({
  contact,
  onPress,
  onLongPress,
}: TrustGraphContactRowProps) {
  const { t } = useTranslation();
  const isVerified = contact.verificationStatus === 'Verified';
  const subtitle = subtitleText(contact);
  const tag = contextTag(contact, t);

  // Touch-down shrinks the row (crisp, damped); a long-press lifts it back
  // *up* past rest (the "zoom" pickup) and fires a heavier impact right as
  // edit/select mode arms. Release springs either back to rest.
  const scale = useSharedValue(1);
  const animStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  return (
    <Animated.View style={animStyle}>
      <Pressable
        onPressIn={() => {
          scale.value = withSpring(SCALE.press, SPRING.press);
        }}
        onPressOut={() => {
          scale.value = withSpring(1, SPRING.press);
        }}
        onPress={() => {
          haptic('tap');
          onPress?.();
        }}
        onLongPress={() => {
          scale.value = withSpring(SCALE.longPress, SPRING.zoom);
          haptic('heavy');
          onLongPress?.();
        }}
        accessibilityRole="button"
      >
        <View className="flex-col" style={{ borderRadius: 0 }}>
          <View className="flex-row items-center gap-3 px-4 py-3">
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
                <ThemedText variant="bodySmall" tone="secondary">
                  {initial(contact.name)}
                </ThemedText>
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

            <View className="flex-1 gap-0.5">
              <View className="flex-row items-center gap-3">
                <View className="flex-1">
                  <ThemedText
                    variant="bodyMedium"
                    numberOfLines={1}
                  >
                    {contact.name}
                  </ThemedText>
                  {subtitle ? (
                    <ThemedText
                      variant="bodySmall"
                      tone="secondary"
                      numberOfLines={1}
                    >
                      {subtitle}
                    </ThemedText>
                  ) : null}
                </View>
                <SfIcon name="chevron.right" size={12} color={Colors.text3} />
              </View>
              <ThemedText variant="caption" tone="secondary" numberOfLines={1}>
                {tag ?? sourceLabel(contact.source, t)} · {formatIsoDate(contact.receivedAt)}
              </ThemedText>
            </View>
          </View>

          <View
            style={{ borderBottomWidth: 0.5, borderBottomColor: Colors.divider, marginLeft: 67 }}
          />
        </View>
      </Pressable>
    </Animated.View>
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

/**
 * Single meeting-context tag (Figma 723:2211 / 723:2231). Prefers a
 * user-applied tag (e.g. "在 DID Workshop 認識的"), which is real user data and
 * stays verbatim. Otherwise falls back to a localized source-derived default
 * so the zh-Hant locale renders Figma's "#手機通訊錄" (phone) etc. 1:1 port of
 * Swift TrustGraphContactRow.contextTag — the label is always driven by
 * `contact.source`, never hardcoded per row.
 */
function contextTag(
  c: Pick<ContactManifestEntry, 'source' | 'tags'>,
  t: (key: string) => string,
): string | undefined {
  const customTag = c.tags
    .map((tag) => tag.trim())
    .find((tag) => tag.length > 0);
  if (customTag) return customTag;
  const source = c.source.trim().toLowerCase();
  switch (source) {
    case 'imported':
      return t('peopleList.sourcePhoneContacts');
    case 'manual':
      return t('peopleList.sourceAddedManually');
    case 'qrcode':
    case 'qr_code':
    case 'qr code':
    case 'proximity':
    case 'appclip':
    case 'app_clip':
    case 'app clip':
    case 'airdrop':
      return t('peopleList.sourceMetInPerson');
    default:
      return undefined;
  }
}

function sourceLabel(source: ContactManifestEntry['source'], t: (key: string) => string): string {
  return contextTag({ source, tags: [] }, t) ?? source;
}

function formatIsoDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}
