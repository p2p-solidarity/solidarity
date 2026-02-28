import CryptoKit
import Foundation
import LocalAuthentication
import Security
import SpruceIDMobileSdkRs

extension KeychainService {
  static func rpAlias(for domain: String) -> KeyAlias {
    "\(rpAliasPrefix)\(sanitizeDomain(domain))"
  }

  static func modernRpAlias(for domain: String) -> KeyAlias {
    "\(modernRpAliasPrefix)\(sanitizeDomain(domain))"
  }

  func ensurePairwiseKey(for domain: String) -> CardResult<Void> {
    let service = KeychainService(alias: Self.rpAlias(for: domain))
    service.migrateFromAlternativeAliasIfNeeded(Self.modernRpAlias(for: domain))
    return service.ensureSigningKey()
  }

  func pairwiseSigningKey(for domain: String, context: LAContext? = nil) -> CardResult<BiometricSigningKey> {
    let service = KeychainService(alias: Self.rpAlias(for: domain))
    service.migrateFromAlternativeAliasIfNeeded(Self.modernRpAlias(for: domain))
    return service.signingKey(context: context)
  }

  func pairwisePublicJwk(for domain: String, context: LAContext? = nil) -> CardResult<PublicKeyJWK> {
    let service = KeychainService(alias: Self.rpAlias(for: domain))
    service.migrateFromAlternativeAliasIfNeeded(Self.modernRpAlias(for: domain))
    return service.publicJwk(context: context)
  }

  static func sanitizeDomain(_ domain: String) -> String {
    let normalized = domain
      .lowercased()
      .replacingOccurrences(of: "https://", with: "")
      .replacingOccurrences(of: "http://", with: "")
      .trimmingCharacters(in: CharacterSet(charactersIn: "/"))

    let allowed = CharacterSet(charactersIn: "abcdefghijklmnopqrstuvwxyz0123456789.-")
    return normalized.unicodeScalars
      .map { allowed.contains($0) ? Character($0) : "-" }
      .reduce(into: "") { partialResult, char in
        partialResult.append(char)
      }
  }

  fileprivate func migrateFromAlternativeAliasIfNeeded(_ alias: KeyAlias) {
    if keyExists() { return }
    _ = migrateLegacySecKey(tag: alias)
  }
}

extension KeychainService {
  func migrateLegacyKeysIfNeeded() {
    guard alias == Self.masterAlias else { return }
    let marker = "solidarity.migration.completed.\(alias)"
    if UserDefaults.standard.bool(forKey: marker) {
      return
    }

    if keyExists() {
      UserDefaults.standard.set(true, forKey: marker)
      return
    }

    var migrated = false
    migrated = migrated || migrateLegacySecKey(tag: Self.modernMasterAlias)
    migrated = migrated || migrateLegacySecKey(tag: "airmeishi.did.signing")

    if !migrated,
      let sessionId = UserDefaults.standard.string(forKey: "airmeishi.keychain.session.id")
    {
      migrated = migrated || migrateLegacySecKey(tag: "airmeishi.did.signing.\(sessionId)")
    }

    if !migrated {
      migrated = migrated || migrateLegacyRawPrivateKey(tag: "com.kidneyweakx.airmeishi.keys.signing_key")
    }

    if migrated {
      print("[KeychainService] Migrated legacy signing key to \(alias)")
    }

    UserDefaults.standard.set(true, forKey: marker)
  }

  fileprivate func migrateLegacySecKey(tag: String) -> Bool {
    let oldTag = Data(tag.utf8)
    let query: [String: Any] = [
      kSecClass as String: kSecClassKey,
      kSecAttrApplicationTag as String: oldTag,
      kSecReturnRef as String: true,
      kSecMatchLimit as String: kSecMatchLimitOne,
    ]

    var item: CFTypeRef?
    let status = SecItemCopyMatching(query as CFDictionary, &item)
    guard status == errSecSuccess, let secKey = item else {
      return false
    }

    let addQuery: [String: Any] = [
      kSecClass as String: kSecClassKey,
      kSecValueRef as String: secKey,
      kSecAttrApplicationTag as String: keyTag,
      kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlocked,
      kSecAttrSynchronizable as String: kCFBooleanTrue as Any,
    ]
    let addStatus = SecItemAdd(addQuery as CFDictionary, nil)
    return addStatus == errSecSuccess || addStatus == errSecDuplicateItem
  }

  fileprivate func migrateLegacyRawPrivateKey(tag: String) -> Bool {
    let query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrAccount as String: tag,
      kSecReturnData as String: true,
      kSecMatchLimit as String: kSecMatchLimitOne,
    ]

    var dataRef: CFTypeRef?
    let status = SecItemCopyMatching(query as CFDictionary, &dataRef)
    guard status == errSecSuccess, let privateData = dataRef as? Data else {
      return false
    }

    let attributes: [String: Any] = [
      kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom,
      kSecAttrKeyClass as String: kSecAttrKeyClassPrivate,
      kSecAttrKeySizeInBits as String: 256,
    ]

    guard let secKey = SecKeyCreateWithData(privateData as CFData, attributes as CFDictionary, nil) else {
      return false
    }

    let addQuery: [String: Any] = [
      kSecClass as String: kSecClassKey,
      kSecValueRef as String: secKey,
      kSecAttrApplicationTag as String: keyTag,
      kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlocked,
      kSecAttrSynchronizable as String: kCFBooleanTrue as Any,
    ]
    let addStatus = SecItemAdd(addQuery as CFDictionary, nil)
    return addStatus == errSecSuccess || addStatus == errSecDuplicateItem
  }
}
