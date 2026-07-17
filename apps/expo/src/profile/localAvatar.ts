import * as FileSystem from 'expo-file-system/legacy';

import { getMmkv } from '@/storage/mmkv';
import { err, ok, type Result, uuid } from '@solidarity/shared';

const LOCAL_AVATAR_KEY = 'profile:local-avatar:v1';
const LOCAL_AVATAR_DIR = FileSystem.documentDirectory
  ? `${FileSystem.documentDirectory}profile-avatar/`
  : null;

function isOwnedAvatarUri(value: string): boolean {
  return LOCAL_AVATAR_DIR !== null && value.startsWith(LOCAL_AVATAR_DIR);
}

/** Sync mirror read for frame-one rendering after the root MMKV bootstrap. */
export function readLocalAvatarUri(): string | null {
  try {
    const value = getMmkv().getString(LOCAL_AVATAR_KEY);
    return value && isOwnedAvatarUri(value) ? value : null;
  } catch {
    return null;
  }
}

/** Copy a picker-owned temporary asset into app documents, then update MMKV. */
export async function persistLocalAvatar(
  sourceUri: string
): Promise<Result<string, 'unavailable'>> {
  if (!LOCAL_AVATAR_DIR || sourceUri.length === 0) return err('unavailable');
  const destination = `${LOCAL_AVATAR_DIR}avatar-${uuid()}`;
  const previous = readLocalAvatarUri();

  try {
    const directory = await FileSystem.getInfoAsync(LOCAL_AVATAR_DIR);
    if (!directory.exists) {
      await FileSystem.makeDirectoryAsync(LOCAL_AVATAR_DIR, { intermediates: true });
    }
    await FileSystem.copyAsync({ from: sourceUri, to: destination });
    getMmkv().set(LOCAL_AVATAR_KEY, destination);
    if (previous && previous !== destination) {
      await FileSystem.deleteAsync(previous, { idempotent: true }).catch(() => undefined);
    }
    return ok(destination);
  } catch {
    await FileSystem.deleteAsync(destination, { idempotent: true }).catch(() => undefined);
    return err('unavailable');
  }
}

/** Remove only the app-owned avatar file named by our private MMKV key. */
export async function removeLocalAvatar(): Promise<Result<void, 'unavailable'>> {
  const current = readLocalAvatarUri();
  try {
    if (current) await FileSystem.deleteAsync(current, { idempotent: true });
    getMmkv().remove(LOCAL_AVATAR_KEY);
    return ok(undefined);
  } catch {
    return err('unavailable');
  }
}
