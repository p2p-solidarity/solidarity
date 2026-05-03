import Foundation

extension QRCodeScanService {
  func rebuildCard(from payload: QRPlaintextPayload) -> BusinessCard {
    let snapshot = payload.snapshot
    let skills = snapshot.skills.map {
      Skill(
        name: $0.name,
        category: $0.category,
        proficiencyLevel: ProficiencyLevel(rawValue: $0.proficiency) ?? .intermediate
      )
    }

    let networks = snapshot.socialProfiles.map {
      SocialNetwork(
        platform: SocialPlatform(rawValue: $0.platform) ?? .other,
        username: $0.username,
        url: $0.url
      )
    }

    let animal = snapshot.animal.flatMap { AnimalCharacter(rawValue: $0.id) }

    return BusinessCard(
      id: snapshot.cardId,
      name: snapshot.name,
      title: snapshot.title,
      company: snapshot.company,
      email: snapshot.emails.first,
      phone: snapshot.phones.first,
      profileImage: snapshot.profileImageDataURI.flatMap { Data(dataURI: $0) },
      animal: animal,
      socialNetworks: networks,
      skills: skills,
      categories: snapshot.categories,
      sharingPreferences: SharingPreferences()
    )
  }

  func verifyIssuer(
    commitment: String?,
    proof: String?,
    message: String,
    scope: String
  ) -> VerificationStatus {
    ProximityVerificationHelper.verify(
      commitment: commitment,
      proof: proof,
      message: message,
      scope: scope
    )
  }

  func statusFromStoredCredential(_ status: VCLibrary.StoredCredential.Status) -> VerificationStatus {
    switch status {
    case .verified:
      return .verified
    case .unverified:
      return .unverified
    case .failed, .revoked:
      return .failed
    }
  }

  func verificationStatus(from verification: VpTokenVerificationResult) -> VerificationStatus {
    if verification.isValid {
      return .verified
    }
    switch verification.status {
    case .verified:
      return .verified
    case .failed:
      return .failed
    case .pending:
      return .pending
    case .unverified:
      return .unverified
    }
  }

  func shouldImportAsCredential(_ token: String) -> Bool {
    guard let payload = decodeCompactJWTPayload(token) else { return false }
    if payload["vp"] != nil {
      return false
    }
    return payload["vc"] != nil
  }

  func decodeCompactJWTPayload(_ token: String) -> [String: Any]? {
    let segments = token.split(separator: ".")
    guard segments.count == 3,
      let payloadData = Data(base64URLEncoded: String(segments[1])),
      let payload = try? JSONSerialization.jsonObject(with: payloadData) as? [String: Any]
    else {
      return nil
    }
    return payload
  }

  /// Pulls `verified_proofs.claims` out of a JWT VC payload without
  /// re-running signature verification. Returns `nil` when the JWT is not
  /// a BusinessCardCredentialEnvelope (e.g. unrelated VC, malformed) so
  /// the caller can leave existing declared claims untouched. An empty
  /// array means the envelope explicitly declared zero proofs.
  func extractDeclaredProofClaims(fromJWT jwt: String) -> [String]? {
    let segments = jwt.split(separator: ".")
    guard segments.count == 3,
      let payloadData = Data(base64URLEncoded: String(segments[1]))
    else {
      return nil
    }
    guard
      let envelope = try? JSONDecoder().decode(
        BusinessCardCredentialEnvelope.self,
        from: payloadData
      )
    else {
      return nil
    }
    let credentialSubject = (envelope.vc ?? envelope.payload?.vc)?.credentialSubject
    return credentialSubject?.verifiedProofs?.claims
  }

  func verifyProofClaims(
    _ claims: [String]?,
    issuerStatus: VerificationStatus,
    issuerProofPresent: Bool,
    ageOver18ProofValid: Bool
  ) -> VerificationStatus {
    guard let claims, !claims.isEmpty else {
      return issuerStatus
    }

    let supportedClaims: Set<String> = ["is_human", "age_over_18"]
    if claims.contains(where: { !supportedClaims.contains($0) }) {
      return .failed
    }

    guard issuerStatus == .verified else {
      return .failed
    }

    if claims.contains("is_human"), !issuerProofPresent {
      return .failed
    }

    if claims.contains("age_over_18"), !ageOver18ProofValid {
      return .failed
    }

    return .verified
  }
}
