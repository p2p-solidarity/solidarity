import Foundation

enum AppBranding {
  static let currentScheme = "solidarity"
  static let legacyScheme = "airmeishi"

  static let currentWebHost = "solidarity.gg"
  static let legacyWebHost = "airmeishi.app"
  static let currentBaseURL = "https://\(currentWebHost)"
  static let currentAppClipURL = "\(currentBaseURL)/clip"
  static let currentShareBaseURL = "\(currentBaseURL)/share"
  static let currentAPIBaseURL = "\(currentBaseURL)/api/v1"

  static let currentProximityServiceType = "say-share"
  static let legacyProximityServiceType = "airmeishi-share"
  static let currentWebRTCDataChannelLabel = "solidarity-data"
  static let legacyWebRTCDataChannelLabel = "airmeishi-data"

  static let currentSimulatorDeviceTokenKey = "solidarity.simulator.deviceToken"
  static let legacySimulatorDeviceTokenKey = "airmeishi.simulator.deviceToken"

  static let currentEncryptionKeyTag = "com.kidneyweakx.solidarity.encryption.key"
  static let legacyEncryptionKeyTag = "com.kidneyweakx.airmeishi.encryption.key"
  static let currentEncryptionService = "solidarity"
  static let legacyEncryptionService = "airmeishi"

  static let currentSemaphoreIdentityTag = "com.kidneyweakx.solidarity.semaphore.identity"
  static let legacySemaphoreIdentityTag = "com.kidneyweakx.airmeishi.semaphore.identity"
  static let currentTrustedIssuerAnchorsKey = "solidarity.trusted_issuer_anchors.v1"
  static let legacyTrustedIssuerAnchorsKey = "airmeishi.trusted_issuer_anchors.v1"
  static let currentIdentityCacheService = "com.kidneyweakx.solidarity.identity-cache"

  static let currentLoggerSubsystem = "com.kidneyweakx.solidarity"
  static let currentStorageDirectoryName = "SolidarityStorage"
  static let legacyStorageDirectoryName = "AirmeishiStorage"
  static let currentCredentialMessagePrefix = "SOLIDARITY_VC::"
  static let legacyCredentialMessagePrefix = "AIRMEISHI_VC::"

  static let supportedBonjourServices = [
    "_\(currentProximityServiceType)._tcp.",
    "_\(currentProximityServiceType)._tcp",
    "_\(legacyProximityServiceType)._tcp.",
    "_\(legacyProximityServiceType)._tcp",
  ]

  static func isSupportedAppScheme(_ scheme: String?) -> Bool {
    switch scheme?.lowercased() {
    case currentScheme, legacyScheme:
      return true
    default:
      return false
    }
  }

  static func isSupportedDeepLink(_ rawValue: String) -> Bool {
    rawValue.hasPrefix("\(currentScheme)://") || rawValue.hasPrefix("\(legacyScheme)://")
  }

  static func inviteURL(token: String) -> String {
    "\(currentScheme)://group/join?token=\(token)"
  }

  static func contactURL(name: String, job: String) -> String {
    "\(currentScheme)://contact?name=\(name)&job=\(job)"
  }

  static func shardURL(data: String) -> String {
    "\(currentScheme)://shard?data=\(data)"
  }
}
