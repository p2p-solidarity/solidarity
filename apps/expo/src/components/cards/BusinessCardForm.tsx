/**
 * BusinessCardForm — 1:1 port of
 * solidarity/Views/CardViews/BusinessCardFormView.swift.
 *
 * Sections (verbatim Swift headings + placeholders):
 *   • Basic Info        → Name (required, * marker) / Title / Company
 *   • Contact and Skills→ Email / Phone / Skills / Categories / LinkedIn / GitHub
 *   • Sharing Preferences → ZK toggle / Allow forwarding toggle / Format picker
 *   • Save Changes | Create Card (full-width primary, disabled until name)
 *   • Danger Zone (edit only) → Delete Card
 *
 * Row primitives + parsers live in sibling files to keep this view ≤300 lines:
 *   • ./cardFormRows.tsx     — FieldRow / NameField / ToggleRow / FormatRow / etc.
 *   • ./cardFormParsers.ts   — parseCSV / parseSkills / parseSocialNetworks
 */
import { Alert, Text, View } from 'react-native';

import { ThemedButton } from '@/components/themed';
import {
  type BusinessCard,
  type SharingFormat,
  type SharingPreferences,
} from '@solidarity/shared';

import {
  DangerRow,
  FieldRow,
  FormatRow,
  NameField,
  SectionHeader,
  ToggleRow,
} from './cardFormRows';
import {
  nilIfEmpty,
  parseCSV,
  parseSkills,
  parseSocialNetworks,
} from './cardFormParsers';
import { useBusinessCardFormState } from './useBusinessCardFormState';

export interface BusinessCardFormProps {
  readonly initialCard?: BusinessCard;
  readonly forceCreate?: boolean;
  readonly onSave: (card: BusinessCard) => void | Promise<void>;
  readonly onDelete?: () => void | Promise<void>;
}

interface SharingFormatMeta {
  readonly id: SharingFormat;
  readonly displayName: string;
  readonly detail: string;
}

const SHARING_FORMAT_META: Readonly<Record<SharingFormat, SharingFormatMeta>> = {
  plaintext: {
    id: 'plaintext',
    displayName: 'Plaintext',
    detail: 'Share raw card data without cryptographic attestation.',
  },
  zkProof: {
    id: 'zkProof',
    displayName: 'ZK Proof',
    detail: 'Generate a zero-knowledge proof for the selected fields.',
  },
  didSigned: {
    id: 'didSigned',
    displayName: 'DID-Signed',
    detail: 'Sign the card payload with your DID for verifiable authenticity.',
  },
};

const SHARING_FORMAT_ORDER: readonly SharingFormat[] = [
  'plaintext',
  'zkProof',
  'didSigned',
];

export function BusinessCardForm({
  initialCard,
  forceCreate = false,
  onSave,
  onDelete,
}: BusinessCardFormProps) {
  const isEditing = initialCard !== undefined && !forceCreate;
  const state = useBusinessCardFormState(initialCard);
  const trimmedName = state.name.trim();
  const detail = SHARING_FORMAT_META[state.selectedFormat].detail;
  const formatLabel = SHARING_FORMAT_META[state.selectedFormat].displayName;

  const handleSave = async () => {
    if (trimmedName.length === 0) return;
    await onSave(buildCard(initialCard, state, trimmedName));
  };

  const handleDelete = () => {
    if (!onDelete) return;
    Alert.alert('Delete this card?', 'This action cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => void onDelete() },
    ]);
  };

  const cycleFormat = () => {
    const idx = SHARING_FORMAT_ORDER.indexOf(state.selectedFormat);
    const next =
      SHARING_FORMAT_ORDER[(idx + 1) % SHARING_FORMAT_ORDER.length] ??
      state.selectedFormat;
    state.setSelectedFormat(next);
  };

  return (
    <View style={{ gap: 24 }}>
      <Section title="Basic Info">
        <NameField value={state.name} onChange={state.setName} trimmed={trimmedName} />
        <FieldRow
          icon="briefcase"
          placeholder="Title"
          value={state.title}
          onChangeText={state.setTitle}
        />
        <FieldRow
          icon="building.2"
          placeholder="Company"
          value={state.company}
          onChangeText={state.setCompany}
        />
      </Section>

      <Section title="Contact and Skills">
        <FieldRow
          icon="envelope"
          placeholder="Email"
          value={state.email}
          onChangeText={state.setEmail}
          keyboardType="email-address"
          autoCapitalize="none"
        />
        <FieldRow
          icon="phone"
          placeholder="Phone"
          value={state.phone}
          onChangeText={state.setPhone}
          keyboardType="phone-pad"
        />
        <FieldRow
          icon="sparkles"
          placeholder="Skills (comma separated)"
          value={state.skillsText}
          onChangeText={state.setSkillsText}
        />
        <FieldRow
          icon="tag"
          placeholder="Categories (comma separated)"
          value={state.categoriesText}
          onChangeText={state.setCategoriesText}
        />
        <FieldRow
          icon="link"
          placeholder="LinkedIn username"
          value={state.linkedInHandle}
          onChangeText={state.setLinkedInHandle}
        />
        <FieldRow
          icon="chevron.left.forwardslash.chevron.right"
          placeholder="GitHub username"
          value={state.githubHandle}
          onChangeText={state.setGithubHandle}
          autoCapitalize="none"
        />
      </Section>

      <View style={{ gap: 8 }}>
        <SectionHeader title="Sharing Preferences" />
        <View style={{ paddingHorizontal: 16, gap: 8 }}>
          <ToggleRow
            icon="shield"
            title="Use ZK proof by default"
            value={state.useZK}
            onChange={state.setUseZK}
          />
          <ToggleRow
            icon="arrowshape.turn.up.right"
            title="Allow forwarding"
            value={state.allowForwarding}
            onChange={state.setAllowForwarding}
          />
          <FormatRow trailing={formatLabel} onPress={cycleFormat} />
        </View>
        <Text className="text-text3 text-[12px]" style={{ paddingHorizontal: 16 }}>
          {detail}
        </Text>
      </View>

      <View style={{ paddingHorizontal: 16 }}>
        <ThemedButton
          label={isEditing ? 'Save Changes' : 'Create Card'}
          fullWidth
          disabled={trimmedName.length === 0}
          onPress={() => {
            void handleSave();
          }}
        />
      </View>

      {isEditing && onDelete ? (
        <View style={{ gap: 8 }}>
          <SectionHeader title="Danger Zone" />
          <View style={{ paddingHorizontal: 16 }}>
            <DangerRow icon="trash" title="Delete Card" onPress={handleDelete} />
          </View>
        </View>
      ) : null}
    </View>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: 8 }}>
      <SectionHeader title={title} />
      <View style={{ paddingHorizontal: 16, gap: 8 }}>{children}</View>
    </View>
  );
}

function buildCard(
  existing: BusinessCard | undefined,
  state: ReturnType<typeof useBusinessCardFormState>,
  trimmedName: string
): BusinessCard {
  const preferences: SharingPreferences = {
    publicFields: existing?.sharingPreferences.publicFields ?? new Set(['name']),
    professionalFields:
      existing?.sharingPreferences.professionalFields ??
      new Set(['name', 'title', 'company', 'email']),
    personalFields:
      existing?.sharingPreferences.personalFields ??
      new Set(['name', 'email', 'phone']),
    allowForwarding: state.allowForwarding,
    useZK: state.useZK,
    sharingFormat: state.selectedFormat,
    expirationDate: existing?.sharingPreferences.expirationDate,
  };

  const now = new Date();
  return {
    id: existing?.id ?? globalThis.crypto.randomUUID(),
    name: trimmedName,
    title: nilIfEmpty(state.title),
    company: nilIfEmpty(state.company),
    email: nilIfEmpty(state.email),
    phone: nilIfEmpty(state.phone),
    profileImage: existing?.profileImage,
    animal: existing?.animal,
    socialNetworks: parseSocialNetworks(state.linkedInHandle, state.githubHandle),
    skills: parseSkills(state.skillsText),
    categories: parseCSV(state.categoriesText),
    sharingPreferences: preferences,
    groupContext: existing?.groupContext,
    verifiedFields: existing?.verifiedFields,
    nameType: existing?.nameType ?? 'display_name',
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
}
