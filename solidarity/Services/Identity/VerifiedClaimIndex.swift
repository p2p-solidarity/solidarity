//
//  VerifiedClaimIndex.swift
//  solidarity
//
//  Read-only index over the claim store.
//
//  Architecture — the three logical objects:
//
//    1) ContactProfile  (ContactEntity)
//       Pure UX data. Editable, possibly untrusted. May hold credential
//       references (ContactEntity.credentialIds) but does NOT own VC
//       contents.
//
//    2) CredentialVault  (VCLibrary + IdentityCardEntity)
//       Stores VC / JWT only. Append-only signed data. Never mutated.
//
//    3) VerifiedClaimIndex  (ProvableClaimEntity + this service)
//       Queryable claim index derived from VCs. Every claim MUST have a
//       sourceCredentialId. UI reads "is email verified" from here, not
//       from the raw ContactProfile column.
//
//  One-way dependency: ContactProfile → CredentialVault → VerifiedClaimIndex.
//  Never flow raw ContactProfile data back into a signed VC.
//

import Foundation

/// Read-only index over ProvableClaimEntity, answering "what is verified
/// for whom, and by which source credential?". Write access is through
/// `IdentityDataStore.addProvableClaim`.
enum VerifiedClaimIndex {
  /// All presentable claims in the index.
  @MainActor
  static var allClaims: [ProvableClaimEntity] {
    IdentityDataStore.shared.provableClaims.filter { $0.isPresentable }
  }

  /// Claims backed by a specific source credential (VC).
  @MainActor
  static func claims(forCredential credentialId: String) -> [ProvableClaimEntity] {
    allClaims.filter { $0.sourceCredentialId == credentialId }
  }

  /// Claims for a holder DID. Walks IdentityCardEntity to find credentials
  /// issued to the holder, then collects their claims.
  @MainActor
  static func claims(forHolder holderDid: String) -> [ProvableClaimEntity] {
    let credentialIds = IdentityDataStore.shared.identityCards
      .filter { $0.holderDid == holderDid }
      .map { $0.id }
    let idSet = Set(credentialIds)
    return allClaims.filter { idSet.contains($0.sourceCredentialId) }
  }

  /// Set of BusinessCardFields that have a backing claim for this holder.
  /// Callers use this to populate `BusinessCard.verifiedFields` before VC
  /// issuance — the VC payload is restricted to this set, never the raw
  /// ContactProfile.
  @MainActor
  static func verifiedFields(forHolder holderDid: String) -> Set<BusinessCardField> {
    var fields: Set<BusinessCardField> = []
    for claim in claims(forHolder: holderDid) {
      guard let raw = claim.sourceField, let field = BusinessCardField(rawValue: raw) else {
        continue
      }
      fields.insert(field)
    }
    return fields
  }

  /// Thread-safe variant — hops to MainActor if called off-main.
  /// Used by VCService during issuance where the DID is resolved outside
  /// SwiftUI. Non-MainActor callers block briefly on main.
  static func verifiedFieldsSync(forHolder holderDid: String) -> Set<BusinessCardField> {
    if Thread.isMainThread {
      return MainActor.assumeIsolated { verifiedFields(forHolder: holderDid) }
    }
    return DispatchQueue.main.sync {
      MainActor.assumeIsolated { verifiedFields(forHolder: holderDid) }
    }
  }

  /// Distinct credential IDs backing verified claims for this holder.
  /// Used when building multi-VC VPs — resolve sourceCredentialIds, then
  /// fetch each VC's JWT from VCLibrary and batch via
  /// `OID4VPPresentationService.wrapCredentialsAsVP`.
  @MainActor
  static func credentialIds(forHolder holderDid: String) -> [String] {
    let seen = claims(forHolder: holderDid).map { $0.sourceCredentialId }
    return Array(Set(seen))
  }

  /// Answers: does the holder have a verified claim for this field?
  /// UI should read this rather than the raw ContactProfile column.
  @MainActor
  static func isFieldVerified(_ field: BusinessCardField, forHolder holderDid: String) -> Bool {
    verifiedFields(forHolder: holderDid).contains(field)
  }

  /// Non-field claims (e.g. "age_over_18", "is_human") available for the
  /// holder. Distinct from field-level verification.
  @MainActor
  static func nonFieldClaims(forHolder holderDid: String) -> [ProvableClaimEntity] {
    claims(forHolder: holderDid).filter { $0.sourceField == nil }
  }
}
