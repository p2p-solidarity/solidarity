import Foundation

struct UnifiedProfile: Equatable {
  var zkIdentity: SemaphoreIdentityManager.IdentityBundle?
  var activeDID: DIDDescriptor?
  var memberships: [GroupMembership]

  var isEmpty: Bool {
    zkIdentity == nil && activeDID == nil
  }
}

struct GroupMembership: Equatable, Identifiable {
  let id: String  // Group ID
  let name: String
  let status: MembershipStatus
  let memberIndex: Int?

  enum MembershipStatus: String, Equatable {
    case active
    case outdated
    case pending
    case notMember
  }
}

struct IdentityState: Equatable {
  struct VerificationEvent: Equatable {
    let cardId: UUID
    let status: VerificationStatus
    let timestamp: Date
  }

  struct ImportEvent: Equatable {
    let kind: IdentityImportKind
    let summary: String
    let timestamp: Date
  }

  struct OIDCEvent: Equatable {
    enum Kind: String {
      case requestCreated
      case credentialImported
      case error
    }

    let kind: Kind
    let state: String
    let message: String
    let timestamp: Date
  }

  var isLoading: Bool
  var currentProfile: UnifiedProfile

  // Legacy/Internal state
  var didDocument: DIDDocument?
  var cachedDocuments: [String: DIDDocument]
  var cachedJwks: [String: PublicKeyJWK]
  var verificationCache: [UUID: VerificationStatus]
  var lastVerificationUpdate: VerificationEvent?
  var lastImportEvent: ImportEvent?
  var lastError: CardError?
  var activeOIDCRequests: [String: OIDCService.PresentationRequest]
  var lastOIDCEvent: OIDCEvent?
}

enum IdentityImportKind: String {
  case oidcResponse
  case qrPayload
  case file
  case clipboard
}

enum IdentityImportSource {
  case oidcResponse(URL)
  case qrPayload(String)
  case fileURL(URL)
  case clipboard(String)

  var kind: IdentityImportKind {
    switch self {
    case .oidcResponse: return .oidcResponse
    case .qrPayload: return .qrPayload
    case .fileURL: return .file
    case .clipboard: return .clipboard
    }
  }
}

struct IdentityImportResult: Equatable {
  enum Payload: Equatable {
    case didDocument(DIDDocument)
    case publicJwk(PublicKeyJWK, did: String?)
    case zkIdentity(SemaphoreIdentityManager.IdentityBundle)
    case credential(VCLibrary.StoredCredential)
    case presentationRequest(OIDCService.PresentationRequest)
  }

  let payload: Payload
  let message: String
}
