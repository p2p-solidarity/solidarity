# 03 — Domain Models Inventory (Models/ + Extensions/)

Generated 2026-05-24 by Explore agent (~80 types across 18 files).

For each Swift type, the TS port column gives the target shape (Zod schema / interface / discriminated union).

| Path | Type | Kind | Fields | Conformance | Used by | TS port | Notes |
|---|---|---|---|---|---|---|---|
| **Models/BusinessCard.swift** | BusinessCard | struct | id: UUID, name, title?, company?, email?, phone?, profileImage?: Data, animal?: AnimalCharacter, socialNetworks: [SocialNetwork], skills: [Skill], categories: [String], sharingPreferences: SharingPreferences, groupContext?: GroupCredentialContext, verifiedFields?: Set\<BusinessCardField\>, nameType: NameType, createdAt, updatedAt | Codable, Identifiable, Equatable, Hashable. **Custom init(from decoder:)** | CardManager, QRCodeManager, ContactEntity, BusinessCardCredential | `interface BusinessCard { id: string; name: string; ... verifiedFields?: Set<"name"\|...>; nameType: "display_name"\|"verified_legal_name"; }` + `filteredCard()`, `withAttestedFields()` methods | **Custom decoder** with optional defaults. Persisted via SwiftData ContactEntity. UUID→string. profileImage Data→base64. |
| BusinessCard.swift | SocialNetwork | struct | id: UUID, platform: SocialPlatform, username, url? | Codable, Identifiable, Equatable, Hashable | BusinessCard.socialNetworks, CredentialSubject.contactPoint | `interface SocialNetwork { id: string; platform: SocialPlatform; username: string; url?: string; }` | String raw values → TS union. |
| BusinessCard.swift | SocialPlatform | enum | linkedin, twitter, instagram, facebook, github, website, other | String, Codable, CaseIterable | SocialNetwork.platform | `type SocialPlatform = "LinkedIn"\|"Twitter"\|"Instagram"\|"Facebook"\|"GitHub"\|"Website"\|"Other"` | rawValue is display form. |
| BusinessCard.swift | Skill | struct | id: UUID, name, category, proficiencyLevel: ProficiencyLevel | Codable, Identifiable, Equatable, Hashable | BusinessCard.skills | `interface Skill { id: string; name: string; category: string; proficiencyLevel: ProficiencyLevel; }` | |
| BusinessCard.swift | ProficiencyLevel | enum | beginner, intermediate, advanced, expert | String, Codable, CaseIterable | Skill.proficiencyLevel | `type ProficiencyLevel = "Beginner"\|"Intermediate"\|"Advanced"\|"Expert"` | |
| BusinessCard.swift | SharingPreferences | struct | publicFields: Set\<BusinessCardField\>, professionalFields, personalFields, allowForwarding, expirationDate?, useZK, sharingFormat: SharingFormat | Codable. **Custom decoder** (defaults missing sharingFormat to .didSigned) | BusinessCard.sharingPreferences | `interface SharingPreferences { publicFields: Set<BusinessCardField>; ...; sharingFormat: SharingFormat; }` | **Migration path**: old plaintext → didSigned. |
| BusinessCard.swift | FieldVerificationStatus | enum | unverified, selfAttested, verifiedBySource | String, Codable, CaseIterable | BusinessCardCredential.fieldStatuses | `type FieldVerificationStatus = "unverified"\|"self_attested"\|"verified_by_source"` | Wire: rawValue `self_attested` / `verified_by_source`. |
| BusinessCard.swift | NameType | enum | displayName, verifiedLegalName | String, Codable | BusinessCard.nameType, CredentialSubject.subjectCore | `type NameType = "display_name"\|"verified_legal_name"` | Distinguishes self-set vs. passport-verified. |
| BusinessCard.swift | BusinessCardField | enum | name, title, company, email, phone, profileImage, socialNetworks, skills | String, Codable, CaseIterable | SharingPreferences, FieldVerificationStatus | `type BusinessCardField = "name"\|"title"\|...` | Used in VC eligible-fields logic. |
| BusinessCard.swift | SharingLevel | enum | public, professional, personal | String, Codable, CaseIterable | SharingPreferences.effectiveFields() | `type SharingLevel = "public"\|"professional"\|"personal"` | Display: "Public"/"Professional"/"Personal". |
| **Models/AnimalCharacter.swift** | AnimalCharacter | enum | dog, horse, pig, sheep, dove | String, Codable, CaseIterable, Identifiable, Equatable | BusinessCard.animal | `type AnimalCharacter = "dog"\|"horse"\|"pig"\|"sheep"\|"dove"` | `.default(forId:)` uses UTF-8 byte-sum hash for deterministic avatar seeding. |
| **Models/Contact.swift** | Contact | struct | id: UUID, businessCard: BusinessCard, receivedAt, source: ContactSource, tags: [String], notes?, verificationStatus: VerificationStatus, lastInteraction?, sealedRoute?, pubKey?, signPubKey?, didPublicKey?, exchangeSignature?: Data, myExchangeSignature?: Data, exchangeTimestamp?, myEphemeralMessage?, theirEphemeralMessage? | Codable, Identifiable, Equatable | ContactEntity.toLegacyContact(), QR receive | `interface Contact { id: string; businessCard: BusinessCard; sealedRoute?: string; pubKey?: string; signPubKey?: string; didPublicKey?: string; exchangeSignature?: Uint8Array; ... }` | **PII**: businessCard. **Keys**: pubKey (X25519), signPubKey (Ed25519), sealedRoute (blind Sakura route). Data→base64. |
| Contact.swift | ContactSource | enum | qrCode, proximity, appClip, manual, airdrop | String, Codable, CaseIterable, Hashable | Contact.source | `type ContactSource = "QR Code"\|"Proximity"\|"App Clip"\|"Manual"\|"AirDrop"` | |
| Contact.swift | VerificationStatus | enum | verified, unverified, failed, pending | String, Codable, CaseIterable, Hashable | Contact.verificationStatus | `type VerificationStatus = "Verified"\|"Unverified"\|"Failed"\|"Pending"` | Local crypto-verified, not remote trust. |
| **Models/CardError.swift** | CardError | enum w/ assoc values | 19 variants: invalidData, storageError, encryptionError, networkError, passGenerationError, ocrError, sharingError, validationError, notFound, unauthorized, rateLimited, cryptographicError, domainVerificationError, proofGenerationError, proofVerificationError, keyManagementError, offlineError, syncError, configurationError | Error, LocalizedError, Equatable, Codable | All operations | TS discriminated union `{ type: "invalidData"; message: string; } \| { type: "encryptionError"; message: string; } \| …` | Associated string values → payload. Includes severity, isRecoverable, requiresUserIntervention. |
| CardError.swift | ErrorSeverity | enum | low, medium, high, critical | Int, Codable, CaseIterable | CardError.severity | `type ErrorSeverity = "low"\|"medium"\|"high"\|"critical"` | |
| CardError.swift | ErrorContext | struct | timestamp, operation, userId?, deviceInfo, additionalInfo | Codable | CardError.withContext() | `interface ErrorContext { timestamp: Date; operation: string; userId?: string; deviceInfo: DeviceInfo; additionalInfo: Record<string, string>; }` | |
| CardError.swift | DeviceInfo | struct | model, systemVersion, appVersion, buildNumber | Codable | ErrorContext.deviceInfo | `interface DeviceInfo { model: string; systemVersion: string; appVersion: string; buildNumber: string; }` | |
| **Models/EventParticipation.swift** | EventParticipation | struct | id, eventId, eventName, organizer?, eventDate, location?, sourceEmail?, verificationMethod, isVerified, proofDataPath?, createdAt, updatedAt, notes? | Codable, Identifiable, Hashable | Event verification | `interface EventParticipation { ... verificationMethod: "manual"; proofDataPath?: string; }` | proofDataPath = file URL to local artifact. |
| EventParticipation.swift | VerificationMethod | enum | manual | String, Codable | EventParticipation.verificationMethod | `type VerificationMethod = "manual"` | Only manual attestation currently. |
| **Models/ScanLanguage.swift** | ScanLanguage | enum | traditionalChinese, japanese, english | String, CaseIterable, Identifiable | OCRManager | `type ScanLanguage = "zh-Hant"\|"ja"\|"en"` | rawValue = Vision lang code. |
| **Models/SharingFormat.swift** | SharingFormat | enum | plaintext, zkProof, didSigned | String, Codable, CaseIterable, Identifiable | SharingPreferences.sharingFormat | `type SharingFormat = "plaintext"\|"zkProof"\|"didSigned"` | Determines VC vs plaintext wire format. |
| **Models/CloudKitGroupModels.swift** | GroupModel | struct | id, name, description, coverImage?: Data, ownerRecordID, merkleRoot?, merkleTreeDepth, memberCount, isPrivate, isSynced, credentialIssuers: [String] | Identifiable, Hashable, Codable | GroupEntity.toModel() | `interface GroupModel { id: string; name: string; merkleRoot?: string; credentialIssuers: string[]; }` | CloudKit record name: "Group". |
| CloudKitGroupModels.swift | GroupMemberModel | struct | id, groupID, userRecordID, role: Role, status: Status, merkleIndex, joinedAt, sealedRoute?, pubKey?, signPubKey?, deviceToken?, commitment? | Identifiable, Hashable | MemberEntity.toModel() | `interface GroupMemberModel { id: string; groupID: string; userRecordID: string; role: Role; status: Status; pubKey?: string; commitment?: string; }` | CloudKit record: "GroupMembership". Keys: pubKey/signPubKey. commitment = Semaphore identity hash. |
| CloudKitGroupModels.swift | GroupMemberModel.Role | enum | owner, member | String, Codable | GroupMemberModel.role | `type Role = "owner"\|"member"` | |
| CloudKitGroupModels.swift | GroupMemberModel.Status | enum | active, pending, left, kicked | String, Codable | GroupMemberModel.status | `type Status = "active"\|"pending"\|"left"\|"kicked"` | |
| **Models/GroupCredentialContext.swift** | GroupCredentialContext | enum w/ assoc | personal, group(GroupCredentialInfo) | Codable, Equatable, Hashable | BusinessCard.groupContext | `type GroupCredentialContext = { type: "personal" } \| { type: "group"; info: GroupCredentialInfo; }` | Distinguishes L1 self-issued vs L2+ group-issued. |
| GroupCredentialContext.swift | GroupCredentialInfo | struct | groupId, groupName, merkleRoot, issuedBy, issuedAt, proofRequired | Codable, Equatable, Hashable | GroupCredentialContext.group payload | `interface GroupCredentialInfo { groupId: string; groupName: string; merkleRoot: string; issuedBy: string; issuedAt: Date; proofRequired: boolean; }` | Captures group state at issuance time. |
| **Models/GroupCredentialDeliverySettings.swift** | GroupCredentialDeliverySettings | struct | defaultDeliveryMethod, enabledMethods: Set\<DeliveryMethod\>, autoSendToAllMembers, onlySendToExchangedContacts, allowMemberCustomDelivery, requirePIN, pin?, encryptMessages | Codable, Equatable | Group issuance policy | `interface GroupCredentialDeliverySettings { defaultDeliveryMethod: DeliveryMethod; enabledMethods: Set<DeliveryMethod>; requirePIN?: boolean; pin?: string; }` | Methods: sakura, proximity, qrCode, airdrop. Sakura+proximity require sealedRoute. |
| GroupCredentialDeliverySettings.swift | DeliveryMethod | enum | sakura, proximity, qrCode, airdrop | String, Codable, CaseIterable | enabledMethods | `type DeliveryMethod = "Sakura"\|"Proximity"\|"QR Code"\|"AirDrop"` | |
| **Models/GroupEntities.swift** | GroupEntity | class (@Model) | id (unique), name, groupDescription, coverImage?, ownerRecordID, merkleRoot?, merkleTreeDepth, memberCount, isPrivate, isSynced, credentialIssuers, members: [MemberEntity] | SwiftData @Model. Mapper toModel() → GroupModel | GroupEntity storage | **SwiftData entity**. No Codable. | Unique on id. Cascade delete to MemberEntity. |
| GroupEntities.swift | MemberEntity | class (@Model) | id (unique), groupID, userRecordID, role (rawValue), status (rawValue), merkleIndex, joinedAt, sealedRoute?, pubKey?, signPubKey?, deviceToken?, commitment?, group: GroupEntity? | SwiftData @Model. Mapper toModel() → GroupMemberModel | MemberEntity storage | SwiftData entity. Inverse relationship to GroupEntity. |
| **Models/IdentityEntities.swift** | ContactEntity | class (@Model) | id (unique), cardId, name, title?, company?, email?, phone?, source (rawValue), verificationStatus (rawValue), receivedAt, lastInteraction?, tagsData?: Data (JSON [String]), notes?, sealedRoute?, pubKey?, signPubKey?, didPublicKey?, exchangeSignature?: Data, myExchangeSignature?: Data, exchangeTimestamp?, myEphemeralMessage?, theirEphemeralMessage?, graphExportEdgeId?, graphCredentialRef?, commonFriendsHandshakeToken?, credentialIdsData?: Data (JSON [String]), declaredProofClaimsRaw?: Data (JSON [String]) | SwiftData @Model. **Computed accessors**: tags, credentialIds, declaredProofClaims (JSON decode/encode). Mapper: fromLegacy(Contact), toLegacyContact() | ContactEntity storage, contact profile | SwiftData unique on id. **Computed JSON accessors** dodge CoreData Array\<String\> bug. PII + crypto keys. |
| IdentityEntities.swift | IdentityCardEntity | class (@Model) | id (unique), type, issuerType, trustLevel, title, issuerDid, holderDid, issuedAt, expiresAt?, status, sourceReference?, rawCredentialJWT?, metadataTagsData?: Data (JSON [String]), createdAt, updatedAt | SwiftData @Model. **Computed accessor**: metadataTags | VC storage, VerifiedClaimIndex | **Sensitive**: rawCredentialJWT. trustLevel = L1/L2/L3. |
| IdentityEntities.swift | ProvableClaimEntity | class (@Model) | id (unique), identityCardId (source VC), claimType, title, issuerType, trustLevel, source, payload, sourceField?, isPresentable, lastPresentedAt?, createdAt, updatedAt | SwiftData @Model | VerifiedClaimIndex | Indexed by sourceCredentialId. sourceField = BusinessCardField rawvalue (or nil for proofs like is_human/age_over_18). |
| **Models/SecureMessagingModels.swift** | SecureContact | struct | name, pubKey, signPubKey, sealedRoute | Codable | Sakura exchange | `interface SecureContact { name: string; pubKey: string; signPubKey: string; sealedRoute: string; }` | Keys: pubKey (X25519), signPubKey (Ed25519), sealedRoute (blind route). |
| SecureMessagingModels.swift | SealResponse | struct | sealed_route | Codable | Sakura server handshake | `interface SealResponse { sealed_route: string; }` | Wire: snake_case. |
| SecureMessagingModels.swift | SendRequest | struct | recipient_pubkey, blob (base64), sealed_route, sender_pubkey, sender_sig (base64) | Codable | Send encrypted msg | `interface SendRequest { recipient_pubkey: string; blob: string; sender_pubkey: string; sender_sig: string; sealed_route: string; }` | **Wire**: snake_case. blob = AES-256-GCM encrypted. sender_sig = ECDSA sig. |
| SecureMessagingModels.swift | SyncResponse | struct | messages: [InboxMessage] | Codable | Poll incoming | `interface SyncResponse { messages: InboxMessage[]; }` | |
| SecureMessagingModels.swift | InboxMessage | struct | id, owner_pubkey, blob (base64), created_at: Double (Unix sec) | Codable | Inbox item | `interface InboxMessage { id: string; owner_pubkey: string; blob: string; created_at: number; }` | |
| SecureMessagingModels.swift | AckRequest | struct | message_ids, pubkey, sig (base64) | Codable | Ack messages | `interface AckRequest { message_ids: string[]; pubkey: string; sig: string; }` | Sig prevents replay. |
| **Models/Credentials/BusinessCardCredential.swift** | BusinessCardSnapshot | struct | cardId: UUID, name, nameType: NameType, title?, company?, emails: [String], phones: [String], skills: [Skill], socialProfiles: [SocialProfile], categories: [String], animal?: Animal, updatedAt, profileImageDataURI?, summary?, groupContext?, sealedRoute? | Codable. **Custom decoder** with defaults. Nested types: Skill, SocialProfile, Animal | VC payload | `interface BusinessCardSnapshot { cardId: string; emails: string[]; phones: string[]; profileImageDataURI?: string; }` | profileImageDataURI = "data:image/png;base64,…" |
| BusinessCardCredential.swift | BusinessCardSnapshot.Skill | struct | name, category, proficiency (rawValue) | Codable | snapshot.skills | `interface Skill { name: string; category: string; proficiency: ProficiencyLevel; }` | |
| BusinessCardCredential.swift | BusinessCardSnapshot.SocialProfile | struct | platform (rawValue), username, url? | Codable | snapshot.socialProfiles | `interface SocialProfile { platform: SocialPlatform; username: string; url?: string; }` | |
| BusinessCardCredential.swift | BusinessCardSnapshot.Animal | struct | id (rawValue), displayName | Codable | snapshot.animal | `interface Animal { id: AnimalCharacter; displayName: string; }` | |
| BusinessCardCredential.swift | BusinessCardCredentialClaims | struct | card, issuerDid, holderDid, issuanceDate, expirationDate?, credentialId: UUID, publicKeyJwk, sourceCredentialIds, proofClaims, fieldStatuses | Builder only (not Codable) | VC generation | Methods: headerData(kid:), payloadData(), payloadDictionary() | **Custom JWT encoding** via private nested types (JWTHeader, JWTPayload, CredentialSubject). |
| BusinessCardCredential.swift | SubjectCore | struct (private) | name, nameType, nameVerificationStatus, businessCardId, publicKeyJwk | Encodable | Block 1 of VC subject | JSON key: "subject_core". | Core identity anchor. |
| BusinessCardCredential.swift | VerifiedContactClaims | struct (private) | jobTitle?, worksFor?, email?, telephone?, image?, contactPoint?: [SocialAccount], fieldStatuses? | Encodable | Block 2 | JSON key: "verified_contact_claims". | Only fields backed by source credentials. |
| BusinessCardCredential.swift | VerifiedProofs | struct (private) | claims?: [String] | Encodable | Block 3 | JSON key: "verified_proofs". | Non-field claims (is_human, age_over_18). |
| BusinessCardCredential.swift | CredentialMeta | struct (private) | schemaVersion, sourceCredentialIds?, updatedAt? (ISO8601), groupContext? | Encodable | Block 4 | JSON key: "credential_meta". | Provenance + schema v2. |
| BusinessCardCredential.swift | CredentialSubject | struct (private) | id (holderDid), type: ["Person","BusinessCardSubject"], subjectCore, verifiedContactClaims?, verifiedProofs?, credentialMeta, + legacy flat fields | Encodable. **Custom CodingKeys** for "@type", block names | VC credentialSubject | Wire: `@type` via CodingKey. Legacy flat keys for v1 backward compat. |
| BusinessCardCredential.swift | PublicKeyJWK | struct | kty, crv, alg, x (base64url), y (base64url) | Codable | CredentialSubject.publicKeyJwk | `interface PublicKeyJWK { kty: string; crv: string; alg: string; x: string; y: string; }` | EC P-256 in JWK. Methods: jsonData(), toP256PublicKey(), x963Representation(). |
| **Models/Vault/VaultModels.swift** | VaultItemType | enum | file, json, text, encryptedBundle, image, video, document | String, Codable, CaseIterable | VaultItem.metadata.contentType | `type VaultItemType = "file"\|"json"\|"text"\|"encryptedBundle"\|"image"\|"video"\|"document"` | |
| VaultModels.swift | VaultAccessControl | enum | privateOnly, biometricRequired, timeLocked, delegated, publicWithKey | String, Codable, CaseIterable | VaultItem.accessControl | `type VaultAccessControl = "privateOnly"\|"biometricRequired"\|"timeLocked"\|"delegated"\|"publicWithKey"` | |
| VaultModels.swift | VaultItem | struct | id: UUID, name, metadata, encryptedPath: URL, size: Int64, createdAt, updatedAt, tags, timeLockConfig?, accessControl | Identifiable, Codable | Vault storage | `interface VaultItem { id: string; encryptedPath: string; size: bigint; timeLockConfig?: TimeLockConfig; }` | URL→string. |
| VaultModels.swift | VaultMetadata | struct | sourceApp?, originalFileName?, mimeType?, checksum, encryptionAlgorithm ("AES-256-GCM"), keyVersion, originalCreatedAt?, customMetadata, contentType | Codable. Multiple init | VaultItem.metadata | `interface VaultMetadata { checksum: string; encryptionAlgorithm: string; keyVersion: number; customMetadata: Record<string, string>; }` | checksum = SHA256 hex. Methods: computeChecksum(), verifyChecksum(). |
| VaultModels.swift | CloudItemMetadata | struct | fileName, size: Int64, modifiedAt, isDownloaded, downloadProgress? | Codable, Identifiable | Cloud sync | `interface CloudItemMetadata { fileName: string; size: bigint; modifiedAt: Date; }` | |
| VaultModels.swift | ConflictResolution | enum | keepLocal, keepCloud, keepBoth, merge | String, Codable | Sync conflict | `type ConflictResolution = "keepLocal"\|"keepCloud"\|"keepBoth"\|"merge"` | |
| **Models/Vault/TimeLockConfig.swift** | TimeLockConfig | struct | enabled, unlockDate?, inactivityDays?, beneficiaryContactId?: UUID, witnessContactIds: [UUID], status, keyShards, requiredShardCount | Codable, Equatable. Custom CodingKeys | VaultItem.timeLockConfig | `interface TimeLockConfig { enabled: boolean; unlockDate?: Date; keyShards: EncryptedKeyShard[]; }` | Digital inheritance config. |
| TimeLockConfig.swift | TimeLockStatus | enum | locked, unlocked, pendingReview, released, failed | String, Codable | TimeLockConfig.status | `type TimeLockStatus = "locked"\|"unlocked"\|"pendingReview"\|"released"\|"failed"` | |
| TimeLockConfig.swift | EncryptedKeyShard | struct | id: UUID, shardIndex, encryptedData: Data, recipientContactId: UUID, createdAt, isDistributed, acknowledgedAt? | Codable, Identifiable, Equatable | Shamir SSS for inheritance | `interface EncryptedKeyShard { id: string; shardIndex: number; encryptedData: Uint8Array; recipientContactId: string; }` | Sensitive: encryptedData = AES-256-GCM shard. |
| TimeLockConfig.swift | EscrowRequest | struct | id: UUID, vaultItemId: UUID, requesterId: UUID, requestedAt, status, submittedShardIds: [UUID], reviewedAt?, reviewNotes? | Identifiable, Codable | Inheritance escrow | `interface EscrowRequest { id: string; vaultItemId: string; requesterId: string; status: EscrowStatus; }` | |
| TimeLockConfig.swift | EscrowStatus | enum | pending, approved, rejected, expired | String, Codable | EscrowRequest.status | `type EscrowStatus = "pending"\|"approved"\|"rejected"\|"expired"` | |
| TimeLockConfig.swift | InactivityTracker | struct | lastActivityDate, activityHistory: [Date], configuredDaysThreshold | Codable | TimeLockService | `interface InactivityTracker { lastActivityDate: Date; activityHistory: Date[]; configuredDaysThreshold: number; }` | recordActivity() keeps 30-day rolling window. |
| **Models/OIDC/OIDCScope.swift** | OIDCScope | enum | backupWrite, backupRead, preferences, ageOver18, decryptContent, configSync | String, CaseIterable, Codable | OIDC permission | `type OIDCScope = "backup_write"\|"backup_read"\|"preferences"\|"age_over_18"\|"decrypt_content"\|"config_sync"` | rawValue = snake_case wire. riskLevel property. |
| OIDCScope.swift | OIDCClientInfo | struct | clientId, displayName?, iconURL?: URL, trusted, lastUsed? | Codable | OIDC client registry | `interface OIDCClientInfo { clientId: string; displayName?: string; iconURL?: string; trusted: boolean; }` | |
| OIDCScope.swift | PermissionDecision | enum | approved, denied, cancelled | String, Codable | OIDC consent | `type PermissionDecision = "approved"\|"denied"\|"cancelled"` | |
| OIDCScope.swift | PermissionRequest | struct | id: UUID, clientInfo, scopes: [OIDCScope], resourceHint?, requestedAt, requiresExplicitConsent | Identifiable | OIDC permission UI | `interface PermissionRequest { clientInfo: OIDCClientInfo; scopes: OIDCScope[]; }` | totalRiskLevel computed. |
| OIDCScope.swift | OIDCAuthorizationRequest | struct | id: UUID, clientId, redirectUri, state, nonce, scopes, presentationDefinition?, requestedAt, codeChallenge (PKCE S256), codeChallengeMethod | Codable, Identifiable | OIDC auth flow | `interface OIDCAuthorizationRequest { id: string; clientId: string; codeChallenge: string; codeChallengeMethod: string; presentationDefinition?: PresentationDefinition; }` | PKCE required (RFC 7636). |
| OIDCScope.swift | PresentationDefinition | struct | id, inputDescriptors: [InputDescriptor] | Codable | OIDCAuthorizationRequest | `interface PresentationDefinition { id: string; inputDescriptors: InputDescriptor[]; }` | DIF Presentation Exchange. |
| OIDCScope.swift | InputDescriptor | struct | id, name?, purpose? | Codable | PresentationDefinition | `interface InputDescriptor { id: string; name?: string; purpose?: string; }` | DIF VC type selector. |
| OIDCScope.swift | OIDCAuthorizationResponse | struct | state, code?, idToken?, vpToken?, grantedScopes, grantedAt | Codable | OIDC token response | `interface OIDCAuthorizationResponse { state: string; code?: string; idToken?: string; vpToken?: string; grantedScopes: OIDCScope[]; }` | code = authz code; idToken = OIDC JWT; vpToken = W3C VP. |
| **Extensions/Data+Base64URL.swift** | (Data extension) | extension | base64URLEncodedString() → String, init?(base64URLEncoded:), init?(dataURI:) | | JWT, JWS, JWK | TS helpers: `base64UrlEncode(Uint8Array)` / `base64UrlDecode(string)` | RFC 4648 url-safe. No padding. |

---

## Wire format / persistence migration cheatsheet

### 1. Business cards & contacts (Codable → JSON)
- `BusinessCard`: UUID id → string. Data profileImage → base64. Custom decoder defaults missing fields.
- Storage: SwiftData via `ContactEntity` (1:1, tagsData/credentialIdsData as JSON-encoded `[String]` blobs to dodge CoreData array bug)
- Wire keys: id, name, title, company, email, phone, profileImage(base64), animal(rawValue), socialNetworks, skills, categories, sharingPreferences, groupContext, verifiedFields, nameType, createdAt (ISO8601), updatedAt
- Migration: `Contact` → `ContactEntity.fromLegacy()`. Export: `ContactEntity.toLegacyContact()` → JSON.
- `SharingPreferences`: Custom decoder upgrades missing sharingFormat key (plaintext → didSigned).
- `Contact`: includes Sakura fields (sealedRoute/pubKey/signPubKey) + exchange metadata (didPublicKey/exchangeSignature/timestamps/ephemeral messages). PII + crypto keys.

### 2. Groups (CloudKit → SwiftData → JSON)
- **CloudKit records**:
  - "Group": id (record name), name, description, coverImage(Data→base64), ownerRecordID (CKRecord ref), merkleRoot (hex), merkleTreeDepth, memberCount, isPrivate, credentialIssuers
  - "GroupMembership": id, groupID, userRecordID, role (owner/member), status (active/pending/left/kicked), merkleIndex, joinedAt, sealedRoute, pubKey, signPubKey, deviceToken (owner-visible), commitment (Semaphore hash)
- **SwiftData**: `GroupEntity` + `MemberEntity` (no Codable; toModel()/update(from:)).
- TS: Export `.toModel()` → JSON. Import → constructor.

### 3. Verifiable credentials (Codable + JWT)
- `IdentityCardEntity` (SwiftData, NOT Codable): rawCredentialJWT (complete JWT, encrypted in vault).
- `ProvableClaimEntity` (SwiftData, indexed by sourceCredentialId): payload (JSON), sourceField, isPresentable.
- `BusinessCardCredential.Snapshot + Claims`: 4-block subject structure (subject_core, verified_contact_claims, verified_proofs, credential_meta) + legacy flat fields for v1 compat.
- CodingKeys remap: `@type`, `@context`, `subject_core`, `verified_contact_claims`, `verified_proofs`, `credential_meta`.

### 4. Secure messaging (Sakura) — snake_case wire
- `SealResponse`: `{ sealed_route }`
- `SendRequest`: `{ recipient_pubkey, blob (base64 AES-256-GCM), sealed_route, sender_pubkey, sender_sig (base64 ECDSA) }`
- `InboxMessage`: `{ id, owner_pubkey, blob, created_at (Unix sec) }`
- `AckRequest`: `{ message_ids, pubkey, sig (base64 ECDSA) }`
- Key material: pubKey (X25519), signPubKey (Ed25519), sealedRoute (blind, AES-256-GCM sealed)
- TS: base64 strings; decrypt blob client-side with X25519 private key.

### 5. Vault & inheritance (on-disk encryption + SwiftData metadata)
- `VaultItem`: id→string, encryptedPath URL→string, tags, timeLockConfig, accessControl.
- `VaultMetadata`: checksum (SHA256 hex), encryptionAlgorithm ("AES-256-GCM"), keyVersion (rotation tracking).
- `TimeLockConfig`: unlockDate? (fixed) OR inactivityDays? (auto-unlock after N days idle). beneficiaryContactId + witnessContactIds. keyShards = Shamir SSS recovery keys.
- `EncryptedKeyShard`: encryptedData = AES-256-GCM shard encrypted with witness's pubkey (from Contact).
- `InactivityTracker`: 30-day rolling window. On import, reset() to current date to avoid unintended auto-unlock.

### 6. OIDC & consent (Codable)
- `OIDCScope` rawValue = snake_case: `backup_write`, `backup_read`, `age_over_18`, `decrypt_content`, `config_sync`, `preferences`. riskLevel property.
- `OIDCAuthorizationRequest`: PKCE required, codeChallenge = SHA256(verifier).
- `OIDCAuthorizationResponse`: code (authz code), idToken (OIDC JWT), vpToken (W3C VP).
- `OIDCClientInfo`: trusted flag for skipping consent.

### 7. Key derivation & encryption
- `PublicKeyJWK`: `{ kty: "EC", crv: "P-256", alg: "ES256", x: "...", y: "..." }` (base64url coords).
- `Data+Base64URL`: RFC 4648 url-safe. `-` for `+`, `_` for `/`, no padding.

### 8. UserDefaults & file storage keys
- Semaphore proof state: `com.solidarity.semaphore.sentinel` (bool), `com.solidarity.semaphore.crashCount` (int)
- SharingFormat migration: `CardManager.didMigrateSharingFormatKey`
- QR code cache: temporary key=UUID, value=Data (no PII)
- TS: → MMKV (`react-native-mmkv`). Map keys directly.

### 9. Critical fields for data-loss prevention
| Entity | Critical fields | Backup strategy |
|---|---|---|
| BusinessCard | id, name, email, phone, profileImage(base64) | Contact JSON; secure backup |
| Contact | id, businessCard, sealedRoute, pubKey, signPubKey | JSON encrypted backup (PII) |
| IdentityCardEntity | rawCredentialJWT | Encrypted vault; never plaintext |
| ProvableClaimEntity | sourceCredentialId, payload, sourceField | Re-link on import via sourceCredentialId |
| GroupEntity + MemberEntity | id, groupID, merkleRoot, merkleIndex | toModel() JSON; constructor import |
| VaultItem | encryptedPath, timeLockConfig (keyShards, beneficiaryContactId) | Encrypted off-device; ensure key-shard recipients have Contact records |
| ContactEntity.credentialIds | [String] of IdentityCardEntity.id | Validate all IDs exist on import |
| ContactEntity.declaredProofClaims | [String] (peer's labels) | Display as "declared", not "verified" |

### 10. Enum rawValue mappings for TS unions
- String enums (rawValue = case): AnimalCharacter, ScanLanguage, VaultItemType, VaultAccessControl → TS string literal unions
- String enums w/ custom rawValue: SocialPlatform ("LinkedIn"), ContactSource ("QR Code"), SharingFormat (lowercase) → TS must match wire case
- Associated enum cases: GroupCredentialContext, CardError → TS discriminated union `{ type: "...", payload?: ... }`
- Wire renames (CodingKeys): OIDCScope (snake_case), SecureMessagingModels (snake_case) → TS Zod with `.transform()` for camelCase ↔ snake_case
