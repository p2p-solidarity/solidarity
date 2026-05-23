/**
 * Google Sign-In wrapper for Drive backup — Android primary path; iOS opt-in.
 *
 * Scope: only `drive.appdata` (private per-app folder). We never request
 * full Drive access — keeps the OAuth consent screen friendly and aligns
 * with the principle that backup payloads are end-to-end encrypted (the
 * cloud provider only sees ciphertext).
 */
import {
  GoogleSignin,
  statusCodes,
} from '@react-native-google-signin/google-signin';

const DRIVE_APPDATA_SCOPE = 'https://www.googleapis.com/auth/drive.appdata';

let configured = false;

function ensureConfigured(): void {
  if (configured) return;
  const webClientId = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID ?? '';
  const iosClientId = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID;
  if (!webClientId) {
    throw new Error(
      'EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID missing — copy .env.example to .env.local'
    );
  }
  GoogleSignin.configure({
    webClientId,
    iosClientId,
    scopes: [DRIVE_APPDATA_SCOPE],
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
