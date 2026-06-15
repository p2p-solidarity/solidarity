# 02 — Services Inventory (Services/)

Generated 2026-05-24 by Explore agent (~142 files across 15 folders).

Port strategy:
- **TS** = pure logic, port via @noble/* + Zod
- **Nitro** = native module needed (iOS Swift + Android Kotlin)
- **Hybrid** = TS shell + Nitro for crypto/IO

---

## BACKUP

| Path | Service | API | iOS deps | Persistence | Port | Risk | Notes |
|---|---|---|---|---|---|---|---|
| Services/Backup/BackupManager.swift | BackupManager | performBackupNow, restoreFromBackup, probeLatestBackup, update | FileManager, EncryptionManager | FS (iCloud ubiquity + local), UserDefaults | TS+Nitro | Low | AES-GCM with magic "SOLB". iCloud→local fallback. SwiftData entities as payload. @MainActor. |

## CACHE

| Path | Service | API | iOS deps | Persistence | Port | Risk | Notes |
|---|---|---|---|---|---|---|---|
| Services/Cache/IdentityDataStore.swift | IdentityDataStore | upsertContact, addIdentityCard, addProvableClaim, markClaimPresented, clearAllIdentityData | SwiftData, Combine | SwiftData (SolidarityIdentity_v3.store) | Nitro (or expo-sqlite) | Med | Schema v3 lightweight migration. Debounced refresh 100ms. In-memory fallback on corruption. |
| Services/Cache/LocalCacheManager.swift | LocalCacheManager | fetchGroups, saveGroups, deleteGroup, fetchMembers, saveMembers | SwiftData | SwiftData (AirMeishiCache_v2.store) | Nitro/expo-sqlite | Low | Group+member cache. Upsert. In-memory fallback. |

## CARD

| Path | Service | API | iOS deps | Persistence | Port | Risk | Notes |
|---|---|---|---|---|---|---|---|
| Services/Card/CardManager.swift | CardManager | createCard, updateCard, deleteCard, get, getAll, search, reorder, getStatistics | Combine | StorageManager (encrypted) | TS+Nitro | Low | Validates email/phone. Dedup by name. Plaintext→didSigned migration via UserDefaults marker. |
| Services/Card/ContactRepository.swift | ContactRepository | addContact, resolvePendingMerge, updateContact, deleteContact, get(id/pubKey), getAll, search, getBySource, getByTag | Combine, StorageManager | StorageManager | TS+Nitro | Med | Merge proposal on duplicate. Recomputes verification from IdentityCoordinator. @MainActor. |
| Services/Card/QRCodeManager.swift | QRCodeManager | generateQRCode, generateSharingLink, startScanning, handleScanResult, validateScannedData | UIKit, Vision | UserDefaults (link cache) | TS | Med | Fallback QR correction H→M→L. Chunking for large VC. @Published scan results. |
| Services/Card/OCRManager.swift | OCRManager | extractBusinessCardInfo | UIKit, Vision (VNRecognizeTextRequest) | None | Nitro (vision-camera frame processor) | High | Apple Vision OCR with confidence scoring. |
| Services/Card/QRCodeScanService.swift | QRCodeScanService | Parse + verify QR payload, dispatch 5+ routes | AVFoundation, Vision | None | TS+Nitro | High | Payload routing logic. ScanOutcome enum. |
| Services/Card/QRCodeGenerationService.swift | QRCodeGenerationService | generateImage for BusinessCard/sharingLevel | UIKit, CoreImage | None | TS | Low | Segmented encoding (fields bitmask), VC JWT payload. |
| Services/Card/QRCodeChunkingService.swift | QRCodeChunkingService | Encode/decode numbered QR chunks | None | None | TS | Low | Chunk header (seq, total, crc). Progressive reassembly. |
| Services/Card/QRCodeScanService+Handlers.swift | Route handlers | handlePlaintextCard, handleJWTCard, handleOIDCRequest, handleGroupInvite | ProximityManager, IdentityCoordinator | ContactRepository | TS | Med | Delegates to domain services. |
| Services/Card/QRCodeScanService+Verification.swift | Verification helpers | verifySignature, checkJWTExpiry, validateProofClaims | CryptoKit | None | TS | Med | ECDSA P-256, SHA-256, timestamp. |
| Services/Card/QRCodeModels.swift | Data models | QRCodePayload, ScanRoute, ScanOutcome | None | None | TS | Low | |

## CLOUDKIT

| Path | Service | API | iOS deps | Persistence | Port | Risk | Notes |
|---|---|---|---|---|---|---|---|
| Services/CloudKit/CloudKitGroupSyncManager.swift | CloudKitGroupSyncManager | startSyncEngine, fetchLatestChanges, create/update/delete/join/leaveGroup, createInviteLink, getMembers | CloudKit (CKContainer/Database/CustomZone), Combine, LocalCacheManager | CloudKit (private/shared/public) + SwiftData | **iOS Nitro bridge** + Drive (Android) | **High** | Merkle root sync. Subscriptions. Zone fallback. |
| Services/CloudKit/CloudKitGroupSyncManager+Groups.swift | Group CRUD | fetchPublicGroups, fetchPrivateAndShared, mergeGroups, syncMerkleRoots | CloudKit | CloudKit | Nitro | High | Public queryable by invite token. |
| Services/CloudKit/CloudKitGroupSyncManager+Members.swift | Member mgmt | fetchMembers, updateMemberStatus, deliverMembershipProof | CloudKit | CloudKit | Nitro | High | Sealed route caching, proof delivery. |
| Services/CloudKit/CloudKitGroupSyncManager+Invite.swift | Invite flow | createInviteLink, revokeInviteToken, parseInviteToken | CloudKit | CloudKit | TS+Nitro | Med | Token-only join path. |
| Services/CloudKit/CloudKitGroupSyncManager+Setup.swift | Zone & subs | createCustomZoneIfNeeded, subscribeToChanges, checkAccountStatus | CloudKit | CloudKit | Nitro | Med | iCloud account status, zone creation. |
| Services/CloudKit/CloudKitGroupSyncManager+MemberData.swift | Member data sync | syncMemberData, updatePresenceToken | CloudKit | CloudKit | Nitro | Med | Device token, sealed route, commitment. |

## CONTACTS

| Path | Service | API | iOS deps | Persistence | Port | Risk | Notes |
|---|---|---|---|---|---|---|---|
| Services/Contacts/ContactImportService.swift | ContactImportService | requestPermission, importFromVCF, importFromDevice | Contacts (CNContactStore, CNContactVCardSerialization), CryptoKit | IdentityDataStore | TS+expo-contacts | Low | VCF dedup. Deterministic UUID. |

## IDENTITY (37 files)

| Path | Service | API | iOS deps | Persistence | Port | Risk | Notes |
|---|---|---|---|---|---|---|---|
| Services/Identity/KeychainService.swift | KeychainService | ensureSigningKey, ensurePairwiseKey, publicJwk, pairwisePublicJwk, sign, generateSecKey | Security, LocalAuthentication, CryptoKit, SpruceIDMobileSdkRs | iOS Keychain (iCloud-synced or local-only) | **Nitro (Keystore on Android)** | **High** | P-256 ECDSA + biometric gate. Alias routing. v1→v2 master alias migration. iCloud phantom workaround. |
| Services/Identity/BiometricGatekeeper.swift | BiometricGatekeeper | evaluatePolicy, canEvaluate | LocalAuthentication | None | expo-local-authentication | Med | LAContext wrapper. |
| Services/Identity/BiometricSigningKey.swift | BiometricSigningKey | SecKey + biometric access control | Security, LocalAuthentication | Keychain | Nitro | High | LAPolicy.deviceOwnerAuthentication. |
| Services/Identity/DIDService.swift | DIDService | currentDescriptor, currentDidKey, pairwiseDescriptor, document | SpruceIDMobileSdkRs | Keychain | TS (@spruceid mobile-sdk or noble) | Med | did:key only. JWK2020. Pairwise per RP. |
| Services/Identity/DIDKeyResolver.swift | DIDKeyResolver | resolve | None | None | TS | Low | did:key parser. |
| Services/Identity/DIDDocumentExporter.swift | DIDDocumentExporter | Export DID doc as JSON-LD | None | None | TS | Low | |
| Services/Identity/NFCPassportReaderService.swift | NFCPassportReaderService | read, buildMRZKey, checkDigit | CoreNFC (NFCPassportReader), CryptoKit | None | **Nitro (iOS) + jmrtd (Android)** | **High** | ICAO 9303. BAC + PACE + passive auth. Chip UID. DG1 hash. CSCA master list TODO. |
| Services/Identity/VCService.swift | VCService | issue, parse, parseJWT, verify | SpruceIDMobileSdkRs, CryptoKit, LocalAuthentication | VCLibrary | TS+Nitro | High | JWT VC encoding. Biometric gate on sign. |
| Services/Identity/VCService+JWT.swift | JWT helpers | encode/decode | CryptoKit | None | TS | Low | |
| Services/Identity/VCService+Verify.swift | Verification | Signature + chain validation | SpruceIDMobileSdkRs | None | TS+Nitro | Med | Issuer DID resolution. |
| Services/Identity/VCLibrary.swift | VCLibrary | list, add, remove, find, updateStatus | StorageManager | StorageManager | TS+Nitro | Low | StoredCredential wrapper. |
| Services/Identity/IdentityCoordinator.swift | IdentityCoordinator | Orchestrates OIDC, import, issuance, verification | Combine, ProximityManager, IdentityDataStore, KeychainService | Multiple | TS state machine | **High** | **Core choreography.** Emits verification status via Combine. @MainActor. |
| Services/Identity/IdentityCoordinator+Import.swift | Import flow | importBusinessCard, importContact | Contacts, StorageManager | IdentityDataStore | TS | Med | |
| Services/Identity/IdentityCoordinator+Issuance.swift | Issuance | issueFromPassport, issueFromOIDC | Passport, OIDC | Keychain, VCLibrary | TS | Med | |
| Services/Identity/IdentityCoordinator+OIDC.swift | OIDC flows | handleOIDCRequest, submitPresentation | OIDCService, ProofVerifierService | VCLibrary | TS | High | Pre-auth code, token, VP. |
| Services/Identity/IdentityCoordinator+Verification.swift | Verification state | verifyProof, setVerificationStatus | ProofVerifierService | IdentityDataStore | TS | Med | |
| Services/Identity/IdentityImportHelper.swift | Helper | Import utilities | None | None | TS | Low | |
| Services/Identity/IdentityState.swift | Model | State struct | None | None | TS | Low | |
| Services/Identity/IdentityCacheStore.swift | Cache entities | ContactEntity, IdentityCardEntity, ProvableClaimEntity | SwiftData | SwiftData | Nitro (schema) | Low | |
| Services/Identity/BusinessCardCredentialEnvelope.swift | Model | Envelope for signed business card VC | None | None | TS | Low | |
| Services/Identity/GroupCredentialService.swift | Group credential issuance | issueGroupCredential | VCService, Keychain | VCLibrary | TS | Med | |
| Services/Identity/GroupCredentialDeliveryService.swift | Delivery | P2P credential delivery | ProximityManager, WebRTCManager | None | TS | Med | Sakura delivery. |
| Services/Identity/IssuerTrustAnchorStore.swift | Trust mgmt | Trust anchor store | None | StorageManager | Nitro (key material) | Med | Public key pinning. |
| Services/Identity/OIDCNonceStore.swift | OIDC state | Nonce/state cache | None | UserDefaults/StorageManager | TS | Low | |
| Services/Identity/OIDCService.swift | OIDC holder | parseAuthRequest, submitPresentation | None | None | TS | High | SIOPv2/OID4VP, DCQL, direct post. |
| Services/Identity/OIDCService+Helpers.swift | Helpers | JWT/request utilities | CryptoKit | None | TS | Low | |
| Services/Identity/OIDCService+Response.swift | Response | VP/JARM response | CryptoKit, JWE | None | TS | Med | @noble JWT/JWE. |
| Services/Identity/OIDCService+Submit.swift | Submission | Submit VP | URLSession | None | TS | Med | |
| Services/Identity/PassportPipelineService.swift | Passport pipeline | MRZ→NFC→proof→VC | MRZScanner, NFCReader, MoproProof, VCService | Keychain, VCLibrary | TS state machine | **High** | **Coordinator.** PassportStep enum. MRZ↔chip mismatch handling. |
| Services/Identity/ProofVerifierService.swift | Proof verification | verifyVpToken, verifyProof | SpruceIDMobileSdkRs | None | TS+Nitro | High | JWT sig, issuer DID, trust level. |
| Services/Identity/ProofVerifierService+VPToken.swift | VP-specific | VP token parsing | CryptoKit | None | TS | Med | |
| Services/Identity/SensitiveActionPolicyStore.swift | Policy | Sensitive op rules | None | UserDefaults | TS | Low | Biometric gates, cooldowns. |
| Services/Identity/VerifiedClaimIndex.swift | Indexing | Searchable claim index | None | IdentityDataStore | TS | Low | |

## IMPORTER

| Path | Service | API | iOS deps | Persistence | Port | Risk | Notes |
|---|---|---|---|---|---|---|---|
| Services/Importer/TwitterArchiveImporter.swift | TwitterArchiveImporter | importArchive | None | FileManager | TS | Med | Twitter takeout parser. Async + progress. Size limits. |
| Services/Importer/TwitterArchiveImporter+Parsing.swift | Parsing | tweet/account files | None | None | TS | Low | |
| Services/Importer/TwitterArchiveImporter+Models.swift | Models | Result, Tweet, Account | None | None | TS | Low | |
| Services/Importer/StreamParser.swift | Stream parser | Memory-efficient JS parser | None | None | TS (stream JSON) | Med | |

## OIDC

| Path | Service | API | iOS deps | Persistence | Port | Risk | Notes |
|---|---|---|---|---|---|---|---|
| Services/OIDC/CredentialIssuanceService.swift | CredentialIssuanceService | parseOffer, parseOfferAsync, fetchIssuerMetadata, requestToken, requestCredential | URLSession, SpruceIDMobileSdkRs | Keychain | TS+Nitro | High | OID4VCI pre-auth code flow. |
| Services/OIDC/CredentialIssuanceService+Proof.swift | Proof gen | generateProof (DPop/JWT) | CryptoKit, SpruceIDMobileSdkRs | Keychain | Nitro | High | DPop tokens. |
| Services/OIDC/OIDCRequestHandler.swift | Request routing | Route inbound OIDC/OID4VP | None | None | TS | Med | |
| Services/OIDC/OIDCTokenService.swift | Token endpoint | Fetch tokens | URLSession | None | TS | Low | |
| Services/OIDC/CredentialIssuanceModels.swift | Models | CredentialOffer, IssuerMetadata, TokenResponse | None | None | TS | Low | |

## RECOVERY

| Path | Service | API | iOS deps | Persistence | Port | Risk | Notes |
|---|---|---|---|---|---|---|---|
| Services/Recovery/IdentityRecoveryService.swift | IdentityRecoveryService | createBundle, shareBundle, recoverFromBundle | None | StorageManager | TS+Nitro | High | Shamir secret sharing. Distributes bundles to contacts. |

## SCAN

| Path | Service | API | iOS deps | Persistence | Port | Risk | Notes |
|---|---|---|---|---|---|---|---|
| Services/Scan/MRZScannerService.swift | MRZScannerService | setupSession, start/stopScanning, parseTD3, verifyCheckDigit, parseDate | AVFoundation, Vision, UIKit | None | TS + vision-camera | High | Real-time MRZ OCR. TD3 (2×44). Check digit. |
| Services/Scan/ScanRouterService.swift | ScanRouterService | Route scanned QR/MRZ | QRScan, MRZScan | None | TS state machine | Med | |

## SHARING (29 files)

| Path | Service | API | iOS deps | Persistence | Port | Risk | Notes |
|---|---|---|---|---|---|---|---|
| Services/Sharing/ProximityManager.swift | ProximityManager | startAdvertising/Browsing, sendCard, disconnect | MultipeerConnectivity, UIKit, Combine, WebRTCManager | None | **Nitro (MPC↔Nearby Connections)** | **High** | @Published state. Exchange signing + message encryption. Auto-connect, heartbeat. |
| Services/Sharing/ProximityManager+Actions.swift | Actions | handleInvitation, accept/reject | MultipeerConnectivity | None | Nitro | High | |
| Services/Sharing/ProximityManager+Discovery.swift | Discovery | Peer discovery + filtering | MultipeerConnectivity | None | Nitro | High | |
| Services/Sharing/ProximityManager+Exchange.swift | Exchange | Card + proof exchange | Keychain, ProofGen | IdentityDataStore | TS+Nitro | High | Signature + msg encryption, cross-sig validation. |
| Services/Sharing/ProximityManager+SessionDelegate.swift | MC delegate | NSObject delegate | MultipeerConnectivity | None | Nitro | Med | |
| Services/Sharing/ProximityManager+Types.swift | Models | ProximityPeer, ConnectionStatus, DiscoveryState | None | None | TS | Low | |
| Services/Sharing/WebRTCManager.swift | WebRTCManager | setupConnection, offer/answer, addIceCandidate, sendMessage | WebRTC, MultipeerConnectivity | None | react-native-webrtc | Med | Signaling via Proximity. STUN. |
| Services/Sharing/AirDropManager.swift | AirDropManager | shareBusinessCard/Pass/QR, canShareViaAirDrop | UIKit (UIActivityVC), PassKit | None | iOS-only (Share API on Android) | Low | |
| Services/Sharing/PassKitManager.swift | PassKitManager | generatePass, addPassToWallet, updatePass | PassKit (PKPass, PKPassLibrary) | UserDefaults | **iOS-only Nitro** + QR fallback Android | Med | Apple Wallet .pkpass. PKCS#7 sig. |
| Services/Sharing/PassKitManager+Generation.swift | Generation | pkpass bundle assembly | PassKit | None | iOS-only Nitro | Med | |
| Services/Sharing/NearbyInteractionManager.swift | NearbyInteractionManager | startSession, stopSession, handleDiscoveryToken, processDistance | NearbyInteraction, MultipeerConnectivity | None | **Nitro (NI↔Android UWB API 31+)** | **High** | UWB spatial trigger. Token exchange via MC. Debounce state machine. |
| Services/Sharing/NearbyInteractionManager+Delegate.swift | Delegate | NISessionDelegate | NearbyInteraction | None | Nitro | High | |
| Services/Sharing/NearbyInteractionManager+Types.swift | Models | SpatialState, SpatialConfig | None | None | TS | Low | |
| Services/Sharing/GroupProximityManager.swift | GroupProximityManager | Extended Proximity for group distribution | ProximityManager, GroupInviteSigner | CloudKitGroupSyncManager | TS | High | |
| Services/Sharing/GroupInviteSigner.swift | GroupInviteSigner | Sign group invite payloads | Keychain | None | TS+Nitro | Med | |
| Services/Sharing/ProximityIdentitySigner.swift | IdentitySigner | Sign proximity exchange | Keychain, DIDService | None | Nitro | Med | |
| Services/Sharing/ProximityPayload.swift | Model | Exchange payload | None | None | TS | Low | |
| Services/Sharing/ProximityVerificationHelper.swift | Verification | Verify payloads | KeychainService, ProofVerifier | None | Nitro | Med | |
| Services/Sharing/ProximityExchangeBinding.swift | UI glue | Bridges Proximity → SwiftUI | Combine, ProximityManager | None | TS | Low | |
| Services/Sharing/ProximityEvents.swift | Events | Exchange lifecycle | None | None | TS | Low | |
| Services/Sharing/ProximityDebug.swift | Debug | Logging + simulation | None | None | TS | Low | |
| Services/Sharing/SecureKeyManager.swift | Key derivation | Session keys from proximity exchange | CryptoKit | None | TS (@noble) | Med | HKDF. |
| Services/Sharing/SecureMessageStorage.swift | Message cache | Encrypted transient | EncryptionManager | FS | TS | Low | TTL. |
| Services/Sharing/ShareLinkManager.swift | Link generation | Shareable links for QR | Foundation | UserDefaults | TS | Low | |
| Services/Sharing/ShareScopeResolver.swift | Scope | Resolve sharing scope (fields, level, expiry) | None | None | TS | Low | Bitmask. |
| Services/Sharing/ShareSettingsStore.swift | Preferences | User sharing prefs | None | UserDefaults | TS | Low | |
| Services/Sharing/MessageService.swift | P2P messaging | Sakura send/receive | ProximityManager, WebRTCManager | SecureMessageStorage | TS+Nitro | High | E2E group messaging. |
| Services/Sharing/MessageServerPinning.swift | TLS pinning | Cert pinning | Foundation (URLSession) | None | TS (custom delegate) | Low | |
| Services/Sharing/ZIPWriter.swift | Utility | ZIP file writer | Foundation | None | TS | Low | Pass bundles. |

## SOCIALGRAPH

| Path | Service | API | iOS deps | Persistence | Port | Risk | Notes |
|---|---|---|---|---|---|---|---|
| Services/SocialGraph/SocialGraphPrepServices.swift | SocialGraphPrepServices | Prepare contact graph for export | IdentityDataStore | IdentityDataStore | TS | Med | |
| Services/SocialGraph/ProximityManager+GraphPrep.swift | Graph export via proximity | Export graph payload | ProximityManager | IdentityDataStore | TS | Med | |

## UTILS

| Path | Service | API | iOS deps | Persistence | Port | Risk | Notes |
|---|---|---|---|---|---|---|---|
| Services/Utils/EncryptionManager.swift | EncryptionManager | encrypt<T>, decrypt<T>, generateRandomKey, deleteKey | CryptoKit (AES.GCM), Security | Keychain | TS (@noble/ciphers) | Low | AES-256-GCM with Keychain master key. |
| Services/Utils/StorageManager.swift | StorageManager | save/loadBusinessCards/Contacts/UserPreferences, clearAll, getStorageSize | FileManager, EncryptionManager | FS (Documents/AirMeishiStorage/), Keychain | TS+Nitro | Low | Encrypted JSON. Legacy dir migration. Atomic writes. |
| Services/Utils/KeyManager.swift | KeyManager | Symmetric keys (gen/derive/store) | CryptoKit | Keychain | TS+Nitro | Low | HKDF. |
| Services/Utils/KeyManager+Keychain.swift | Keychain helpers | store/retrieve symmetric | Security, CryptoKit | Keychain | Nitro | Low | |
| Services/Utils/DeepLinkManager.swift | DeepLinkManager | handle, parse | UIKit, URLComponents | None | TS (expo-linking) | Low | openid://, openid4vp://, custom schemes. |
| Services/Utils/DeveloperModeManager.swift | DeveloperModeManager | toggle, isEnabled | None | UserDefaults | TS | Low | |
| Services/Utils/DomainVerificationManager.swift | DomainVerificationManager | Verify domain via well-known | URLSession | None | TS | Low | |
| Services/Utils/ErrorHandlingManager.swift | ErrorHandlingManager | Centralized error handling | None | None | TS | Low | CardError enum. |
| Services/Utils/EventRepository.swift | EventRepository | Audit log | None | StorageManager | TS | Low | |
| Services/Utils/HapticFeedbackManager.swift | HapticFeedbackManager | Haptic feedback | UIKit (UIFeedbackGenerator) | None | expo-haptics | Low | |
| Services/Utils/ImageProvider.swift | ImageProvider | Image loading | UIKit, URLSession | None | TS (fetch + cache) | Low | |
| Services/Utils/NotificationSettingsManager.swift | NotificationSettingsManager | Notification prefs | UserNotifications | UserDefaults | expo-notifications | Low | |
| Services/Utils/OfflineManager.swift | OfflineManager | isOnline, statusPublisher | Foundation, Combine | None | TS | Low | Reachability check. |
| Services/Utils/OfflineManager+Types.swift | Models | NetworkStatus | None | None | TS | Low | |
| Services/Utils/ThemeManager.swift | ThemeManager | currentTheme, toggle | UIKit | UserDefaults | TS (Context/Zustand) | Low | Dark/light mode. |
| Services/Utils/Branding.swift | Branding | Static branding config | None | None | TS (env vars) | Low | App name, URLs, scheme IDs. |
| Services/Utils/ShoutoutChartService.swift | Charts | Chart data | None | None | TS | Low | |
| Services/Utils/WebhookManager.swift | Webhooks | Outbound delivery | URLSession | None | TS | Low | |

## VAULT (14 files)

| Path | Service | API | iOS deps | Persistence | Port | Risk | Notes |
|---|---|---|---|---|---|---|---|
| Services/Vault/SovereignVaultService.swift | SovereignVaultService | importFile/Data, exportFile, delete, get, list, applyAccessControl | FileManager, FileEncryption | FS + FileEncryption | TS+Nitro | High | Encrypted file vault. TTL/time-lock. Access control. |
| Services/Vault/FileEncryptionService.swift | FileEncryptionService | encrypt/decryptFile/Data | CryptoKit (AES.GCM), FileManager | Keychain | TS (@noble) | Med | Streaming AES-GCM. Per-chunk nonce v2. v1 refuse-to-decrypt. |
| Services/Vault/VaultSecretsKeychain.swift | KeyStorage | Vault master key in Keychain | Security, CryptoKit | Keychain | Nitro | Low | HKDF per-item key. |
| Services/Vault/ShamirSecretSharing.swift | Shamir SSS | (threshold, total) sharing | None | None | TS (shamirs-secret-sharing) | High | Polynomial interpolation GF(256). |
| Services/Vault/ShamirSecretSharing+BigUInt.swift | BigUInt helpers | Large integer arithmetic | None | None | TS (bn.js) | Med | |
| Services/Vault/WrappedShardEnvelope.swift | Model | Serialized shard | None | None | TS | Low | |
| Services/Vault/ShardDistributionService.swift | Distribution | Distribute shards to contacts | Keychain, ProximityManager | VaultSecretsKeychain | TS | High | Seal shards to contact DIDs. P2P delivery. |
| Services/Vault/ShardDistributionService+Recovery.swift | Recovery | Recover from shards | Keychain, CryptoKit | None | TS | High | Shamir combine. |
| Services/Vault/VaultCloudSyncService.swift | CloudKit sync | Vault metadata sync | CloudKit, VaultSecretsKeychain | CloudKit (encrypted) | iOS Nitro + Drive (Android) | High | |
| Services/Vault/VaultCloudSyncService+Sync.swift | Sync logic | Upstream/downstream | CloudKit | CloudKit | Nitro | High | |
| Services/Vault/ContentKeyExchangeService.swift | Key exchange | DH for shared vault | CryptoKit, Keychain | Keychain (ephemeral) | TS+Nitro | High | @noble DH. |
| Services/Vault/InactivityMonitorService.swift | Timeout | Auto-lock after inactivity | Foundation, UIApplication | UserDefaults | TS+expo-app-state | Low | |
| Services/Vault/InactivityMonitorService+Notifications.swift | Notifications | Alert before lock | UserNotifications | None | expo-notifications | Low | |
| Services/Vault/ZKAgeVerificationService.swift | ZK age check | Prove age without DOB | MoproProofService, ZK circuits | None | Nitro (mopro) | High | age_over_18 circuit. |

## ZK (10 files)

| Path | Service | API | iOS deps | Persistence | Port | Risk | Notes |
|---|---|---|---|---|---|---|---|
| Services/ZK/MoproProofService.swift | MoproProofService | generateProof, verifyProof | OpenPassportSwift (mopro-binding, Barretenberg C++), os.Logger, CryptoKit | UserDefaults (sentinel, config) | **Nitro wrap mopro-binding** | **High** | On-device ZK proving. Noir circuits. Crash detection sentinel. |
| Services/ZK/MoproProofService+Fallbacks.swift | Fallbacks | generateFallbackProof | None | None | TS (SD-JWT/Semaphore) | High | Trust level "blue" for fallback. |
| Services/ZK/ProofGenerationManager.swift | ProofGenerationManager | generateProof (orch), cacheProof, getCachedProof | MoproProof, Passport, IdentityCoord | UserDefaults/ProofCache | TS state machine | High | **Central ZK flow.** ProofGenerationStep enum. |
| Services/ZK/ProofGenerationManager+Verification.swift | Verification | verifyProofSignature, validateProofAge | ProofVerifier | None | TS | High | |
| Services/ZK/ProofModels.swift | Models | MoproProofOutput, ProofGenerationStep, ProofCache | None | None | TS | Low | |
| Services/ZK/SemaphoreGroupManager.swift | Semaphore groups | Manage group memberships | None | Keychain, IdentityDataStore | TS+Nitro | High | Identity commitment, Merkle tree. |
| Services/ZK/SemaphoreIdentityManager.swift | Semaphore identity | Identity commitment hash | CryptoKit, SpruceIDMobileSdkRs | Keychain | TS+Nitro | High | Derive from master key. Pairwise. |
| Services/ZK/NullifierStore.swift | Nullifier tracking | Track spent nullifiers | None | StorageManager | TS | Med | Double-spend prevention. |
| Services/ZK/PassportAnchorCommitmentStore.swift | Anchor cache | Anchor commitments | None | StorageManager | TS | Low | DG1 hash → anchor. |
| Services/ZK/ZKLogger.swift | Logging | ZK debug logging | os.Logger | None | TS | Low | |

---

## Cross-cutting concerns

### Singletons & @MainActor

**Singletons (23+):**
- `@MainActor`: BackupManager, IdentityDataStore, CloudKitGroupSyncManager, IdentityCoordinator, ContactRepository, CardManager, MRZScannerService, ProximityManager, NearbyInteractionManager, SovereignVaultService, IdentityRecoveryService, PassKitManager, OIDCService, ProofGenerationManager
- Background-safe: KeychainService, MoproProofService, StorageManager, EncryptionManager, FileEncryptionService, LocalCacheManager, VCLibrary, VCService

**RN architecture impact**: `@MainActor` singletons → React Context providers OR Zustand stores. Drop the `@MainActor` decorator; mutate state via `useState`/`useReducer`. For heavy crypto, dispatch to background via Nitro Promise.

### Combine / reactive patterns

**`@Published` properties:**
- IdentityCoordinator: `verificationStatusesPublisher`, `identityStepsPublisher`
- CardManager / ContactRepository: `businessCards`, `contacts`, `lastError`
- ProximityManager: `isAdvertising`, `nearbyPeers`, `receivedCards`, `latestExchangeCompletion`
- OfflineManager: `statusPublisher`

**RN replacement**: React hooks (`useState`, `useReducer`) for state; custom hooks for reactivity (`useEffect` subscriptions); Zustand for global state.

### Threading

- `async/await` everywhere — direct map to TS
- `DispatchQueue` for MC session ops / video processing → Nitro Promises on background queue
- `@MainActor` enforcement → React main-thread default; heavy work goes via Nitro

### Error handling

`CardResult<T>` enum (success/failure) with `CardError` variants (validationError, notFound, encryptionError, networkError, configurationError, storageError, invalidData, passGenerationError, ocrError…)

**RN replacement**: TS discriminated union `Result<T, CardError>` or `{ ok: true, value } | { ok: false, error }`. Export `CardError` mapping to TS.

---

## Top-10 highest-risk services (port order)

| Rank | Service | File | Blocker | Approach |
|---|---|---|---|---|
| 1 | KeychainService | Identity/KeychainService.swift | iOS Keychain has no Android equiv | Nitro: iOS Keychain + Android Keystore. HybridObject for key ops. |
| 2 | CloudKitGroupSyncManager | CloudKit/* | CloudKit iOS-only | iOS Nitro wrapper + Drive (Android) via `react-native-cloud-storage` |
| 3 | ProximityManager | Sharing/ProximityManager.swift | MultipeerConnectivity iOS-only | Nitro: iOS MCSession + Android Nearby Connections. Unified API. |
| 4 | MoproProofService | ZK/MoproProofService.swift | mopro-binding is iOS xcframework | Nitro wrap on iOS; rebuild Rust `cdylib` for Android (aarch64-linux-android + x86_64-linux-android) + JNI shim |
| 5 | NFCPassportReaderService | Identity/NFCPassportReaderService.swift | CoreNFC iOS-only | Nitro: iOS CoreNFC + Android jmrtd JNI |
| 6 | PassportPipelineService | Identity/PassportPipelineService.swift | depends on #1, #4, #5 | Port sub-services first, then compose as TS state machine |
| 7 | NearbyInteractionManager | Sharing/NearbyInteractionManager.swift | NI iOS 14.3+ only | iOS Nitro + Android UWB API 31+. Fallback to BLE RSSI for older devices. |
| 8 | IdentityCoordinator | Identity/IdentityCoordinator.swift | depends on 6+ services | Compose after sub-services. Zustand store + custom hooks. |
| 9 | ProofGenerationManager | ZK/ProofGenerationManager.swift | depends on #4, #5, #6 | Multi-step async state machine. Port after sub-services. |
| 10 | VaultCloudSyncService | Vault/VaultCloudSyncService.swift | depends on #2 | Local MMKV first, defer cloud sync. Shamir stays TS via @noble. |

---

## Summary

- **142 files in 15 folders**
- **6 iOS-only blockers** requiring Nitro modules or architectural replacement: Keychain, CloudKit, MultipeerConnectivity, CoreNFC, NearbyInteraction, mopro-binding
- **@MainActor + Combine heavy**: refactor to React Context → Zustand
- **Crypto-heavy**: port to @noble/curves + @noble/ciphers + passport-noir
- **Complex orchestration**: IdentityCoordinator, PassportPipelineService, ProofGenerationManager → rewrite as Zustand stores + custom hooks
- **P2P for Android**: ProximityManager → Nearby Connections, NearbyInteraction → UWB API 31+ + BLE RSSI fallback
