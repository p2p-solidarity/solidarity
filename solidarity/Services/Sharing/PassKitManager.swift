//
//  PassKitManager.swift
//  solidarity
//
//  Apple Wallet pass generation and management service with PassKit integration
//
//  Uses server-side signing API at https://bussiness-card.kidneyweakx.com/sign-pass
//  for production-ready PKCS#7 signature generation.
//
//  Update passTypeIdentifier and teamIdentifier below with your Apple Developer account details.
//

import Foundation
import PassKit

/// Manages Apple Wallet pass generation, updates, and revocation
class PassKitManager: NSObject, ObservableObject {
  static let shared = PassKitManager()

  @Published var isGeneratingPass = false
  @Published var lastGeneratedPass: PKPass?
  @Published var passError: CardError?

  // IMPORTANT: Update these with your Apple Developer account details
  let passTypeIdentifier = "pass.kidneyweakx.airmeishi.businesscard"
  let teamIdentifier = "538MCM44UX"
  let organizationName = "Solid(ar)ity"

  private override init() {
    super.init()
  }

  // MARK: - Pass Generation

  /// Generate Apple Wallet pass for business card
  ///
  /// Creates a properly structured .pkpass file with:
  /// - pass.json (pass content)
  /// - manifest.json (SHA-1 checksums)
  /// - signature (PKCS#7 detached signature - requires certificate)
  /// - logo.png, icon.png (images)
  ///
  /// NOTE: Signature will be a placeholder if no certificate is configured.
  /// The pass will generate successfully but Apple Wallet may reject it without proper signing.
  func generatePass(
    for businessCard: BusinessCard,
    sharingLevel: SharingLevel = .professional
  ) -> CardResult<Data> {
    isGeneratingPass = true
    passError = nil

    defer {
      isGeneratingPass = false
    }

    // Create pass data structure
    let passData = createPassData(for: businessCard, sharingLevel: sharingLevel)

    // Create pass bundle as ZIP archive
    return createPassBundle(passData: passData, businessCard: businessCard)
  }

  /// Add pass to Apple Wallet
  func addPassToWallet(_ passData: Data) -> CardResult<Void> {
    do {
      let pass = try PKPass(data: passData)

      guard PKPassLibrary.isPassLibraryAvailable() else {
        return .failure(.passGenerationError("Pass Library not available"))
      }

      let passLibrary = PKPassLibrary()

      if passLibrary.containsPass(pass) {
        return .failure(.passGenerationError("Pass already exists in Wallet"))
      }

      // Store the pass for presentation
      DispatchQueue.main.async {
        self.lastGeneratedPass = pass
      }

      return .success(())

    } catch {
      return .failure(.passGenerationError("Failed to create pass: \(error.localizedDescription)"))
    }
  }

  /// Update existing pass in Wallet
  func updatePass(
    passSerial: String,
    businessCard: BusinessCard,
    sharingLevel: SharingLevel
  ) -> CardResult<Data> {
    // Generate new pass data with updated information
    return generatePass(for: businessCard, sharingLevel: sharingLevel)
  }

  /// Revoke pass by updating server-side status
  func revokePass(passSerial: String) -> CardResult<Void> {
    // In a serverless implementation, we can't truly "revoke" a pass
    // Users would need to manually delete it from Wallet

    let revocationData = PassRevocation(
      passSerial: passSerial,
      revokedAt: Date(),
      reason: "User revoked access"
    )

    // Store revocation locally
    return storePassRevocation(revocationData)
  }

  /// Store pass revocation data
  private func storePassRevocation(_ revocation: PassRevocation) -> CardResult<Void> {
    let encoder = JSONEncoder()

    do {
      let data = try encoder.encode(revocation)
      UserDefaults.standard.set(data, forKey: "revocation_\(revocation.passSerial)")
      return .success(())
    } catch {
      return .failure(.storageError("Failed to store revocation: \(error.localizedDescription)"))
    }
  }
}

// MARK: - Supporting Models

/// Pass revocation data structure
struct PassRevocation: Codable {
  let passSerial: String
  let revokedAt: Date
  let reason: String
}

// MARK: - Public Helper (Import String)

extension PassKitManager {
  /// Generate a simple import URL string that contains the name and job title.
  /// Example: solidarity://contact?name=John%20Doe&job=Engineer
  func generateImportString(for businessCard: BusinessCard, sharingLevel: SharingLevel) -> String {
    let filtered = businessCard.filteredCard(for: sharingLevel)
    var components = URLComponents()
    components.scheme = AppBranding.currentScheme
    components.host = "contact"

    var queryItems: [URLQueryItem] = [
      URLQueryItem(name: "name", value: filtered.name),
      URLQueryItem(name: "job", value: filtered.title ?? ""),
    ]

    switch DIDService().currentDidKey() {
    case .success(let didDescriptor):
      queryItems.append(URLQueryItem(name: "did", value: didDescriptor.did))
    case .failure:
      break
    }

    components.queryItems = queryItems

    return components.url?.absoluteString
      ?? AppBranding.contactURL(
        name: urlEncode(filtered.name),
        job: urlEncode(filtered.title ?? "")
      )
  }

  private func urlEncode(_ value: String) -> String {
    let allowed = CharacterSet(charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_.~")
    return value.addingPercentEncoding(withAllowedCharacters: allowed) ?? value
  }
}
