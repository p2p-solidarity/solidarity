/**
 * personDetailSupport — helpers for PersonDetailView (apps/expo/app/people/[id].tsx).
 *
 * 1:1 port of solidarity/Views/PeopleViews/PersonDetailViewSupport.swift plus
 * the inline helpers that live inside PersonDetailView.swift (status tag,
 * context tag, declared-claim chip, asymmetric chat-bubble shape, contact-info
 * row). Kept in a sibling file so [id].tsx stays under the 500-LOC cap.
 *
 * Visual contract pinned byte-for-byte to the Swift impl: colours come from
 * Color.Theme.* (mirrored via Colors.ts) and fonts match Swift's
 * .system(size:weight:design:) calls.
 */
import type { SFSymbol } from 'expo-symbols';
import type { ReactNode } from 'react';
import { Linking, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { PressableScale } from '@/components/common/PressableScale';
import { SfIcon } from '@/components/icons/SfIcon';
import { Colors } from '@/constants/Colors';
import { appAlert } from '@/feedback/appAlert';
import { useTranslation } from '@/i18n';
import type { Contact, ContactSource, VerificationStatus } from '@solidarity/shared';

// ─────────────────────────────────────────────────────────────────────────────
// Contact-info row model
// ─────────────────────────────────────────────────────────────────────────────

export interface PersonDetailContactRow {
  readonly id: 'phone' | 'email' | 'link';
  readonly icon: SFSymbol;
  readonly value: string;
  readonly url: string | undefined;
}

/** Build the contact-info rows shown beneath the hero. Skips empty fields. */
export function buildContactRows(contact: Contact): readonly PersonDetailContactRow[] {
  const out: PersonDetailContactRow[] = [];
  const phone = contact.businessCard.phone?.trim() ?? '';
  if (phone.length > 0) {
    out.push({ id: 'phone', icon: 'phone', value: phone, url: `tel:${phone}` });
  }
  const email = contact.businessCard.email?.trim() ?? '';
  if (email.length > 0) {
    out.push({ id: 'email', icon: 'envelope', value: email, url: `mailto:${email}` });
  }
  // graphCredentialRef is a Swift-only field today; if a future schema add
  // surfaces a web URL on the JS side, mirror the Swift filter (http/https
  // only) here. Leaving the slot wired-but-empty mirrors the Swift behaviour
  // for contacts saved before the field existed.
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Contact-info row view — 48pt tall, 12pt horiz pad, mutedSurface fill
// ─────────────────────────────────────────────────────────────────────────────

export function PersonDetailContactRowView({
  row,
}: {
  readonly row: PersonDetailContactRow;
}): ReactNode {
  const { t } = useTranslation();
  const onPress = (): void => {
    if (row.url) {
      void Linking.openURL(row.url).catch(() => {
        appAlert({
          title: t('mePage.linkErrorTitle'),
          message: t('mePage.linkErrorMessage'),
        });
      });
    }
  };
  return (
    <PressableScale
      onPress={onPress}
      accessibilityRole={row.url ? 'link' : undefined}
      accessibilityLabel={row.value}
    >
      <View
        className="flex-row items-center bg-mutedSurface rounded-sm2"
        style={{ height: 48, paddingHorizontal: 12 }}
      >
        <View style={{ width: 18, height: 18, alignItems: 'center', justifyContent: 'center', marginRight: 8 }}>
          <SfIcon name={row.icon} size={15} color={Colors.text1} />
        </View>
        <Text numberOfLines={1} className="text-text1 flex-1" style={{ fontSize: 15 }}>
          {row.value}
        </Text>
      </View>
    </PressableScale>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Verified / unverified status tag (10pt label, chipSurface fill, 2pt radius)
// ─────────────────────────────────────────────────────────────────────────────

export function StatusTag({ contact }: { readonly contact: Contact }): ReactNode {
  const isVerified = contact.verificationStatus === 'Verified';
  if (isVerified) {
    return (
      <ChipBase
        icon={<SfIcon name="checkmark.seal.fill" size={10} color={Colors.terminalGreen} />}
        label={verifiedLabel(contact.exchangeTimestamp)}
      />
    );
  }
  return (
    <ChipBase
      icon={<SfIcon name="circle.dashed" size={10} color={Colors.text3} />}
      label={unverifiedLabel(contact.source, contact.verificationStatus)}
    />
  );
}

/** "Verified · 2026-05-01" or "Verified" if no timestamp. */
function verifiedLabel(exchangeTimestamp: Date | undefined): string {
  if (exchangeTimestamp) return `Verified · ${formatIsoDate(exchangeTimestamp)}`;
  return 'Verified';
}

/**
 * Builds the actionable hint for non-verified contacts. Mirrors Swift's
 * switch on (source, status). Verbatim copy from PersonDetailView.swift.
 */
function unverifiedLabel(source: ContactSource, status: VerificationStatus): string {
  if (status === 'Failed') return 'verification failed';
  if (status === 'Pending') return 'pending verification';
  switch (source) {
    case 'QR Code':
      return 'scanned · not exchanged';
    case 'Manual':
      return 'added manually';
    case 'AirDrop':
      return 'via AirDrop · not exchanged';
    case 'App Clip':
      return 'via App Clip · not exchanged';
    case 'Proximity':
      return 'proximity · awaiting signature';
    default:
      return 'unverified';
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Context tag — first non-empty `tags[]` entry, pinned mappin.and.ellipse glyph
// ─────────────────────────────────────────────────────────────────────────────

export function ContextTag({ label }: { readonly label: string }): ReactNode {
  return (
    <ChipBase
      icon={<SfIcon name="mappin.and.ellipse" size={9} color={Colors.text2} />}
      label={label}
    />
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Declared-claim chip — outline (not filled) so users read "claims:" as a
// peer-declared claim, not as an attestation we re-verified.
// ─────────────────────────────────────────────────────────────────────────────

export function DeclaredClaimChip({ claimType }: { readonly claimType: string }): ReactNode {
  return (
    <View
      className="flex-row items-center"
      style={{
        paddingHorizontal: 4,
        paddingVertical: 2,
        borderRadius: 2,
        borderWidth: 1,
        borderColor: Colors.divider,
        columnGap: 4,
      }}
    >
      <View style={{ width: 12, height: 12, alignItems: 'center', justifyContent: 'center' }}>
        <SfIcon name={claimIcon(claimType)} size={10} color={Colors.text2} />
      </View>
      <Text
        className="text-text2"
        style={{ fontSize: 10, fontVariant: ['tabular-nums'], fontFamily: 'Menlo' }}
      >
        {claimDisplayName(claimType)}
      </Text>
    </View>
  );
}

function claimIcon(claimType: string): SFSymbol {
  switch (claimType) {
    case 'is_human':
      return 'person.fill.checkmark';
    case 'age_over_18':
      return 'calendar.badge.checkmark';
    default:
      return 'sparkles';
  }
}

function claimDisplayName(claimType: string): string {
  switch (claimType) {
    case 'is_human':
      return 'claims: real human';
    case 'age_over_18':
      return 'claims: 18+';
    default:
      return `claims: ${claimType}`;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared chip base (icon + 10pt text2 label, chipSurface, 2pt radius)
// ─────────────────────────────────────────────────────────────────────────────

function ChipBase({
  icon,
  label,
}: {
  readonly icon: ReactNode;
  readonly label: string;
}): ReactNode {
  return (
    <View
      className="flex-row items-center bg-chipSurface"
      style={{
        paddingHorizontal: 4,
        paddingVertical: 2,
        borderRadius: 2,
        columnGap: 4,
      }}
    >
      <View style={{ width: 12, height: 12, alignItems: 'center', justifyContent: 'center' }}>
        {icon}
      </View>
      <Text className="text-text2" style={{ fontSize: 10 }}>
        {label}
      </Text>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Asymmetric chat-bubble shape — square one bottom corner so the bubble
// looks anchored to its owner. Outgoing = bottom-right; incoming = bottom-left.
// Port of solidarity PersonDetailBubbleShape (4pt radius, 0 squared).
// ─────────────────────────────────────────────────────────────────────────────

export type BubbleCorner = 'outgoing' | 'incoming';

export function PersonDetailBubble({
  width,
  height,
  fillColor,
  corners,
}: {
  readonly width: number;
  readonly height: number;
  readonly fillColor: string;
  readonly corners: BubbleCorner;
}): ReactNode {
  const radius = 4;
  const squared = 0;
  const topLeft = radius;
  const topRight = radius;
  const bottomRight = corners === 'outgoing' ? squared : radius;
  const bottomLeft = corners === 'outgoing' ? radius : squared;
  const d =
    `M ${String(topLeft)} 0` +
    ` H ${String(width - topRight)}` +
    ` A ${String(topRight)} ${String(topRight)} 0 0 1 ${String(width)} ${String(topRight)}` +
    ` V ${String(height - bottomRight)}` +
    (bottomRight > 0
      ? ` A ${String(bottomRight)} ${String(bottomRight)} 0 0 1 ${String(width - bottomRight)} ${String(height)}`
      : ` L ${String(width)} ${String(height)}`) +
    ` H ${String(bottomLeft)}` +
    (bottomLeft > 0
      ? ` A ${String(bottomLeft)} ${String(bottomLeft)} 0 0 1 0 ${String(height - bottomLeft)}`
      : ` L 0 ${String(height)}`) +
    ` V ${String(topLeft)}` +
    ` A ${String(topLeft)} ${String(topLeft)} 0 0 1 ${String(topLeft)} 0` +
    ' Z';
  return (
    <Svg width={width} height={height} style={{ position: 'absolute' }} pointerEvents="none">
      <Path d={d} fill={fillColor} />
    </Svg>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Date formatter — yyyy-MM-dd (mirrors Swift PersonDetailView formatters)
// ─────────────────────────────────────────────────────────────────────────────

export function formatIsoDate(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${String(yyyy)}-${mm}-${dd}`;
}
