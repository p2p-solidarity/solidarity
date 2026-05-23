# Building `@solidarity/nitro-cloudkit`

Real Apple CloudKit (iOS) + Google Drive REST (Android) behind a single
Nitro spec. Replaces the `react-native-cloud-storage` abstraction for the
group-sync path, because that lib cannot do CKShare.

| Platform | Backend | Native side |
|----------|---------|-------------|
| iOS      | CloudKit (`CKContainer`, `CKDatabase`, `CKRecord`, `CKShare`) | `ios/HybridCloudKit.swift` + `ios/HybridCloudKit+Mapping.swift` |
| Android  | Google Drive REST v3 via OkHttp                                | `android/.../HybridCloudKit.kt` + `android/.../DriveClient.kt` |

## Codegen

```bash
bun install
cd nitro-modules/cloudkit
bunx nitrogen      # → nitrogen/generated/{ios,android,shared}/*
```

## Permissions / entitlements

- iOS: `com.apple.developer.icloud-container-identifiers`,
       `com.apple.developer.icloud-services` (`CloudKit`).
       Already in `apps/expo/app.json`.
- Android: `INTERNET`. Already in `apps/expo/app.json`. Drive access token
  comes from `react-native-google-signin` — call `setDriveAccessToken()`
  after each sign-in / refresh.

## CKShare ↔ Drive mapping

Drive has no equivalent of CKShare, so:

- `createShare(rootRecordId, title, allowsPublicAccess)`
  - iOS: real `CKShare` over the root record's private zone; returns the
    Apple `CKShare.url`.
  - Android: `permissions.create role=writer, type={anyone|user}` on the
    underlying file; returns the file's `webViewLink`.
- `acceptShare(url)`
  - iOS: `CKContainer.shareMetadata(for:)` → `accept(_:)`.
  - Android: no programmatic accept verb — the recipient opens the URL,
    Drive grants access. We synthesise a stable share id from the URL hash
    so the TS layer still has a handle.
- `fetchSharedRecords(shareId)`
  - iOS: queries the `sharedCloudDatabase` for records under that share.
  - Android: returns the single Drive file the share id maps to (records
    are 1:1 with files; multi-record shares are encoded as Drive folders
    in a future iteration).

## Why not `google-api-services-drive`

The Google generated client weighs ~6 MB minified + pulls Apache HTTP.
We only need 6 endpoints; OkHttp 4 (already on the React Native classpath)
delivers them in ~400 lines of Kotlin.
