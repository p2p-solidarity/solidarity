import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import { useState } from 'react';
import { Linking } from 'react-native';

import { getAtprotoSession } from '@/atproto/oauth';
import { appAlert } from '@/feedback/appAlert';
import { haptic } from '@/feedback/haptics';
import { pushToast } from '@/feedback/toast';
import { useTranslation } from '@/i18n';
import { fetchBlueskyAvatar, type BlueskyAvatarError } from '@/profile/avatar';
import {
  persistLocalAvatar,
  readLocalAvatarUri,
  removeLocalAvatar,
} from '@/profile/localAvatar';
import type { ProfileRecord } from '@solidarity/shared';

import type { AvatarPickerPhase } from './AvatarPickerSheet';

export type ProfileCommitResult =
  | 'success'
  | 'cancelled'
  | 'invalidLinks'
  | 'saveFailed'
  | 'publishFailed';

export interface AvatarEditorController {
  readonly localAvatar: string | null;
  readonly sheetOpen: boolean;
  readonly phase: AvatarPickerPhase;
  readonly canUseBluesky: boolean;
  readonly canRemove: boolean;
  readonly open: () => void;
  readonly close: () => void;
  readonly chooseFromLibrary: () => Promise<void>;
  readonly useBluesky: () => Promise<void>;
  readonly remove: () => Promise<void>;
  readonly resetError: () => void;
}

function blueskyHandle(record: ProfileRecord | null): string | null {
  return (
    record?.alsoKnownAs
      .find((alias) => alias.startsWith('at://'))
      ?.slice('at://'.length)
      .toLowerCase() ?? null
  );
}

export function useAvatarEditor({
  record,
  commitProfile,
  willPublish,
}: {
  readonly record: ProfileRecord | null;
  readonly commitProfile: (avatar: string | null) => Promise<ProfileCommitResult>;
  readonly willPublish: boolean;
}): AvatarEditorController {
  const { t } = useTranslation();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [phase, setPhase] = useState<AvatarPickerPhase>({ step: 'ready' });
  const [localAvatar, setLocalAvatar] = useState(readLocalAvatarUri);
  const handle = blueskyHandle(record);

  const close = () => {
    setSheetOpen(false);
    setPhase({ step: 'ready' });
  };

  const errorMessage = (reason: BlueskyAvatarError): string => {
    switch (reason) {
      case 'avatarUnavailable':
        return t('meEdit.avatar.noBlueskyAvatar');
      case 'notFound':
      case 'invalidActor':
        return t('meEdit.avatar.reconnectBluesky');
      case 'unreachable':
        return t('meEdit.avatar.fetchFailed');
      case 'invalidResponse':
      case 'insecureAvatar':
        return t('meEdit.avatar.unusableBlueskyAvatar');
    }
  };

  const chooseFromLibrary = async (): Promise<void> => {
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        appAlert({
          title: t('meEdit.avatar.permissionTitle'),
          message: t('meEdit.avatar.permissionMessage'),
          buttons: [
            { label: t('alert.cancel'), style: 'cancel' },
            {
              label: t('common.openSettings'),
              onPress: () => {
                void Linking.openSettings();
              },
            },
          ],
        });
        return;
      }

      const picked = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.9,
      });
      if (picked.canceled) return;
      const sourceUri = picked.assets[0]?.uri;
      if (!sourceUri) {
        setPhase({ step: 'error', message: t('meEdit.avatar.localSaveFailed') });
        return;
      }

      setPhase({ step: 'loading', message: t('meEdit.avatar.savingOnDevice') });
      const persisted = await persistLocalAvatar(sourceUri);
      if (!persisted.ok) {
        setPhase({ step: 'error', message: t('meEdit.avatar.localSaveFailed') });
        return;
      }
      setLocalAvatar(persisted.value);
      close();
      haptic('success');
      pushToast(t('meEdit.avatar.savedOnDevice'), 'success');
    } catch {
      setPhase({ step: 'error', message: t('meEdit.avatar.localSaveFailed') });
    }
  };

  const useBluesky = async (): Promise<void> => {
    setPhase({ step: 'loading', message: t('meEdit.avatar.loadingBluesky') });
    const session = await getAtprotoSession();
    const sessionHandle = session.ok
      ? session.value?.handle.trim().replace(/^@/u, '').toLowerCase()
      : null;
    if (!session.ok || !session.value || !handle || sessionHandle !== handle) {
      setPhase({ step: 'error', message: t('meEdit.avatar.reconnectBluesky') });
      return;
    }

    const fetched = await fetchBlueskyAvatar(session.value.did);
    if (!fetched.ok) {
      setPhase({ step: 'error', message: errorMessage(fetched.error) });
      return;
    }

    setPhase({
      step: 'loading',
      message: t(willPublish ? 'meEdit.avatar.publishing' : 'meEdit.avatar.savingProfile'),
    });
    const committed = await commitProfile(fetched.value);
    if (committed === 'cancelled') {
      close();
      return;
    }
    if (committed !== 'success') {
      setPhase({
        step: 'error',
        message:
          committed === 'invalidLinks'
            ? t('meEdit.avatar.fixLinksFirst')
            : t(willPublish ? 'meEdit.avatar.publishFailed' : 'meEdit.avatar.saveFailed'),
      });
      return;
    }

    close();
    haptic('success');
    pushToast(t(willPublish ? 'meEdit.avatar.published' : 'meEdit.avatar.saved'), 'success');
    router.back();
  };

  const remove = async (): Promise<void> => {
    setPhase({ step: 'loading', message: t('meEdit.avatar.removing') });
    const hadRecordAvatar = record?.avatar !== null && record?.avatar !== undefined;
    if (hadRecordAvatar) {
      const committed = await commitProfile(null);
      if (committed === 'cancelled') {
        close();
        return;
      }
      if (committed !== 'success') {
        setPhase({
          step: 'error',
          message:
            committed === 'invalidLinks'
              ? t('meEdit.avatar.fixLinksFirst')
              : t(willPublish ? 'meEdit.avatar.publishFailed' : 'meEdit.avatar.saveFailed'),
        });
        return;
      }
    }

    const removed = await removeLocalAvatar();
    if (!removed.ok) {
      setPhase({ step: 'error', message: t('meEdit.avatar.removeFailed') });
      return;
    }
    setLocalAvatar(null);
    close();
    haptic('success');
    pushToast(t('meEdit.avatar.removed'), 'success');
    if (hadRecordAvatar) router.back();
  };

  return {
    localAvatar,
    sheetOpen,
    phase,
    canUseBluesky: handle !== null,
    canRemove: record?.avatar != null || localAvatar !== null,
    open: () => {
      setPhase({ step: 'ready' });
      setSheetOpen(true);
    },
    close,
    chooseFromLibrary,
    useBluesky,
    remove,
    resetError: () => {
      setPhase({ step: 'ready' });
    },
  };
}
