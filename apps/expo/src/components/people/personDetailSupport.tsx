import type { SFSymbol } from 'expo-symbols';
import type { ReactNode } from 'react';
import { Linking, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { PressableScale } from '@/components/common/PressableScale';
import { SfIcon } from '@/components/icons/SfIcon';
import { ThemedSurface, ThemedText } from '@/components/themed';
import { Colors } from '@/constants/Colors';
import { appAlert } from '@/feedback/appAlert';
import { useTranslation } from '@/i18n';
import type { Contact, SocialPlatform } from '@solidarity/shared';

export interface PersonDetailContactRow {
  readonly id: string;
  readonly icon: SFSymbol;
  readonly labelKey?: 'personDetail.phone' | 'personDetail.email';
  readonly label?: string;
  readonly value: string;
  readonly url: string;
}

/** Build only actionable rows from real fields on the received card. */
export function buildContactRows(contact: Contact): readonly PersonDetailContactRow[] {
  const rows: PersonDetailContactRow[] = [];
  const phone = contact.businessCard.phone?.trim();
  if (phone) {
    rows.push({
      id: 'phone',
      icon: 'phone',
      labelKey: 'personDetail.phone',
      value: phone,
      url: `tel:${phone}`,
    });
  }

  const email = contact.businessCard.email?.trim();
  if (email) {
    rows.push({
      id: 'email',
      icon: 'envelope',
      labelKey: 'personDetail.email',
      value: email,
      url: `mailto:${email}`,
    });
  }

  for (const network of contact.businessCard.socialNetworks) {
    const url = network.url?.trim();
    if (!url || !isHttpUrl(url)) continue;
    rows.push({
      id: `social:${network.id}`,
      icon: socialIcon(network.platform),
      label: network.platform,
      value: url,
      url,
    });
  }
  return rows;
}

export function PersonDetailContactRowView({
  row,
  divided = false,
}: {
  readonly row: PersonDetailContactRow;
  readonly divided?: boolean;
}): ReactNode {
  const { t } = useTranslation();
  const label = row.labelKey ? t(row.labelKey) : row.label ?? '';

  const open = (): void => {
    void Linking.openURL(row.url).catch(() => {
      appAlert({
        title: t('mePage.linkErrorTitle'),
        message: t('mePage.linkErrorMessage'),
      });
    });
  };

  return (
    <PressableScale
      onPress={open}
      accessibilityRole="link"
      accessibilityLabel={`${label}, ${row.value}`}
      className="flex-row items-center gap-3 px-4"
      style={{ minHeight: 62 }}
    >
      <View style={{ width: 24, alignItems: 'center' }}>
        <SfIcon name={row.icon} size={18} color={Colors.text1} />
      </View>
      <View style={{ flex: 1, minWidth: 0, paddingVertical: 9, gap: 1 }}>
        <ThemedText variant="bodySmall" tone="secondary" numberOfLines={1}>
          {label}
        </ThemedText>
        <ThemedText variant="bodyMedium" numberOfLines={1} selectable>
          {row.value}
        </ThemedText>
      </View>
      <SfIcon name="arrow.up.right" size={13} color={Colors.text3} />
      {divided ? <RowDivider /> : null}
    </PressableScale>
  );
}

export function StatusTag({ contact }: { readonly contact: Contact }): ReactNode {
  const { t } = useTranslation();
  switch (contact.verificationStatus) {
    case 'Verified':
      return (
        <ChipBase
          icon="checkmark.seal.fill"
          iconColor={Colors.terminalGreen}
          label={contact.exchangeTimestamp
            ? t('personDetail.verifiedOn', { date: formatIsoDate(contact.exchangeTimestamp) })
            : t('personDetail.verified')}
        />
      );
    case 'Pending':
      return <ChipBase icon="clock" iconColor={Colors.warningText} label={t('personDetail.pending')} />;
    case 'Failed':
      return <ChipBase icon="xmark.seal.fill" iconColor={Colors.destructive} label={t('personDetail.failed')} />;
    case 'Unverified':
      return <ChipBase icon="circle.dashed" iconColor={Colors.text3Strong} label={t('personDetail.unverified')} />;
  }
}

export function ContextTag({ label }: { readonly label: string }): ReactNode {
  return (
    <ChipBase
      icon="person.text.rectangle"
      iconColor={Colors.text2}
      label={label}
    />
  );
}

function ChipBase({
  icon,
  iconColor,
  label,
}: {
  readonly icon: SFSymbol;
  readonly iconColor: string;
  readonly label: string;
}): ReactNode {
  return (
    <ThemedSurface
      variant="inset"
      className="flex-row items-center gap-1.5 px-2 py-1"
      style={{ borderRadius: 999 }}
    >
      <SfIcon name={icon} size={11} color={iconColor} />
      <ThemedText variant="caption" tone="secondary" numberOfLines={1}>
        {label}
      </ThemedText>
    </ThemedSurface>
  );
}

function RowDivider(): ReactNode {
  return (
    <View
      pointerEvents="none"
      style={{
        position: 'absolute',
        left: 52,
        right: 0,
        bottom: 0,
        borderBottomWidth: 0.5,
        borderBottomColor: Colors.divider,
      }}
    />
  );
}

function isHttpUrl(raw: string): boolean {
  try {
    const protocol = new URL(raw).protocol;
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

function socialIcon(platform: SocialPlatform): SFSymbol {
  switch (platform) {
    case 'Website':
      return 'globe';
    case 'Instagram':
      return 'camera';
    case 'LinkedIn':
      return 'person.text.rectangle';
    case 'Twitter':
      return 'at';
    case 'Facebook':
      return 'person.crop.circle';
    case 'GitHub':
    case 'Other':
      return 'link';
  }
}

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

export function formatIsoDate(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${String(yyyy)}-${mm}-${dd}`;
}
