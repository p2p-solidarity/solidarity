//
//  DomainVerificationManager.swift
//  airmeishi
//
//  Domain verification system for ZK-ready architecture
//

import CryptoKit
import Foundation

/// Manages domain verification for business cards without exposing full email addresses
class DomainVerificationManager {
  static let shared = DomainVerificationManager()

  private let keyManager = KeyManager.shared
  private let networkManager = NetworkManager.shared

  private init() {}

  // MARK: - Public Methods

  /// Verify domain ownership for an email address
  func verifyDomain(for email: String) -> CardResult<DomainVerificationResult> {
    guard let domain = extractDomain(from: email) else {
      return .failure(.validationError("Invalid email format"))
    }

    // Check if domain is in trusted list
    if isTrustedDomain(domain) {
      return .success(
        DomainVerificationResult(
          domain: domain,
          isVerified: true,
          verificationMethod: .trustedList,
          verifiedAt: Date(),
          expiresAt: Calendar.current.date(byAdding: .year, value: 1, to: Date()) ?? Date()
        )
      )
    }

    // Perform DNS-based verification
    return performDNSVerification(for: domain)
  }

  /// Generate domain proof without revealing email
  func generateDomainProof(for email: String) -> CardResult<DomainProof> {
    guard let domain = extractDomain(from: email) else {
      return .failure(.validationError("Invalid email format"))
    }

    let keyResult = keyManager.getDomainKey()

    switch keyResult {
    case .success(let domainKey):
      // Create hash of email with domain key
      let emailData = email.lowercased().data(using: .utf8) ?? Data()
      let domainData = domain.lowercased().data(using: .utf8) ?? Data()

      // Generate commitment (hash of email + domain key)
      let commitment = SHA256.hash(data: emailData + domainKey.withUnsafeBytes { Data($0) })

      // Generate domain hash (hash of domain + domain key)
      let domainHash = SHA256.hash(data: domainData + domainKey.withUnsafeBytes { Data($0) })

      return .success(
        DomainProof(
          domain: domain,
          commitment: Data(commitment),
          domainHash: Data(domainHash),
          proofId: UUID().uuidString,
          createdAt: Date(),
          expiresAt: Calendar.current.date(byAdding: .month, value: 1, to: Date()) ?? Date()
        )
      )

    case .failure(let error):
      return .failure(error)
    }
  }

  /// Verify domain proof without knowing the original email
  func verifyDomainProof(_ proof: DomainProof, expectedDomain: String) -> CardResult<Bool> {
    // Check expiration
    if proof.expiresAt < Date() {
      return .success(false)
    }

    // Verify domain matches
    if proof.domain.lowercased() != expectedDomain.lowercased() {
      return .success(false)
    }

    let keyResult = keyManager.getDomainKey()

    switch keyResult {
    case .success(let domainKey):
      // Recreate domain hash
      let domainData = expectedDomain.lowercased().data(using: .utf8) ?? Data()
      let expectedDomainHash = SHA256.hash(data: domainData + domainKey.withUnsafeBytes { Data($0) })

      // Compare with proof's domain hash
      return .success(Data(expectedDomainHash) == proof.domainHash)

    case .failure:
      return .success(false)
    }
  }

  /// Generate anonymous group membership proof
  func generateGroupMembershipProof(
    userEmail: String,
    groupDomain: String,
    groupId: String
  ) -> CardResult<GroupMembershipProof> {
    guard let userDomain = extractDomain(from: userEmail) else {
      return .failure(.validationError("Invalid email format"))
    }

    // Check if user belongs to the group domain
    guard userDomain.lowercased() == groupDomain.lowercased() else {
      return .failure(.validationError("User does not belong to group domain"))
    }

    let keyResult = keyManager.getDomainKey()

    switch keyResult {
    case .success(let domainKey):
      // Generate anonymous identifier
      let groupData = "\(groupId):\(groupDomain)".lowercased().data(using: .utf8) ?? Data()
      let userData = userEmail.lowercased().data(using: .utf8) ?? Data()

      // Create anonymous ID (hash of user + group + key)
      let anonymousId = SHA256.hash(data: userData + groupData + domainKey.withUnsafeBytes { Data($0) })

      // Create group proof (hash of group + key)
      let groupProof = SHA256.hash(data: groupData + domainKey.withUnsafeBytes { Data($0) })

      return .success(
        GroupMembershipProof(
          groupId: groupId,
          groupDomain: groupDomain,
          anonymousId: Data(anonymousId),
          groupProof: Data(groupProof),
          proofId: UUID().uuidString,
          createdAt: Date(),
          expiresAt: Calendar.current.date(byAdding: .month, value: 3, to: Date()) ?? Date()
        )
      )

    case .failure(let error):
      return .failure(error)
    }
  }

  /// Verify group membership proof
  func verifyGroupMembershipProof(
    _ proof: GroupMembershipProof,
    expectedGroupId: String,
    expectedGroupDomain: String
  ) -> CardResult<Bool> {
    // Check expiration
    if proof.expiresAt < Date() {
      return .success(false)
    }

    // Verify group matches
    if proof.groupId != expectedGroupId || proof.groupDomain.lowercased() != expectedGroupDomain.lowercased() {
      return .success(false)
    }

    let keyResult = keyManager.getDomainKey()

    switch keyResult {
    case .success(let domainKey):
      // Recreate group proof
      let groupData = "\(expectedGroupId):\(expectedGroupDomain)".lowercased().data(using: .utf8) ?? Data()
      let expectedGroupProof = SHA256.hash(data: groupData + domainKey.withUnsafeBytes { Data($0) })

      // Compare with proof's group proof
      return .success(Data(expectedGroupProof) == proof.groupProof)

    case .failure:
      return .success(false)
    }
  }

  /// Get verification status for a domain
  func getDomainVerificationStatus(_ domain: String) -> CardResult<DomainVerificationStatus> {
    // Check cache first
    if let cachedStatus = getCachedVerificationStatus(domain) {
      return .success(cachedStatus)
    }

    // Perform fresh verification
    let verificationResult = performDNSVerification(for: domain)

    switch verificationResult {
    case .success(let result):
      let status = DomainVerificationStatus(
        domain: domain,
        isVerified: result.isVerified,
        lastChecked: Date(),
        nextCheck: Calendar.current.date(byAdding: .day, value: 1, to: Date()) ?? Date()
      )

      // Cache the result
      cacheVerificationStatus(status)

      return .success(status)

    case .failure(let error):
      return .failure(error)
    }
  }

  // MARK: - Private Methods

  private func extractDomain(from email: String) -> String? {
    let components = email.components(separatedBy: "@")
    guard components.count == 2, !components[1].isEmpty else {
      return nil
    }
    return components[1].lowercased()
  }

  private func isTrustedDomain(_ domain: String) -> Bool {
    let trustedDomains = [
      "apple.com",
      "google.com",
      "microsoft.com",
      "github.com",
      "linkedin.com",
    ]

    return trustedDomains.contains(domain.lowercased())
  }

  private func performDNSVerification(for domain: String) -> CardResult<DomainVerificationResult> {
    // In a real implementation, this would perform DNS TXT record lookup
    // For now, we'll simulate the verification

    // Check if domain has valid MX records (simplified check)
    let isValid = domain.contains(".") && !domain.hasPrefix(".") && !domain.hasSuffix(".")

    return .success(
      DomainVerificationResult(
        domain: domain,
        isVerified: isValid,
        verificationMethod: .dnsVerification,
        verifiedAt: Date(),
        expiresAt: Calendar.current.date(byAdding: .day, value: 7, to: Date()) ?? Date()
      )
    )
  }

  private func getCachedVerificationStatus(_ domain: String) -> DomainVerificationStatus? {
    // In a real implementation, this would check local cache
    // For now, return nil to always perform fresh verification
    return nil
  }

  private func cacheVerificationStatus(_ status: DomainVerificationStatus) {
    // In a real implementation, this would cache the status locally
    // For now, this is a no-op
  }
}

// MARK: - Supporting Types

struct DomainVerificationResult: Codable {
  let domain: String
  let isVerified: Bool
  let verificationMethod: VerificationMethod
  let verifiedAt: Date
  let expiresAt: Date

  var isExpired: Bool {
    return expiresAt < Date()
  }
}

struct DomainProof: Codable {
  let domain: String
  let commitment: Data
  let domainHash: Data
  let proofId: String
  let createdAt: Date
  let expiresAt: Date

  var isExpired: Bool {
    return expiresAt < Date()
  }
}

struct GroupMembershipProof: Codable {
  let groupId: String
  let groupDomain: String
  let anonymousId: Data
  let groupProof: Data
  let proofId: String
  let createdAt: Date
  let expiresAt: Date

  var isExpired: Bool {
    return expiresAt < Date()
  }
}

struct DomainVerificationStatus: Codable {
  let domain: String
  let isVerified: Bool
  let lastChecked: Date
  let nextCheck: Date

  var needsRefresh: Bool {
    return nextCheck < Date()
  }
}

enum VerificationMethod: String, Codable, CaseIterable {
  case trustedList = "Trusted List"
  case dnsVerification = "DNS Verification"
  case manualVerification = "Manual Verification"

  var displayName: String {
    return self.rawValue
  }

  var systemImageName: String {
    switch self {
    case .trustedList: return "checkmark.seal.fill"
    case .dnsVerification: return "network"
    case .manualVerification: return "person.badge.key"
    }
  }
}

// MARK: - Network Manager Placeholder

private class NetworkManager {
  static let shared = NetworkManager()

  private init() {}

  // Placeholder for network operations
  func performDNSLookup(domain: String) -> CardResult<[String]> {
    // In a real implementation, this would perform actual DNS lookup
    return .success([])
  }
}
