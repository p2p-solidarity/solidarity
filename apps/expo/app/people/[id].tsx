import { useLocalSearchParams } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { Image, ScrollView, TextInput, View, type LayoutChangeEvent } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { animalImageSource } from '@/cards/animals';
import { PressableScale } from '@/components/common/PressableScale';
import { MauvePetalMotif } from '@/components/decor/MauvePetalMotif';
import { SfIcon } from '@/components/icons/SfIcon';
import {
  contactSourceDescription,
  contactSourceTag,
} from '@/components/people/ContactRow';
import { EditContactSheet } from '@/components/people/EditContactSheet';
import { PersonDetailMoreSheet } from '@/components/people/PersonDetailMoreSheet';
import {
  ContextTag,
  PersonDetailContactRowView,
  StatusTag,
  buildContactRows,
  formatIsoDate,
} from '@/components/people/personDetailSupport';
import { ThemedButton, ThemedSurface, ThemedText } from '@/components/themed';
import { Colors } from '@/constants/Colors';
import { useContact, useContactStore } from '@/contacts/repository';
import { shareContactVCard } from '@/contacts/shareContactVCard';
import { showError } from '@/feedback/appAlert';
import { haptic } from '@/feedback/haptics';
import { pushToast } from '@/feedback/toast';
import { useTranslation } from '@/i18n';
import { safeBack } from '@/navigation/safeBack';
import type { Animal, Contact } from '@solidarity/shared';

const HORIZONTAL_PADDING = 16;

export default function PersonDetailScreen(): ReactNode {
  const { t } = useTranslation();
  const { id, name } = useLocalSearchParams<{ id: string; name?: string }>();
  const contact = useContact(id);
  const upsert = useContactStore((state) => state.upsert);
  const remove = useContactStore((state) => state.remove);
  const loadDetail = useContactStore((state) => state.loadDetail);
  const insets = useSafeAreaInsets();
  const noteInputRef = useRef<TextInput>(null);

  const [moreSheetOpen, setMoreSheetOpen] = useState(false);
  const [editSheetOpen, setEditSheetOpen] = useState(false);
  const [sharing, setSharing] = useState(false);
  const displayName = contact?.businessCard.name ?? name ?? t('personDetail.fallbackName');
  const source = contact ? contactSourceDescription(contact, t) : undefined;
  const sourceTag = contact ? contactSourceTag(contact, t) : undefined;

  const onShare = (): void => {
    if (!contact || sharing) return;
    const target = contact;
    setSharing(true);
    void (async () => {
      try {
        await shareContactVCard([target.id], loadDetail, t('personDetail.share'));
      } catch (error) {
        showError({
          context: 'Contacts › Share Contact',
          summary: t('personDetail.shareFailed'),
          error,
        });
      } finally {
        setSharing(false);
      }
    })();
  };

  const onSaveNote = (note: string): void => {
    if (!contact) return;
    const trimmed = note.trim();
    void (async () => {
      try {
        await upsert({
          ...contact,
          notes: trimmed.length > 0 ? trimmed : undefined,
        });
      } catch (error) {
        showError({
          context: 'Contacts › Edit Note',
          summary: t('personDetail.updateFailed'),
          error,
        });
      }
    })();
  };

  const onDelete = (): void => {
    if (!contact) return;
    const target = contact;
    void (async () => {
      try {
        await remove(target.id);
        haptic('success');
        pushToast(t('peopleList.contactDeleted'), 'success', 2000);
        safeBack();
      } catch (error) {
        haptic('error');
        showError({
          context: 'Contacts › Delete Contact',
          summary: t('peopleList.deleteFailed'),
          error,
        });
      }
    })();
  };

  return (
    <View className="flex-1 bg-pageBg" style={{ paddingTop: insets.top }}>
      <TopBar
        onBack={safeBack}
        onShare={onShare}
        shareDisabled={!contact || sharing}
        onMore={() => { setMoreSheetOpen(true); }}
        moreDisabled={!contact}
      />

      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingTop: 8, paddingBottom: 32, gap: 16 }}
      >
        <HeroCard
          contact={contact}
          displayName={displayName}
          sourceTag={sourceTag}
          onEditNote={() => { noteInputRef.current?.focus(); }}
        />
        {contact ? <ContactMethodsSection contact={contact} /> : null}
        {contact && source ? <ContactMetadataSection contact={contact} source={source} /> : null}
        {contact ? (
          <NotesSection
            contact={contact}
            inputRef={noteInputRef}
            onSave={onSaveNote}
          />
        ) : null}
        {contact ? (
          <View style={{ paddingHorizontal: HORIZONTAL_PADDING }}>
            <ThemedButton
              fullWidth
              variant="secondary"
              label={t('personDetail.exportVCard')}
              leadingIcon={<SfIcon name="square.and.arrow.up" size={15} color={Colors.text1} />}
              loading={sharing}
              onPress={onShare}
            />
          </View>
        ) : null}
      </ScrollView>

      {contact ? (
        <PersonDetailMoreSheet
          key={`${contact.id}:${contact.notes ?? ''}`}
          visible={moreSheetOpen}
          contact={contact}
          onSave={onSaveNote}
          onDelete={onDelete}
          onEditContact={() => { setEditSheetOpen(true); }}
          onClose={() => { setMoreSheetOpen(false); }}
        />
      ) : null}

      {contact ? (
        <EditContactSheet
          visible={editSheetOpen}
          contact={contact}
          onClose={() => { setEditSheetOpen(false); }}
        />
      ) : null}
    </View>
  );
}

function TopBar({
  onBack,
  onShare,
  shareDisabled,
  onMore,
  moreDisabled,
}: {
  readonly onBack: () => void;
  readonly onShare: () => void;
  readonly shareDisabled: boolean;
  readonly onMore: () => void;
  readonly moreDisabled: boolean;
}): ReactNode {
  const { t } = useTranslation();
  return (
    <View className="flex-row items-center justify-between px-3" style={{ height: 56 }}>
      <IconAction label={t('personDetail.back')} onPress={onBack} icon="chevron.left" />
      <View className="flex-row items-center gap-1">
        <IconAction
          label={t('personDetail.share')}
          onPress={onShare}
          icon="square.and.arrow.up"
          disabled={shareDisabled}
        />
        <IconAction
          label={t('personDetail.more')}
          onPress={onMore}
          icon="ellipsis.circle"
          disabled={moreDisabled}
        />
      </View>
    </View>
  );
}

function IconAction({
  label,
  onPress,
  icon,
  disabled = false,
}: {
  readonly label: string;
  readonly onPress: () => void;
  readonly icon: 'chevron.left' | 'square.and.arrow.up' | 'ellipsis.circle';
  readonly disabled?: boolean;
}): ReactNode {
  return (
    <PressableScale
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center', opacity: disabled ? 0.4 : 1 }}
    >
      <SfIcon name={icon} size={icon === 'chevron.left' ? 24 : 22} color={Colors.text1} />
    </PressableScale>
  );
}

function HeroCard({
  contact,
  displayName,
  sourceTag,
  onEditNote,
}: {
  readonly contact: Contact | undefined;
  readonly displayName: string;
  readonly sourceTag: string | undefined;
  readonly onEditNote: () => void;
}): ReactNode {
  const [cardWidth, setCardWidth] = useState(0);
  const note = contact?.notes?.trim();
  const onLayout = (event: LayoutChangeEvent): void => {
    const width = event.nativeEvent.layout.width;
    if (Math.abs(width - cardWidth) > 0.5) setCardWidth(width);
  };

  return (
    <ThemedSurface
      variant="card"
      onLayout={onLayout}
      style={{ marginHorizontal: HORIZONTAL_PADDING, overflow: 'hidden' }}
    >
      <LinearGradient
        colors={[Colors.heroGradientStart, Colors.heroGradientEnd]}
        locations={[0.36, 0.68]}
        start={{ x: 0.35, y: 0.98 }}
        end={{ x: 0.65, y: 0.02 }}
        style={{ position: 'absolute', inset: 0 }}
      />
      {cardWidth > 0 ? (
        <View pointerEvents="none" style={{ position: 'absolute', inset: 0 }}>
          <MauvePetalMotif cardWidth={cardWidth} cardHeight={230} />
        </View>
      ) : null}

      <View className="items-center px-4 py-5" style={{ gap: 12 }}>
        <AvatarCircle
          name={displayName}
          profileImage={contact?.businessCard.profileImage}
          animal={contact?.businessCard.animal}
        />
        <ThemedText variant="headlineMedium" numberOfLines={2} style={{ textAlign: 'center' }}>
          {displayName}
        </ThemedText>
        <HeroNoteLine note={note} onEditNote={onEditNote} />
        {contact ? (
          <View className="flex-row flex-wrap items-center justify-center gap-2">
            <StatusTag contact={contact} />
            {sourceTag ? <ContextTag label={sourceTag} /> : null}
          </View>
        ) : null}
      </View>
    </ThemedSurface>
  );
}

function HeroNoteLine({
  note,
  onEditNote,
}: {
  readonly note: string | undefined;
  readonly onEditNote: () => void;
}): ReactNode {
  const { t } = useTranslation();
  return (
    <PressableScale
      onPress={onEditNote}
      accessibilityRole="button"
      accessibilityLabel={t('personDetail.editNote')}
      className="flex-row items-center justify-center gap-1.5 px-3"
      style={{ minHeight: 44, alignSelf: 'stretch' }}
    >
      <SfIcon name="square.and.pencil" size={13} color={Colors.text2} />
      <ThemedText variant="bodySmall" tone="secondary" numberOfLines={1}>
        {note && note.length > 0 ? note : t('personDetail.tapToAddNote')}
      </ThemedText>
    </PressableScale>
  );
}

function AvatarCircle({
  name,
  profileImage,
  animal,
}: {
  readonly name: string;
  readonly profileImage: string | undefined;
  readonly animal: Animal | undefined;
}): ReactNode {
  const source = profileImage
    ? { uri: `data:image/png;base64,${profileImage}` }
    : animal
      ? animalImageSource(animal)
      : undefined;
  return (
    <View
      style={{
        width: 88,
        height: 88,
        borderRadius: 44,
        backgroundColor: Colors.gradientCream,
        borderWidth: 1,
        borderColor: Colors.divider,
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
      }}
    >
      {source ? (
        <Image source={source} style={{ width: 88, height: 88 }} resizeMode="cover" />
      ) : (
        <ThemedText variant="headlineLarge" tone="secondary">
          {initialOf(name)}
        </ThemedText>
      )}
    </View>
  );
}

function ContactMethodsSection({ contact }: { readonly contact: Contact }): ReactNode {
  const rows = useMemo(() => buildContactRows(contact), [contact]);
  if (rows.length === 0) return null;
  return (
    <ThemedSurface
      variant="card"
      style={{ marginHorizontal: HORIZONTAL_PADDING, overflow: 'hidden' }}
    >
      {rows.map((row, index) => (
        <PersonDetailContactRowView
          key={row.id}
          row={row}
          divided={index < rows.length - 1}
        />
      ))}
    </ThemedSurface>
  );
}

function ContactMetadataSection({
  contact,
  source,
}: {
  readonly contact: Contact;
  readonly source: string;
}): ReactNode {
  const { t } = useTranslation();
  return (
    <ThemedSurface
      variant="card"
      style={{ marginHorizontal: HORIZONTAL_PADDING, overflow: 'hidden' }}
    >
      <FactRow
        icon="person.text.rectangle"
        label={t('personDetail.source')}
        value={source}
        divided
      />
      <FactRow
        icon="arrow.clockwise"
        label={t('personDetail.updated')}
        value={formatIsoDate(contact.businessCard.updatedAt)}
      />
    </ThemedSurface>
  );
}

function FactRow({
  icon,
  label,
  value,
  divided = false,
}: {
  readonly icon: 'person.text.rectangle' | 'arrow.clockwise';
  readonly label: string;
  readonly value: string;
  readonly divided?: boolean;
}): ReactNode {
  return (
    <View className="flex-row items-center gap-3 px-4" style={{ minHeight: 62 }}>
      <View style={{ width: 24, alignItems: 'center' }}>
        <SfIcon name={icon} size={18} color={Colors.text1} />
      </View>
      <View style={{ flex: 1, minWidth: 0, paddingVertical: 9, gap: 1 }}>
        <ThemedText variant="bodySmall" tone="secondary">
          {label}
        </ThemedText>
        <ThemedText variant="bodyMedium" numberOfLines={1} selectable>
          {value}
        </ThemedText>
      </View>
      {divided ? <Divider /> : null}
    </View>
  );
}

function NotesSection({
  contact,
  inputRef,
  onSave,
}: {
  readonly contact: Contact;
  readonly inputRef: RefObject<TextInput | null>;
  readonly onSave: (note: string) => void;
}): ReactNode {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(contact.notes ?? '');

  useEffect(() => {
    setDraft(contact.notes ?? '');
  }, [contact.id, contact.notes]);

  const saveIfChanged = (): void => {
    if (draft.trim() !== (contact.notes ?? '').trim()) onSave(draft);
  };

  return (
    <ThemedSurface
      variant="card"
      className="flex-row items-start gap-3 px-4 py-3"
      style={{ marginHorizontal: HORIZONTAL_PADDING }}
    >
      <View style={{ width: 24, height: 44, alignItems: 'center', justifyContent: 'center' }}>
        <SfIcon name="square.and.pencil" size={18} color={Colors.text1} />
      </View>
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <ThemedText variant="bodySmall" tone="secondary">
          {t('personDetail.noteLabel')}
        </ThemedText>
        <TextInput
          ref={inputRef}
          value={draft}
          onChangeText={setDraft}
          onBlur={saveIfChanged}
          onSubmitEditing={saveIfChanged}
          multiline
          placeholder={t('personDetail.notePlaceholder')}
          placeholderTextColor={Colors.text3}
          accessibilityLabel={t('personDetail.noteLabel')}
          className="text-text1"
          style={{ minHeight: 60, padding: 0, fontSize: 15, lineHeight: 22, textAlignVertical: 'top' }}
        />
      </View>
    </ThemedSurface>
  );
}

function Divider(): ReactNode {
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

function initialOf(name: string): string {
  const trimmed = name.trim();
  return trimmed.length > 0 ? trimmed.charAt(0).toUpperCase() : '?';
}
