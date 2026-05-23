/**
 * ShareCardPickerSheet — 1:1 port of ShareCardPickerSheet.swift.
 *
 * Modal that lets the user pick the privacy `SharingLevel` before
 * advertising. Renders a segmented control + a preview of which fields
 * will be shared at that level. Start/Stop button mirrors the Swift
 * toolbar trailing action.
 */
import type { ReactNode } from 'react';
import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { SfIcon } from '@/components/icons/SfIcon';
import { ON_DARK, ThemedButton, ThemedSurface } from '@/components/themed';
import { Colors } from '@/constants/Colors';
import type { BusinessCard, SharingLevel } from '@solidarity/shared';

export interface ShareCardPickerSheetProps {
  readonly visible: boolean;
  readonly card: BusinessCard | undefined;
  readonly initialLevel?: SharingLevel;
  readonly isAdvertising: boolean;
  readonly onStart: (card: BusinessCard, level: SharingLevel) => void;
  readonly onStop: () => void;
  readonly onClose: () => void;
}

const LEVELS: readonly { level: SharingLevel; label: string }[] = [
  { level: 'public', label: 'Public' },
  { level: 'professional', label: 'Professional' },
  { level: 'personal', label: 'Personal' },
];

export function ShareCardPickerSheet({
  visible,
  card,
  initialLevel = 'professional',
  isAdvertising,
  onStart,
  onStop,
  onClose,
}: ShareCardPickerSheetProps): ReactNode {
  const insets = useSafeAreaInsets();
  const [level, setLevel] = useState<SharingLevel>(initialLevel);

  return (
    <Modal visible={visible} transparent={false} animationType="slide" onRequestClose={onClose}>
      <View style={[styles.root, { paddingTop: insets.top }]}>
        <View style={styles.navBar}>
          <Pressable accessibilityRole="button" onPress={onClose} style={styles.navAction}>
            <Text style={styles.navAction1}>Cancel</Text>
          </Pressable>
          <Text style={styles.navTitle}>Privacy Level</Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              if (isAdvertising) {
                onStop();
                onClose();
              } else if (card) {
                onStart(card, level);
                onClose();
              }
            }}
            disabled={!isAdvertising && !card}
            style={styles.navAction}
          >
            <Text style={[styles.navActionPrimary, !card && !isAdvertising ? styles.disabled : null]}>
              {isAdvertising ? 'Stop' : 'Start'}
            </Text>
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={styles.scroll}>
          <Section title="Privacy Level">
            <View style={styles.segmented}>
              {LEVELS.map((opt) => {
                const active = opt.level === level;
                return (
                  <Pressable
                    key={opt.level}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    onPress={() => { setLevel(opt.level); }}
                    style={[styles.segment, active ? styles.segmentActive : null]}
                  >
                    <Text style={[styles.segmentText, active ? styles.segmentTextActive : null]}>
                      {opt.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </Section>

          <Section title="Preview">
            {card ? (
              <ThemedSurface variant="card" padded>
                <View style={styles.previewRow}>
                  <Text style={styles.previewLabel}>What will be shared</Text>
                  <View style={styles.levelBadge}>
                    <Text style={styles.levelBadgeText}>{labelFor(level)}</Text>
                  </View>
                </View>
                <FieldRow label="Name" value={card.name} />
                {card.title ? <FieldRow label="Title" value={card.title} /> : null}
                {card.company ? <FieldRow label="Company" value={card.company} /> : null}
                {card.email ? <FieldRow label="Email" value={card.email} /> : null}
                {card.phone ? <FieldRow label="Phone" value={card.phone} /> : null}
                {card.skills.length > 0 ? (
                  <FieldRow
                    label="Skills"
                    value={card.skills.map((s) => s.name).join(', ')}
                  />
                ) : null}
              </ThemedSurface>
            ) : (
              <ThemedSurface variant="card" padded>
                <Text style={styles.muted}>No card available</Text>
              </ThemedSurface>
            )}
          </Section>

          <View style={styles.actionRow}>
            <ThemedButton
              fullWidth
              variant={isAdvertising ? 'destructive' : 'primary'}
              leadingIcon={
                <SfIcon
                  name={isAdvertising ? 'stop.fill' : 'antenna.radiowaves.left.and.right'}
                  size={14}
                  color={isAdvertising ? Colors.destructive : ON_DARK}
                />
              }
              label={isAdvertising ? 'Stop Advertising' : 'Start Advertising'}
              onPress={() => {
                if (isAdvertising) {
                  onStop();
                  onClose();
                } else if (card) {
                  onStart(card, level);
                  onClose();
                }
              }}
              disabled={!card && !isAdvertising}
            />
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}

function Section({ title, children }: { readonly title: string; readonly children: ReactNode }): ReactNode {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionHeader}>{title}</Text>
      {children}
    </View>
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

function labelFor(level: SharingLevel): string {
  return LEVELS.find((l) => l.level === level)?.label ?? 'Professional';
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.pageBg },
  navBar: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 44,
    paddingHorizontal: 16,
  },
  navTitle: { flex: 1, textAlign: 'center', color: Colors.text1, fontSize: 17, fontWeight: '600' },
  navAction: { minWidth: 60, height: 44, alignItems: 'center', justifyContent: 'center' },
  navAction1: { color: Colors.primaryBlue, fontSize: 15 },
  navActionPrimary: { color: Colors.primaryBlue, fontSize: 15, fontWeight: '600' },
  disabled: { opacity: 0.4 },
  scroll: { paddingHorizontal: 16, paddingBottom: 32 },

  section: { gap: 8, paddingTop: 16 },
  sectionHeader: {
    color: Colors.text2,
    fontSize: 13,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },

  segmented: {
    flexDirection: 'row',
    backgroundColor: Colors.searchBg,
    borderRadius: 8,
    padding: 2,
  },
  segment: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 8,
    borderRadius: 6,
  },
  segmentActive: { backgroundColor: Colors.cardBg },
  segmentText: { color: Colors.text2, fontSize: 14 },
  segmentTextActive: { color: Colors.text1, fontWeight: '600' },

  previewRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  previewLabel: { flex: 1, color: Colors.text1, fontSize: 15, fontWeight: '600' },
  levelBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
    backgroundColor: `${Colors.primaryBlue}33`,
  },
  levelBadgeText: { color: Colors.primaryBlue, fontSize: 12, fontWeight: '600' },

  fieldRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 4 },
  fieldLabel: { width: 70, color: Colors.text2, fontSize: 12 },
  fieldValue: { flex: 1, color: Colors.text1, fontSize: 13 },

  muted: { color: Colors.text2, fontSize: 14 },

  actionRow: { paddingTop: 24 },
});
