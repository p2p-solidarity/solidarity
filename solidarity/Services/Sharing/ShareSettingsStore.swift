import Foundation

enum ShareSettingsStore {
  private static let fieldTitleKey = "share_field_title"
  private static let fieldCompanyKey = "share_field_company"
  private static let fieldEmailKey = "share_field_email"
  private static let fieldPhoneKey = "share_field_phone"
  private static let fieldProfileImageKey = "share_field_profileImage"
  private static let fieldSocialNetworksKey = "share_field_socialNetworks"
  private static let fieldSkillsKey = "share_field_skills"
  private static let proofHumanKey = "share_proof_is_human"
  private static let proofAgeOver18Key = "share_proof_age_over_18"

  static var enabledFields: Set<BusinessCardField> {
    var fields: Set<BusinessCardField> = [.name]
    if UserDefaults.standard.bool(forKey: fieldTitleKey) { fields.insert(.title) }
    if UserDefaults.standard.bool(forKey: fieldCompanyKey) { fields.insert(.company) }
    if UserDefaults.standard.bool(forKey: fieldEmailKey) { fields.insert(.email) }
    if UserDefaults.standard.bool(forKey: fieldPhoneKey) { fields.insert(.phone) }
    if UserDefaults.standard.bool(forKey: fieldProfileImageKey) { fields.insert(.profileImage) }
    if UserDefaults.standard.bool(forKey: fieldSocialNetworksKey) { fields.insert(.socialNetworks) }
    if UserDefaults.standard.bool(forKey: fieldSkillsKey) { fields.insert(.skills) }
    return fields
  }

  /// User's intent to declare "is_human" in their shared card. Honest read
  /// of the toggle — does NOT imply the holder actually has the claim.
  /// Issuer (VCService.issueBusinessCardCredential) intersects this with
  /// VerifiedClaimIndex.proofClaimTypesSync(forHolder:) so a toggle without
  /// a backing ProvableClaim never enters a signed VC. ShareSettingsView
  /// enforces "on when hasHumanClaim" via enforceMandatoryProofs().
  static var shareIsHuman: Bool {
    UserDefaults.standard.bool(forKey: proofHumanKey)
  }

  static var shareAgeOver18: Bool {
    UserDefaults.standard.bool(forKey: proofAgeOver18Key)
  }

  /// User-selected proof claims. May include claims the holder does not
  /// actually own — VCService filters against VerifiedClaimIndex before
  /// signing. Callers that need the *effective* declared claims should ask
  /// VCService, not this store.
  static var selectedProofClaims: [String] {
    var claims: [String] = []
    if shareIsHuman { claims.append("is_human") }
    if shareAgeOver18 { claims.append("age_over_18") }
    return claims
  }

  static func applyFields(to card: BusinessCard, level _: SharingLevel) -> BusinessCard {
    var configured = card
    let fields = enabledFields
    // Keep all legacy levels synchronized so field toggles remain the source of truth.
    configured.sharingPreferences.publicFields = fields
    configured.sharingPreferences.professionalFields = fields
    configured.sharingPreferences.personalFields = fields
    return configured
  }
}
