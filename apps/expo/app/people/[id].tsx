/**
 * PersonDetailView — 1:1 port of
 * solidarity/Views/PeopleViews/PersonDetailView.swift.
 *
 * Centred hero (avatar + name + note line + verified/unverified chip +
 * optional context tag + optional declared-claims row) with an edit pencil
 * at the top-right of the hero card. Below the hero sit the "sakura"
 * exchange messages (when present) and the contact-info rows. Tap the
 * pencil or top-bar share icon to surface the More / Share sheets.
 *
 * Per aniseekr-expo rule 10: the list route passes `name` via route params
 * so the hero paints on frame 1 even before the MMKV-backed contact store
 * resolves. The rest of the card fills in once `useContact(id)` returns.
 */
import { router, useLocalSearchParams } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { useMemo, useState, type ReactNode } from 'react';
import {
  Image,
  Pressable,
  ScrollView,
  Share,
  Text,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { animalImageSource } from '@/cards/animals';
import { MauvePetalMotif } from '@/components/decor/MauvePetalMotif';
import { SfIcon } from '@/components/icons/SfIcon';
import { EditContactSheet } from '@/components/people/EditContactSheet';
import { PersonDetailEphemeralSection } from '@/components/people/PersonDetailEphemeralSection';
import { PersonDetailMoreSheet } from '@/components/people/PersonDetailMoreSheet';
import {
  ContextTag,
  DeclaredClaimChip,
  PersonDetailContactRowView,
  StatusTag,
  buildContactRows,
} from '@/components/people/personDetailSupport';
import { Colors } from '@/constants/Colors';
import { useContact, useContactStore } from '@/contacts/repository';
import type { Animal, Contact } from '@solidarity/shared';

const HERO_HORIZONTAL_PADDING = 16;

export default function PersonDetailScreen(): ReactNode {
  const { id, name } = useLocalSearchParams<{ id: string; name?: string }>();
  const contact = useContact(id);
  const upsert = useContactStore((s) => s.upsert);
  const remove = useContactStore((s) => s.remove);
  const insets = useSafeAreaInsets();

  const [showingMoreSheet, setShowingMoreSheet] = useState(false);
  const [showingEditSheet, setShowingEditSheet] = useState(false);
  const displayName = contact?.businessCard.name ?? name ?? 'Contact';

  const onShare = (): void => {
    void Share.share({ message: `Check out ${displayName} on AirMeishi!` }).catch(
      () => {
        // Swallow — share sheet cancellation isn't an error worth surfacing.
      },
    );
  };

  const onSaveNote = (note: string): void => {
    if (!contact) return;
    const trimmed = note.trim();
    void upsert({
      ...contact,
      notes: trimmed.length > 0 ? trimmed : undefined,
    });
  };

  const onDelete = (): void => {
    if (!contact) return;
    void remove(contact.id);
    router.back();
  };

  return (
    <View className="flex-1 bg-pageBg" style={{ paddingTop: insets.top }}>
      <TopBar
        onBack={() => { router.back(); }}
        onShare={onShare}
        onMore={() => { setShowingMoreSheet(true); }}
      />

      <ScrollView contentContainerStyle={{ paddingTop: 12, paddingBottom: 32, rowGap: 24 }}>
        <HeroCard
          contact={contact}
          displayName={displayName}
          onEditNote={() => { setShowingMoreSheet(true); }}
        />
        {contact ? <PersonDetailEphemeralSection contact={contact} /> : null}
        {contact ? <ContactInfoSection contact={contact} /> : null}
      </ScrollView>

      {contact ? (
        <PersonDetailMoreSheet
          visible={showingMoreSheet}
          contact={contact}
          onSave={onSaveNote}
          onDelete={onDelete}
          onEditContact={() => { setShowingEditSheet(true); }}
          onClose={() => { setShowingMoreSheet(false); }}
        />
      ) : null}

      {contact ? (
        <EditContactSheet
          visible={showingEditSheet}
          contact={contact}
          onClose={() => { setShowingEditSheet(false); }}
        />
      ) : null}
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Top bar — chevron.left back + share + ellipsis.circle (more) icons.
// 56pt tall, 16pt horiz pad. Ellipsis opens PersonDetailMoreSheet (note +
// destructive delete row).
// ─────────────────────────────────────────────────────────────────────────────

function TopBar({
  onBack,
  onShare,
  onMore,
}: {
  readonly onBack: () => void;
  readonly onShare: () => void;
  readonly onMore: () => void;
}): ReactNode {
  return (
    <View
      className="flex-row items-center justify-between"
      style={{ height: 56, paddingHorizontal: 16 }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Back"
        onPress={onBack}
        hitSlop={8}
      >
        <SfIcon name="chevron.left" size={24} color={Colors.text1} />
      </Pressable>
      <View className="flex-row items-center" style={{ columnGap: 16 }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Share"
          onPress={onShare}
          hitSlop={8}
          style={{ width: 22, height: 22, alignItems: 'center', justifyContent: 'center' }}
        >
          <SfIcon name="square.and.arrow.up" size={22} color={Colors.text1} />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="More"
          onPress={onMore}
          hitSlop={8}
          style={{ width: 24, height: 24, alignItems: 'center', justifyContent: 'center' }}
        >
          <SfIcon name="ellipsis.circle" size={22} color={Colors.text1} />
        </Pressable>
      </View>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Hero card — gradient + MauvePetalMotif watermark + avatar + name + chips.
// 4pt corner radius (matches Swift PersonDetailView heroCard).
// ─────────────────────────────────────────────────────────────────────────────

function HeroCard({
  contact,
  displayName,
  onEditNote,
}: {
  readonly contact: Contact | undefined;
  readonly displayName: string;
  readonly onEditNote: () => void;
}): ReactNode {
  const [cardWidth, setCardWidth] = useState<number>(0);
  const onLayout = (e: LayoutChangeEvent): void => {
    const w = e.nativeEvent.layout.width;
    if (Math.abs(w - cardWidth) > 0.5) setCardWidth(w);
  };

  const trimmedNote = contact?.notes?.trim();
  const note = trimmedNote && trimmedNote.length > 0 ? trimmedNote : undefined;
  const firstTag = contact?.tags.find((t) => t.trim().length > 0);
  const hasNote = note !== undefined;
  const declaredClaims = readDeclaredProofClaims(contact);

  return (
    <View
      onLayout={onLayout}
      style={{ marginHorizontal: HERO_HORIZONTAL_PADDING, borderRadius: 4, overflow: 'hidden' }}
    >
      {/* Background gradient (Figma 766:5241 — 17.3°, mauve @ 0.36 → peach @ 0.68). */}
      <LinearGradient
        colors={[Colors.heroGradientStart, Colors.heroGradientEnd]}
        locations={[0.36, 0.68]}
        start={{ x: 0.35, y: 0.98 }}
        end={{ x: 0.65, y: 0.02 }}
        style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
      />

      {/* Mauve horseshoe watermark — only renders once cardWidth is known. */}
      {cardWidth > 0 ? (
        <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0 }}>
          <MauvePetalMotif cardWidth={cardWidth} cardHeight={260} />
        </View>
      ) : null}

      <View style={{ paddingHorizontal: 12, paddingTop: 16, paddingBottom: 24, rowGap: 16 }}>
        <View style={{ alignItems: 'center', rowGap: 16 }}>
          <AvatarCircle name={displayName} animal={contact?.businessCard.animal} />
          <View style={{ alignItems: 'center', rowGap: 8, alignSelf: 'stretch' }}>
            <Text
              numberOfLines={2}
              className="text-text1"
              style={{ fontSize: 24, fontWeight: '500', textAlign: 'center' }}
            >
              {displayName}
            </Text>

            <HeroNoteLine note={note} onEditNote={onEditNote} />

            {contact ? (
              <View className="flex-row items-center" style={{ columnGap: 16 }}>
                <StatusTag contact={contact} />
                {firstTag ? <ContextTag label={firstTag} /> : null}
              </View>
            ) : null}

            {declaredClaims.length > 0 ? (
              <View className="flex-row" style={{ columnGap: 8 }}>
                {declaredClaims.map((claim) => (
                  <DeclaredClaimChip key={claim} claimType={claim} />
                ))}
              </View>
            ) : null}
          </View>
        </View>
      </View>

      <HeroEditButton hasNote={hasNote} onPress={onEditNote} />
    </View>
  );
}

function HeroEditButton({
  hasNote,
  onPress,
}: {
  readonly hasNote: boolean;
  readonly onPress: () => void;
}): ReactNode {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={hasNote ? 'Edit note' : 'Add note'}
      onPress={onPress}
      hitSlop={8}
      style={{
        position: 'absolute',
        top: 10,
        right: 10,
        width: 32,
        height: 32,
        borderRadius: 16,
        backgroundColor: 'rgba(255,255,255,0.45)',
        borderWidth: 0.5,
        borderColor: 'rgba(255,255,255,0.6)',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <SfIcon name="square.and.pencil" size={14} color={Colors.text1} />
    </Pressable>
  );
}

function HeroNoteLine({
  note,
  onEditNote,
}: {
  readonly note: string | undefined;
  readonly onEditNote: () => void;
}): ReactNode {
  return (
    <Pressable
      onPress={onEditNote}
      accessibilityRole="button"
      accessibilityLabel={note ? 'Edit note' : 'Add note'}
      style={{ alignSelf: 'stretch' }}
    >
      {note ? (
        <Text
          numberOfLines={1}
          className="text-text2"
          style={{ fontSize: 14, textAlign: 'center' }}
        >
          {note}
        </Text>
      ) : (
        <View
          className="flex-row items-center justify-center"
          style={{ columnGap: 4 }}
        >
          <Text
            style={{
              fontSize: 12,
              fontFamily: 'Menlo',
              fontWeight: '500',
              color: Colors.primaryBlue,
            }}
          >
            {'//'}
          </Text>
          <Text
            style={{
              fontSize: 12,
              fontFamily: 'Menlo',
              color: Colors.text3,
            }}
          >
            tap to add note
          </Text>
        </View>
      )}
    </Pressable>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Avatar circle — 88pt warm cream disc. Renders animal PNG (Swift parity:
// ImageProvider.animalImage(for:)) when the contact has an animal set,
// otherwise falls back to the initial glyph.
// ─────────────────────────────────────────────────────────────────────────────

function AvatarCircle({
  name,
  animal,
}: {
  readonly name: string;
  readonly animal: Animal | undefined;
}): ReactNode {
  return (
    <View
      style={{
        width: 88,
        height: 88,
        borderRadius: 44,
        backgroundColor: Colors.gradientCream,
        borderWidth: 1,
        borderColor: Colors.gradientCream,
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
      }}
    >
      {animal ? (
        <Image source={animalImageSource(animal)} style={{ width: 88, height: 88 }} resizeMode="cover" />
      ) : (
        <Text className="text-text2" style={{ fontSize: 32, fontWeight: '500' }}>
          {initialOf(name)}
        </Text>
      )}
    </View>
  );
}

function initialOf(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length === 0) return '?';
  return trimmed.charAt(0).toUpperCase();
}

// ─────────────────────────────────────────────────────────────────────────────
// Contact info — phone / email rows (Swift: phone, email, web link). The
// web-link row depends on `graphCredentialRef` which the TS schema doesn't
// surface yet, so it's omitted until the field lands cross-platform.
// ─────────────────────────────────────────────────────────────────────────────

function ContactInfoSection({ contact }: { readonly contact: Contact }): ReactNode {
  const rows = useMemo(() => buildContactRows(contact), [contact]);
  if (rows.length === 0) return null;
  return (
    <View style={{ paddingHorizontal: 16, rowGap: 10 }}>
      <Text className="text-text1" style={{ fontSize: 14 }}>
        contact info
      </Text>
      <View style={{ rowGap: 8 }}>
        {rows.map((row) => (
          <PersonDetailContactRowView key={row.id} row={row} />
        ))}
      </View>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Declared-proof claims accessor — TS Contact doesn't carry `declaredProofClaims`
// directly today, so read defensively (forwards-compatible if a future
// schema add lands without breaking the existing wire format).
// ─────────────────────────────────────────────────────────────────────────────

function readDeclaredProofClaims(contact: Contact | undefined): readonly string[] {
  if (!contact) return [];
  const raw = (contact as unknown as { declaredProofClaims?: unknown }).declaredProofClaims;
  if (!Array.isArray(raw)) return [];
  return raw.filter((v): v is string => typeof v === 'string');
}
