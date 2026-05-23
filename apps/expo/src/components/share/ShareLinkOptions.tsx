/**
 * ShareLinkOptions — 1:1 port of ShareLinkOptionsView.swift +
 * ShareLinkOptionsComponents.swift.
 *
 * Lets the user generate a one-off share link backed by a chosen
 * sharing-level + max-uses + expiration-hours. The actual link creation
 * is delegated upward via `onCreate`; this view is purely
 * configuration + preview + the "Created!" success sheet.
 *
 * Both screens (config + created-link) are exported so callers can host
 * them in a router route or a modal.
 */
import type { ReactNode } from 'react';
import { useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import * as Sharing from 'expo-sharing';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { SFSymbol } from 'expo-symbols';

import { SfIcon } from '@/components/icons/SfIcon';
import { ThemedButton, ThemedSurface } from '@/components/themed';
import { Colors } from '@/constants/Colors';
import { pushToast } from '@/feedback/toast';
import type { BusinessCard, SharingLevel } from '@solidarity/shared';

export interface ShareLink {
  readonly id: string;
  readonly url: string;
  readonly maxUses: number;
  readonly expirationDate: Date;
  readonly sharingLevel: SharingLevel;
}

export interface CreateShareLinkInput {
  readonly card: BusinessCard;
  readonly sharingLevel: SharingLevel;
  readonly maxUses: number;
  readonly expirationHours: number;
}

export interface ShareLinkOptionsProps {
  readonly visible: boolean;
  readonly businessCard: BusinessCard;
  readonly sharingLevel: SharingLevel;
  readonly onClose: () => void;
  readonly onCreate: (
    input: CreateShareLinkInput
  ) => Promise<{ ok: true; link: ShareLink } | { ok: false; error: string }>;
}

const MAX_USES: readonly number[] = [1, 3, 5, 10, 25, 50];
const EXPIRATION_HOURS: readonly number[] = [1, 6, 12, 24, 48, 72, 168];

const LEVEL_LABEL: Readonly<Record<SharingLevel, string>> = {
  public: 'Public',
  professional: 'Professional',
  personal: 'Personal',
};

export function ShareLinkOptions({
  visible,
  businessCard,
  sharingLevel,
  onClose,
  onCreate,
}: ShareLinkOptionsProps): ReactNode {
  const insets = useSafeAreaInsets();
  const [maxUses, setMaxUses] = useState(1);
  const [expirationHours, setExpirationHours] = useState(24);
  const [createdLink, setCreatedLink] = useState<ShareLink | null>(null);

  const create = async (): Promise<void> => {
    const res = await onCreate({
      card: businessCard,
      sharingLevel,
      maxUses,
      expirationHours,
    });
    if (res.ok) {
      setCreatedLink(res.link);
    } else {
      pushToast(res.error, 'error');
    }
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={[styles.root, { paddingTop: insets.top }]}>
        <NavBar title="Share Link" onClose={onClose} />
        <ScrollView contentContainerStyle={styles.scroll}>
          <View style={styles.header}>
            <SfIcon name="link.circle" size={60} color={Colors.primaryBlue} />
            <Text style={styles.title}>Create Share Link</Text>
            <Text style={styles.subtitle}>
              Generate a secure link that others can use to access your business card
            </Text>
          </View>

          <BusinessCardSummary card={businessCard} level={sharingLevel} />

          <ThemedSurface variant="card" padded style={styles.section}>
            <Text style={styles.sectionTitle}>Maximum Uses</Text>
            <Text style={styles.sectionSub}>How many times can this link be used?</Text>
            <View style={styles.gridThree}>
              {MAX_USES.map((u) => (
                <UsesOptionButton
                  key={String(u)}
                  uses={u}
                  isSelected={maxUses === u}
                  onPress={() => { setMaxUses(u); }}
                />
              ))}
            </View>

            <Text style={[styles.sectionTitle, styles.gap]}>Expiration Time</Text>
            <Text style={styles.sectionSub}>When should this link expire?</Text>
            <View style={styles.gridTwo}>
              {EXPIRATION_HOURS.map((h) => (
                <ExpirationOptionButton
                  key={String(h)}
                  hours={h}
                  isSelected={expirationHours === h}
                  onPress={() => { setExpirationHours(h); }}
                />
              ))}
            </View>
          </ThemedSurface>

          <SecurityNotice />

          <View style={styles.actions}>
            <ThemedButton
              fullWidth
              label="Create Share Link"
              leadingIcon={<SfIcon name="plus.circle.fill" size={14} color="#FFFFFF" />}
              onPress={() => { void create(); }}
            />
            <Pressable accessibilityRole="button" onPress={onClose}>
              <Text style={styles.cancelLink}>Cancel</Text>
            </Pressable>
          </View>
        </ScrollView>

        {createdLink ? (
          <CreatedLinkView
            link={createdLink}
            onDismiss={() => {
              setCreatedLink(null);
              onClose();
            }}
          />
        ) : null}
      </View>
    </Modal>
  );
}

function BusinessCardSummary({
  card,
  level,
}: {
  readonly card: BusinessCard;
  readonly level: SharingLevel;
}): ReactNode {
  return (
    <ThemedSurface variant="card" padded style={styles.section}>
      <View style={styles.summaryHeader}>
        <Text style={styles.sectionTitle}>What will be shared</Text>
        <View style={styles.levelBadge}>
          <Text style={styles.levelBadgeText}>{LEVEL_LABEL[level]}</Text>
        </View>
      </View>
      <FieldRow label="Name" value={card.name} />
      {card.title ? <FieldRow label="Title" value={card.title} /> : null}
      {card.company ? <FieldRow label="Company" value={card.company} /> : null}
      {card.email ? <FieldRow label="Email" value={card.email} /> : null}
      {card.phone ? <FieldRow label="Phone" value={card.phone} /> : null}
      {card.skills.length > 0 ? (
        <FieldRow label="Skills" value={card.skills.map((s) => s.name).join(', ')} />
      ) : null}
    </ThemedSurface>
  );
}

function FieldRow({ label, value }: { readonly label: string; readonly value: string }): ReactNode {
  return (
    <View style={styles.fieldRow}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <Text style={styles.fieldValue} numberOfLines={1}>{value}</Text>
    </View>
  );
}

function UsesOptionButton({
  uses,
  isSelected,
  onPress,
}: {
  readonly uses: number;
  readonly isSelected: boolean;
  readonly onPress: () => void;
}): ReactNode {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: isSelected }}
      onPress={onPress}
      style={[styles.optionBox, isSelected ? styles.optionBoxActive : null]}
    >
      <Text style={[styles.optionValue, isSelected ? styles.optionValueActive : null]}>
        {String(uses)}
      </Text>
      <Text style={[styles.optionCaption, isSelected ? styles.optionValueActive : null]}>
        {uses === 1 ? 'use' : 'uses'}
      </Text>
    </Pressable>
  );
}

function ExpirationOptionButton({
  hours,
  isSelected,
  onPress,
}: {
  readonly hours: number;
  readonly isSelected: boolean;
  readonly onPress: () => void;
}): ReactNode {
  const display = hours < 24 ? `${String(hours)}h` : `${String(Math.floor(hours / 24))}d`;
  const full = hours < 24
    ? hours === 1 ? '1 hour' : `${String(hours)} hours`
    : Math.floor(hours / 24) === 1 ? '1 day' : `${String(Math.floor(hours / 24))} days`;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: isSelected }}
      onPress={onPress}
      style={[styles.optionBox, isSelected ? styles.optionBoxActive : null]}
    >
      <Text style={[styles.optionValue, isSelected ? styles.optionValueActive : null]}>
        {display}
      </Text>
      <Text style={[styles.optionCaption, isSelected ? styles.optionValueActive : null]}>
        {full}
      </Text>
    </Pressable>
  );
}

function SecurityNotice(): ReactNode {
  return (
    <ThemedSurface variant="outlined" padded style={styles.notice}>
      <View style={styles.row}>
        <SfIcon name="shield.checkered" size={16} color={Colors.warning} />
        <Text style={styles.noticeTitle}>Security Notice</Text>
      </View>
      <Text style={styles.noticeBullet}>• Links are encrypted and secure</Text>
      <Text style={styles.noticeBullet}>• You can deactivate links at any time</Text>
      <Text style={styles.noticeBullet}>• Links automatically expire after the set time</Text>
      <Text style={styles.noticeBullet}>• Usage is tracked and limited</Text>
    </ThemedSurface>
  );
}

function CreatedLinkView({
  link,
  onDismiss,
}: {
  readonly link: ShareLink;
  readonly onDismiss: () => void;
}): ReactNode {
  const insets = useSafeAreaInsets();
  const shareLink = async (): Promise<void> => {
    if (!(await Sharing.isAvailableAsync())) {
      pushToast('Share sheet not available on this device.', 'warning');
      return;
    }
    await Sharing.shareAsync(link.url);
  };
  const copyLink = async (): Promise<void> => {
    await Clipboard.setStringAsync(link.url);
    pushToast('Link copied to clipboard.', 'success');
  };

  return (
    <Modal visible animationType="slide" onRequestClose={onDismiss}>
      <View style={[styles.root, { paddingTop: insets.top }]}>
        <NavBar title="Share Link Created" onClose={onDismiss} />
        <ScrollView contentContainerStyle={styles.scroll}>
          <View style={styles.header}>
            <SfIcon name="checkmark.circle.fill" size={64} color={Colors.terminalGreen} />
            <Text style={styles.title}>Share Link Created!</Text>
            <Text style={styles.subtitle}>Your secure sharing link is ready to use</Text>
          </View>

          <ThemedSurface variant="card" padded style={styles.section}>
            <Text style={styles.sectionTitle}>Link Details</Text>
            <LinkDetail icon="link" label="Share URL" value={link.url} />
            <LinkDetail icon="number" label="Max Uses" value={String(link.maxUses)} />
            <LinkDetail
              icon="clock"
              label="Expires"
              value={link.expirationDate.toLocaleString()}
            />
            <LinkDetail
              icon="eye"
              label="Privacy Level"
              value={LEVEL_LABEL[link.sharingLevel]}
            />
          </ThemedSurface>

          <View style={styles.actions}>
            <ThemedButton
              fullWidth
              label="Share Link"
              leadingIcon={<SfIcon name="square.and.arrow.up" size={14} color="#FFFFFF" />}
              onPress={() => { void shareLink(); }}
            />
            <ThemedButton
              fullWidth
              variant="secondary"
              label="Copy Link"
              leadingIcon={<SfIcon name="doc.on.doc" size={14} color={Colors.accentRose} />}
              onPress={() => { void copyLink(); }}
            />
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}

function LinkDetail({
  icon,
  label,
  value,
}: {
  readonly icon: string;
  readonly label: string;
  readonly value: string;
}): ReactNode {
  return (
    <View style={styles.linkDetail}>
      <SfIcon name={icon as SFSymbol} size={16} color={Colors.primaryBlue} />
      <View style={styles.flex}>
        <Text style={styles.linkLabel}>{label}</Text>
        <Text style={styles.linkValue}>{value}</Text>
      </View>
    </View>
  );
}

function NavBar({ title, onClose }: { readonly title: string; readonly onClose: () => void }): ReactNode {
  return (
    <View style={styles.navBar}>
      <View style={styles.navSpacer} />
      <Text style={styles.navTitle}>{title}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Done"
        onPress={onClose}
        style={styles.navAction}
      >
        <Text style={styles.navActionText}>Done</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.pageBg },
  navBar: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 44,
    paddingHorizontal: 16,
  },
  navSpacer: { width: 60 },
  navTitle: { flex: 1, textAlign: 'center', color: Colors.text1, fontSize: 17, fontWeight: '600' },
  navAction: { minWidth: 60, height: 44, alignItems: 'flex-end', justifyContent: 'center' },
  navActionText: { color: Colors.primaryBlue, fontSize: 15, fontWeight: '600' },
  scroll: { padding: 16, gap: 16 },

  header: { alignItems: 'center', gap: 12, paddingVertical: 16 },
  title: { color: Colors.text1, fontSize: 24, fontWeight: '700' },
  subtitle: { color: Colors.text2, fontSize: 14, textAlign: 'center', paddingHorizontal: 16 },

  section: { gap: 12 },
  sectionTitle: { color: Colors.text1, fontSize: 17, fontWeight: '600' },
  sectionSub: { color: Colors.text2, fontSize: 14 },
  gap: { marginTop: 20 },

  summaryHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  levelBadge: {
    marginLeft: 'auto',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
    backgroundColor: `${Colors.primaryBlue}33`,
  },
  levelBadgeText: { color: Colors.primaryBlue, fontSize: 12, fontWeight: '600' },

  fieldRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 4 },
  fieldLabel: { width: 70, color: Colors.text2, fontSize: 12 },
  fieldValue: { flex: 1, color: Colors.text1, fontSize: 13 },

  gridThree: { flexDirection: 'row', flexWrap: 'wrap' },
  gridTwo: { flexDirection: 'row', flexWrap: 'wrap' },
  optionBox: {
    width: '32%',
    alignItems: 'center',
    paddingVertical: 12,
    marginBottom: 8,
    marginRight: '2%',
    backgroundColor: Colors.searchBg,
    borderRadius: 8,
    gap: 4,
  },
  optionBoxActive: { backgroundColor: Colors.primaryBlue },
  optionValue: { color: Colors.text1, fontSize: 17, fontWeight: '700' },
  optionValueActive: { color: '#FFFFFF' },
  optionCaption: { color: Colors.text2, fontSize: 11 },

  notice: { gap: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  noticeTitle: { color: Colors.warning, fontSize: 16, fontWeight: '600' },
  noticeBullet: { color: Colors.text2, fontSize: 12 },

  actions: { gap: 12, paddingTop: 8 },
  cancelLink: { color: Colors.text2, fontSize: 14, textAlign: 'center', paddingVertical: 12 },

  linkDetail: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingVertical: 6 },
  flex: { flex: 1 },
  linkLabel: { color: Colors.text2, fontSize: 12 },
  linkValue: { color: Colors.text1, fontSize: 14, marginTop: 2 },
});
