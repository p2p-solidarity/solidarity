import Foundation

struct TrustedIssuerAnchor: Codable, Equatable {
  let issuerDid: String
  let publicKeyJwk: PublicKeyJWK
  let keyId: String?
  let source: String
  let updatedAt: Date
}

final class IssuerTrustAnchorStore {
  static let shared = IssuerTrustAnchorStore()

  private let storageKey = AppBranding.currentTrustedIssuerAnchorsKey
  private let legacyStorageKey = AppBranding.legacyTrustedIssuerAnchorsKey
  private let defaults: UserDefaults
  private let didService: DIDService
  private var anchors: [TrustedIssuerAnchor]

  init(
    defaults: UserDefaults = .standard,
    didService: DIDService = DIDService()
  ) {
    self.defaults = defaults
    self.didService = didService
    Self.migrateLegacyAnchorsIfNeeded(in: defaults, storageKey: storageKey, legacyStorageKey: legacyStorageKey)
    self.anchors = Self.loadAnchors(from: defaults, storageKey: storageKey)
  }

  func trustedJWK(for issuerDid: String, keyId: String?) -> PublicKeyJWK? {
    if let local = trustedLocalJWK(for: issuerDid, keyId: keyId) {
      return local
    }

    let normalizedIssuer = Self.normalizeDid(issuerDid)
    let matches = anchors.filter { Self.normalizeDid($0.issuerDid) == normalizedIssuer }
    guard !matches.isEmpty else { return nil }

    guard let keyId, !keyId.isEmpty else {
      return matches.first?.publicKeyJwk
    }

    if let exact = matches.first(where: { $0.keyId == keyId }) {
      return exact.publicKeyJwk
    }

    let suffix = keyId.components(separatedBy: "#").last
    if let suffix,
       let suffixMatch = matches.first(where: {
         $0.keyId?.components(separatedBy: "#").last == suffix
       })
    {
      return suffixMatch.publicKeyJwk
    }

    return nil
  }

  func isTrustedIssuer(_ issuerDid: String, keyId: String?) -> Bool {
    trustedJWK(for: issuerDid, keyId: keyId) != nil
  }

  func registerAnchor(
    issuerDid: String,
    publicKeyJwk: PublicKeyJWK,
    keyId: String?,
    source: String = "manual"
  ) {
    let normalizedIssuer = Self.normalizeDid(issuerDid)
    anchors.removeAll {
      Self.normalizeDid($0.issuerDid) == normalizedIssuer && ($0.keyId ?? "") == (keyId ?? "")
    }
    anchors.append(
      TrustedIssuerAnchor(
        issuerDid: issuerDid,
        publicKeyJwk: publicKeyJwk,
        keyId: keyId,
        source: source,
        updatedAt: Date()
      )
    )
    persistAnchors()
  }

  func replaceAnchors(_ newAnchors: [TrustedIssuerAnchor]) {
    anchors = newAnchors
    persistAnchors()
  }

  func allAnchors() -> [TrustedIssuerAnchor] {
    anchors
  }

  private func trustedLocalJWK(for issuerDid: String, keyId: String?) -> PublicKeyJWK? {
    guard case .success(let descriptor) = didService.currentDescriptor() else { return nil }
    guard Self.normalizeDid(descriptor.did) == Self.normalizeDid(issuerDid) else { return nil }
    if let keyId, !keyId.isEmpty, keyId != descriptor.verificationMethodId {
      return nil
    }
    return descriptor.jwk
  }

  private func persistAnchors() {
    guard let data = try? JSONEncoder().encode(anchors) else { return }
    defaults.set(data, forKey: storageKey)
  }

  private static func migrateLegacyAnchorsIfNeeded(
    in defaults: UserDefaults,
    storageKey: String,
    legacyStorageKey: String
  ) {
    guard defaults.object(forKey: storageKey) == nil,
      let legacyData = defaults.data(forKey: legacyStorageKey)
    else { return }

    defaults.set(legacyData, forKey: storageKey)
    defaults.removeObject(forKey: legacyStorageKey)
  }

  private static func loadAnchors(from defaults: UserDefaults, storageKey: String) -> [TrustedIssuerAnchor] {
    guard let data = defaults.data(forKey: storageKey),
          let decoded = try? JSONDecoder().decode([TrustedIssuerAnchor].self, from: data)
    else {
      return []
    }
    return decoded
  }

  private static func normalizeDid(_ did: String) -> String {
    did.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
  }
}
