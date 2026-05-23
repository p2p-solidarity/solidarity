/**
 * Nitro spec — CloudKit (iOS) + Drive (Android) parity surface.
 *
 * Why this lives in one Nitro module instead of two:
 *   The legacy Swift app uses CKShare for group sync (cross-device shared
 *   zones via Apple's invite URLs). Android has no CKShare; we simulate the
 *   same primitives over Drive (shared folder + REST `permissions.create`)
 *   so the JS layer reads `shareId` + `url` regardless of platform.
 *
 * Field encoding:
 *   `fields` is a JSON-encoded string instead of a Record<string, unknown>
 *   because Nitrogen rejects open-ended record types — Swift bridges only
 *   know fixed C++ structs. The JSON cost is small (records are kilobytes,
 *   not megabytes) and lets us evolve the field schema without rerunning
 *   nitrogen.
 *
 * Event listener:
 *   `addEventListener` returns an unsubscribe function so JS callers can
 *   detach cleanly (mirrors react-native-mmkv / Proximity ergonomics). The
 *   iOS impl bridges CKDatabaseSubscription deliveries; the Android impl
 *   polls via Drive `changes.list` since Drive has no push channel inside
 *   the Nitro module's process.
 */
import type { HybridObject } from 'react-native-nitro-modules';

export interface CloudKitRecord {
  readonly recordId: string;
  readonly recordType: string;
  /** JSON-encoded fields. Caller is responsible for stable key ordering. */
  readonly fields: string;
  /** Optional zone (iOS only — Drive ignores). */
  readonly zoneId?: string;
  /** Optional share id this record belongs to. */
  readonly shareId?: string;
  /** Epoch ms — server modification time. 0 for unsaved records. */
  readonly modifiedTime: number;
}

export interface CloudKitShareInvite {
  readonly shareId: string;
  /** Shareable URL — CKShare.url on iOS, Drive `webViewLink` on Android. */
  readonly url: string;
  readonly title: string;
  /** Optional thumbnail (JPEG/PNG bytes). */
  readonly thumbnail?: ArrayBuffer;
}

export type CloudKitEventKind =
  | 'recordSaved'
  | 'recordDeleted'
  | 'shareAccepted'
  | 'shareRevoked'
  | 'accountChanged'
  | 'error';

/**
 * Flattened event shape — nitrogen rejects discriminated unions with string
 * literal discriminators, so we use one struct with all optional fields and
 * narrow at the call site.
 */
export interface CloudKitEvent {
  readonly kind: CloudKitEventKind;
  readonly recordId?: string;
  readonly recordType?: string;
  readonly shareId?: string;
  readonly errorMessage?: string;
  readonly errorCode?: string;
}

export interface CloudKit
  extends HybridObject<{ ios: 'swift'; android: 'kotlin' }> {
  // ── Container lifecycle ────────────────────────────────────────────────
  /**
   * Initialise the container. Returns false when the platform-equivalent
   * account is unavailable (iCloud not signed in on iOS, no Drive session
   * on Android).
   */
  initialize(containerIdentifier: string): Promise<boolean>;
  isAvailable(): boolean;
  currentUserId(): Promise<string>;

  // ── Private DB CRUD ────────────────────────────────────────────────────
  saveRecord(record: CloudKitRecord): Promise<CloudKitRecord>;
  fetchRecord(recordId: string): Promise<CloudKitRecord>;
  deleteRecord(recordId: string): Promise<void>;
  /**
   * Query records by type. `predicateJson` is an NSPredicate-equivalent
   * JSON shape `{ key, op, value }`. iOS converts to NSPredicate; Drive
   * translates to a `q=` parameter on the REST list call.
   */
  queryRecords(
    recordType: string,
    predicateJson: string
  ): Promise<CloudKitRecord[]>;

  // ── Shared DB (groups) ─────────────────────────────────────────────────
  createShare(
    rootRecordId: string,
    title: string,
    allowsPublicAccess: boolean
  ): Promise<CloudKitShareInvite>;
  /** Returns the share id. */
  acceptShare(url: string): Promise<string>;
  fetchSharedRecords(shareId: string): Promise<CloudKitRecord[]>;
  removeShare(shareId: string): Promise<void>;

  // ── Change tracking ────────────────────────────────────────────────────
  /** Returns an unsubscribe function. */
  addEventListener(handler: (event: CloudKitEvent) => void): () => void;

  /**
   * Push a Drive OAuth access token (Android only). iOS no-ops because
   * CloudKit authenticates the user via the system iCloud account.
   */
  setDriveAccessToken(accessToken: string): void;
}
