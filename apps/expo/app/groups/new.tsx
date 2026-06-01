/**
 * Create Group — 1:1 port of Swift CreateGroupView
 *   (solidarity/Views/IDViews/GroupViews/CreateGroupView.swift).
 *
 * Layout matches the Swift screen exactly:
 *   • Nav title "New Group" + leading "Cancel" button
 *   • Stacked text fields: Group Name + Description (Optional)
 *     inside searchBg cards with divider stroke
 *   • Helper text: "Give your group a recognizable name and description."
 *   • "GROUP TYPE" mono caption header
 *   • Segmented control: Public Group / Private Group
 *   • Helper text per selection (public vs private)
 *   • Primary "Create Group" button — disabled until name is non-empty
 *
 * TODO(android): persists straight into the local zustand store. The
 * Swift original calls CloudKitGroupSyncManager.createGroup which performs
 * the CKShare dance. That sync layer is not ported yet.
 */
import { randomUUID } from 'expo-crypto';
import { router } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedButton } from '@/components/themed';
import { Colors } from '@/constants/Colors';
import { showError } from '@/feedback/appAlert';
import { pushToast } from '@/feedback/toast';
import { useTranslation } from '@/i18n';
import {
  CURRENT_USER_RECORD_ID,
  useGroupStore,
} from '@/groups/store';

const MONO_FONT = 'Menlo';

function NavBar({
  title,
  onCancel,
}: {
  readonly title: string;
  readonly onCancel: () => void;
}): React.JSX.Element {
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  return (
    <View style={{ paddingTop: insets.top }} className="bg-pageBg">
      <View className="h-11 flex-row items-center px-4">
        <Pressable
          onPress={onCancel}
          accessibilityRole="button"
          accessibilityLabel={t('groupNew.cancel')}
          hitSlop={8}
          className="px-1 py-1 active:opacity-60"
        >
          <Text className="text-text1 text-[16px]">{t('groupNew.cancel')}</Text>
        </Pressable>
        <View className="flex-1 items-center">
          <Text className="text-text1 text-[17px] font-semibold">{title}</Text>
        </View>
        <View style={{ width: 60 }} />
      </View>
    </View>
  );
}

interface GroupTypeSegmentProps {
  readonly value: boolean;
  readonly onChange: (next: boolean) => void;
}

function GroupTypeSegment({
  value,
  onChange,
}: GroupTypeSegmentProps): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <View
      className="flex-row p-1 rounded-lg bg-searchBg"
      style={{ borderWidth: 1, borderColor: Colors.divider }}
    >
      <Pressable
        accessibilityRole="button"
        onPress={() => { onChange(false); }}
        className="flex-1 items-center justify-center rounded-md py-2"
        style={{
          backgroundColor: !value ? Colors.cardBg : 'transparent',
          shadowColor: !value ? '#000' : 'transparent',
          shadowOpacity: !value ? 0.08 : 0,
          shadowRadius: 2,
          shadowOffset: { width: 0, height: 1 },
        }}
      >
        <Text
          className={`text-[14px] ${!value ? 'text-text1 font-semibold' : 'text-text2'}`}
        >
          {t('groupNew.typePublic')}
        </Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        onPress={() => { onChange(true); }}
        className="flex-1 items-center justify-center rounded-md py-2"
        style={{
          backgroundColor: value ? Colors.cardBg : 'transparent',
          shadowColor: value ? '#000' : 'transparent',
          shadowOpacity: value ? 0.08 : 0,
          shadowRadius: 2,
          shadowOffset: { width: 0, height: 1 },
        }}
      >
        <Text
          className={`text-[14px] ${value ? 'text-text1 font-semibold' : 'text-text2'}`}
        >
          {t('groupNew.typePrivate')}
        </Text>
      </Pressable>
    </View>
  );
}

export default function CreateGroup(): React.JSX.Element {
  const upsertGroup = useGroupStore((s) => s.upsertGroup);
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const [groupName, setGroupName] = useState('');
  const [groupDescription, setGroupDescription] = useState('');
  const [isPrivate, setIsPrivate] = useState(false);
  const [isCreating, setIsCreating] = useState(false);

  const trimmed = groupName.trim();
  const disabled = trimmed.length === 0 || isCreating;

  const onCreate = async () => {
    if (trimmed.length === 0) return;
    setIsCreating(true);
    try {
      const id = randomUUID();
      await upsertGroup({
        id,
        name: trimmed,
        description: groupDescription.trim(),
        ownerRecordID: CURRENT_USER_RECORD_ID,
        merkleRoot: undefined,
        merkleTreeDepth: 0,
        memberCount: 1,
        isPrivate,
        isSynced: false,
        credentialIssuers: [],
      });
      pushToast(t('groupNew.created', { name: trimmed }), 'success');
      router.replace({ pathname: '/groups/[id]', params: { id } });
    } catch (e) {
      showError({ context: 'Groups › Create', summary: t('groupNew.createFailed'), error: e });
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <View className="flex-1 bg-pageBg">
      <NavBar title={t('groupNew.title')} onCancel={() => { router.back(); }} />

      <ScrollView
        className="flex-1"
        contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 32 }}
        keyboardShouldPersistTaps="handled"
      >
        <View className="gap-4">
          {/* Group Info Section */}
          <View>
            <View
              style={{ borderWidth: 1, borderColor: Colors.divider }}
              className="overflow-hidden"
            >
              <TextInput
                value={groupName}
                onChangeText={setGroupName}
                placeholder={t('groupNew.namePlaceholder')}
                placeholderTextColor={Colors.text3}
                autoCapitalize="words"
                className="text-text1 text-[14px] bg-searchBg px-4 py-4"
              />
              <View style={{ height: 1, backgroundColor: Colors.divider }} />
              <TextInput
                value={groupDescription}
                onChangeText={setGroupDescription}
                placeholder={t('groupNew.descriptionPlaceholder')}
                placeholderTextColor={Colors.text3}
                autoCapitalize="sentences"
                className="text-text1 text-[14px] bg-searchBg px-4 py-4"
              />
            </View>
            <Text
              className="text-text3 text-[12px] pt-2"
              style={{ fontFamily: MONO_FONT }}
            >
              {t('groupNew.nameHelper')}
            </Text>
          </View>

          {/* Group Type Section */}
          <View>
            <Text
              className="text-text3 text-[12px] font-bold pb-2"
              style={{ fontFamily: MONO_FONT }}
            >
              {t('groupNew.typeHeader')}
            </Text>
            <GroupTypeSegment value={isPrivate} onChange={setIsPrivate} />
            <Text
              className="text-text3 text-[12px] pt-2"
              style={{ fontFamily: MONO_FONT }}
            >
              {isPrivate
                ? t('groupNew.privateHelper')
                : t('groupNew.publicHelper')}
            </Text>
          </View>

          {/* Create button */}
          <ThemedButton
            variant="primary"
            fullWidth
            disabled={disabled}
            label={isCreating ? t('groupNew.creating') : t('groupNew.createButton')}
            onPress={() => { void onCreate(); }}
          />
          {isCreating ? (
            <View className="items-center -mt-2">
              <ActivityIndicator size="small" color={Colors.accentRose} />
            </View>
          ) : null}
        </View>
      </ScrollView>
    </View>
  );
}
