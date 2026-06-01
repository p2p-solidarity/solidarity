/**
 * Google Sign-In wrapper for Drive backup — Android primary path; iOS opt-in.
 *
 * Scope: `drive.file` — per-file access limited to the files THIS app creates.
 * This MUST match the native Drive client (DriveClient.kt queries/writes in
 * `spaces=drive` with an app-created backup folder); the previous
 * `drive.appdata` scope could only reach the hidden appDataFolder space, so a
 * `drive.appdata` grant + `spaces=drive` query found nothing → Android backup
 * silently failed to authenticate/restore. `drive.file` is still NOT full
 * Drive access (the app only sees its own files) and backups remain
 * end-to-end encrypted, so the cloud provider only ever sees ciphertext.
 */
import {
  GoogleSignin,
  statusCodes,
} from '@react-native-google-signin/google-signin';

const DRIVE_FILE_SCOPE = 'https://www.googleapis.com/auth/drive.file';

let configured = false;

function ensureConfigured(): void {
  if (configured) return;
  const webClientId = process.env['EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID'] ?? '';
  const iosClientId = process.env['EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID'];
  if (!webClientId) {
    throw new Error(
      'EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID missing — copy .env.example to .env.local'
    );
  }
  GoogleSignin.configure({
    webClientId,
    iosClientId,
    scopes: [DRIVE_FILE_SCOPE],
    offlineAccess: true,
  });
  configured = true;
}

export interface GoogleSession {
  readonly email: string;
  readonly accessToken: string;
}

/** Prompt the user to sign in and grant Drive appdata access. */
export async function signInForDrive(): Promise<GoogleSession> {
  ensureConfigured();
  await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
  const user = await GoogleSignin.signIn();
  const tokens = await GoogleSignin.getTokens();
  return {
    email: user.data?.user.email ?? '',
    accessToken: tokens.accessToken,
  };
}

export async function refreshDriveAccessToken(): Promise<string> {
  ensureConfigured();
  const tokens = await GoogleSignin.getTokens();
  return tokens.accessToken;
}

export async function signOut(): Promise<void> {
  ensureConfigured();
  await GoogleSignin.signOut();
}

export { statusCodes as googleStatusCodes };
