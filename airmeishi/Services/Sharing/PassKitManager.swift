//
//  PassKitManager.swift
//  airmeishi
//
//  Apple Wallet pass generation and management service with PassKit integration
//
//  Uses server-side signing API at https://bussiness-card.kidneyweakx.com/sign-pass
//  for production-ready PKCS#7 signature generation.
//
//  Update passTypeIdentifier and teamIdentifier below with your Apple Developer account details.
//

import CryptoKit
import Foundation
import PassKit
import UIKit

/// Manages Apple Wallet pass generation, updates, and revocation
class PassKitManager: NSObject, ObservableObject {
  static let shared = PassKitManager()

  @Published var isGeneratingPass = false
  @Published var lastGeneratedPass: PKPass?
  @Published var passError: CardError?

  // IMPORTANT: Update these with your Apple Developer account details
  private let passTypeIdentifier = "pass.kidneyweakx.airmeishi.businesscard"
  private let teamIdentifier = "538MCM44UX"
  private let organizationName = "Solid(ar)ity"

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

  // MARK: - Pass Data Creation

  /// Create pass.json data structure
  private func createPassData(
    for businessCard: BusinessCard,
    sharingLevel: SharingLevel
  ) -> [String: Any] {
    let filteredCard = businessCard.filteredCard(for: sharingLevel)
    let passSerial = UUID().uuidString
    let importValue = generateImportString(for: filteredCard, sharingLevel: sharingLevel)

    var passData: [String: Any] = [
      "formatVersion": 1,
      "passTypeIdentifier": passTypeIdentifier,
      "serialNumber": passSerial,
      "teamIdentifier": teamIdentifier,
      "organizationName": organizationName,
      "description": "Business Card - \(filteredCard.name)",
      "logoText": organizationName,
      "foregroundColor": "rgb(255, 255, 255)",
      "backgroundColor": "rgb(33, 150, 243)",  // Nice blue
      "labelColor": "rgb(255, 255, 255)",
    ]

    // Create generic pass structure
    var generic: [String: Any] = [:]

    // Primary fields (most prominent)
    var primaryFields: [[String: Any]] = []
    primaryFields.append([
      "key": "name",
      "label": "Name",
      "value": filteredCard.name,
    ])

    // Secondary fields
    var secondaryFields: [[String: Any]] = []
    if let title = filteredCard.title {
      secondaryFields.append([
        "key": "title",
        "label": "Title",
        "value": title,
      ])
    }
    if let company = filteredCard.company {
      secondaryFields.append([
        "key": "company",
        "label": "Company",
        "value": company,
      ])
    }

    // Auxiliary fields (smaller, bottom area)
    var auxiliaryFields: [[String: Any]] = []
    if let email = filteredCard.email {
      auxiliaryFields.append([
        "key": "email",
        "label": "Email",
        "value": email,
      ])
    }
    if let phone = filteredCard.phone {
      auxiliaryFields.append([
        "key": "phone",
        "label": "Phone",
        "value": phone,
      ])
    }

    // Back fields (detailed information on back of pass)
    var backFields: [[String: Any]] = []

    // Add all contact info on back
    if let email = filteredCard.email {
      backFields.append([
        "key": "email_back",
        "label": "Email",
        "value": email,
      ])
    }
    if let phone = filteredCard.phone {
      backFields.append([
        "key": "phone_back",
        "label": "Phone",
        "value": phone,
      ])
    }
    // Add website if BusinessCard model has it in the future
    // if let website = filteredCard.website {
    //     backFields.append([
    //         "key": "website",
    //         "label": "Website",
    //         "value": website
    //     ])
    // }

    // Add skills if available
    if !filteredCard.skills.isEmpty {
      let skillsText = filteredCard.skills.map { "\($0.name) (\($0.proficiencyLevel.rawValue))" }
        .joined(separator: ", ")
      backFields.append([
        "key": "skills",
        "label": "Skills",
        "value": skillsText,
      ])
    }

    // Add sharing level info
    backFields.append([
      "key": "sharingLevel",
      "label": "Sharing Level",
      "value": sharingLevel.displayName,
    ])

    // Add creation date
    let formatter = DateFormatter()
    formatter.dateStyle = .medium
    formatter.timeStyle = .short
    backFields.append([
      "key": "created",
      "label": "Created",
      "value": formatter.string(from: Date()),
    ])

    generic["primaryFields"] = primaryFields
    generic["secondaryFields"] = secondaryFields
    generic["auxiliaryFields"] = auxiliaryFields
    generic["backFields"] = backFields

    passData["generic"] = generic

    // Add barcode/QR code with import string
    passData["barcodes"] = [
      [
        "message": importValue,
        "format": "PKBarcodeFormatQR",
        "messageEncoding": "iso-8859-1",
      ]
    ]

    return passData
  }

  /// Create complete pass bundle with all required files
  private func createPassBundle(
    passData: [String: Any],
    businessCard: BusinessCard
  ) -> CardResult<Data> {
    do {
      // 1. Create pass.json
      let passJsonData = try JSONSerialization.data(withJSONObject: passData, options: .prettyPrinted)

      // 2. Generate images
      guard let logoData = createLogoImage().pngData(),
        let iconData = createIconImage().pngData()
      else {
        return .failure(.passGenerationError("Failed to generate pass images"))
      }

      // 3. Create manifest.json with SHA-1 checksums
      var manifest: [String: String] = [:]
      manifest["pass.json"] = sha1Hash(passJsonData)
      manifest["logo.png"] = sha1Hash(logoData)
      manifest["logo@2x.png"] = sha1Hash(logoData)
      manifest["logo@3x.png"] = sha1Hash(logoData)
      manifest["icon.png"] = sha1Hash(iconData)
      manifest["icon@2x.png"] = sha1Hash(iconData)
      manifest["icon@3x.png"] = sha1Hash(iconData)

      // Add profile image if available
      if let profileImageData = businessCard.profileImage {
        manifest["thumbnail.png"] = sha1Hash(profileImageData)
        manifest["thumbnail@2x.png"] = sha1Hash(profileImageData)
      }

      let manifestData = try JSONSerialization.data(withJSONObject: manifest, options: .prettyPrinted)

      // 4. Create signature (PKCS#7 detached signature)
      let signature = try createSignature(for: manifestData)

      // 5. Create ZIP archive (.pkpass file)
      var files: [(name: String, data: Data)] = [
        ("pass.json", passJsonData),
        ("manifest.json", manifestData),
        ("signature", signature),
        ("logo.png", logoData),
        ("logo@2x.png", logoData),
        ("logo@3x.png", logoData),
        ("icon.png", iconData),
        ("icon@2x.png", iconData),
        ("icon@3x.png", iconData),
      ]

      // Add profile image if available
      if let profileImageData = businessCard.profileImage {
        files.append(("thumbnail.png", profileImageData))
        files.append(("thumbnail@2x.png", profileImageData))
      }

      let pkpassData = try ZIPWriter.createArchive(files: files)

      return .success(pkpassData)

    } catch {
      return .failure(.passGenerationError("Failed to create pass bundle: \(error.localizedDescription)"))
    }
  }

  // MARK: - Helper Methods

  /// Calculate SHA1 hash for manifest
  private func sha1Hash(_ data: Data) -> String {
    let digest = Insecure.SHA1.hash(data: data)
    return digest.map { String(format: "%02hhx", $0) }.joined()
  }

  /// Create PKCS#7 detached signature for manifest
  ///
  /// Uses server-side signing API to generate production-ready signatures.
  /// The API handles certificate management and PKCS#7 structure creation.
  private func createSignature(for manifestData: Data) throws -> Data {
    guard let apiURL = URL(string: "https://bussiness-card.kidneyweakx.com/sign-pass") else {
      throw CardError.passGenerationError("Invalid signing API URL")
    }

    // Create request
    var request = URLRequest(url: apiURL)
    request.httpMethod = "POST"
    request.setValue("text/plain", forHTTPHeaderField: "Content-Type")
    request.httpBody = manifestData
    request.timeoutInterval = 30

    // Perform synchronous request (we're already in an async context via Result type)
    var signatureData: Data?
    var requestError: Error?

    let semaphore = DispatchSemaphore(value: 0)

    let task = URLSession.shared.dataTask(with: request) { data, response, error in
      defer { semaphore.signal() }

      if let error = error {
        requestError = error
        return
      }

      guard let httpResponse = response as? HTTPURLResponse else {
        requestError = CardError.passGenerationError("Invalid server response")
        return
      }

      guard httpResponse.statusCode == 200 else {
        let errorMessage: String
        if let data = data,
          let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
          let message = json["message"] as? String
        {
          errorMessage = "Server error: \(message)"
        } else {
          errorMessage = "Server returned status \(httpResponse.statusCode)"
        }
        requestError = CardError.passGenerationError(errorMessage)
        return
      }

      guard let data = data, !data.isEmpty else {
        requestError = CardError.passGenerationError("Empty signature response from server")
        return
      }

      signatureData = data
    }

    task.resume()
    semaphore.wait()

    if let error = requestError {
      throw error
    }

    guard let signature = signatureData else {
      throw CardError.passGenerationError("Failed to receive signature from server")
    }

    return signature
  }

  /// Create logo image for pass
  private func createLogoImage() -> UIImage {
    let size = CGSize(width: 320, height: 100)  // 160x50 @2x
    let renderer = UIGraphicsImageRenderer(size: size)

    return renderer.image { context in
      // Transparent background
      UIColor.clear.setFill()
      context.fill(CGRect(origin: .zero, size: size))

      // Draw text logo
      let text = "Solid(ar)ity"
      let attributes: [NSAttributedString.Key: Any] = [
        .font: UIFont.systemFont(ofSize: 44, weight: .bold),
        .foregroundColor: UIColor.white,
      ]

      let textSize = text.size(withAttributes: attributes)
      let textRect = CGRect(
        x: (size.width - textSize.width) / 2,
        y: (size.height - textSize.height) / 2,
        width: textSize.width,
        height: textSize.height
      )

      text.draw(in: textRect, withAttributes: attributes)
    }
  }

  /// Create icon image for pass
  private func createIconImage() -> UIImage {
    let size = CGSize(width: 87, height: 87)  // 29x29 @3x
    let renderer = UIGraphicsImageRenderer(size: size)

    return renderer.image { context in
      // Blue background
      UIColor(red: 33 / 255, green: 150 / 255, blue: 243 / 255, alpha: 1).setFill()
      context.fill(CGRect(origin: .zero, size: size))

      // Draw "S" letter
      let text = "S"
      let attributes: [NSAttributedString.Key: Any] = [
        .font: UIFont.systemFont(ofSize: 60, weight: .bold),
        .foregroundColor: UIColor.white,
      ]

      let textSize = text.size(withAttributes: attributes)
      let textRect = CGRect(
        x: (size.width - textSize.width) / 2,
        y: (size.height - textSize.height) / 2,
        width: textSize.width,
        height: textSize.height
      )

      text.draw(in: textRect, withAttributes: attributes)
    }
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
  /// Example: airmeishi://contact?name=John%20Doe&job=Engineer
  func generateImportString(for businessCard: BusinessCard, sharingLevel: SharingLevel) -> String {
    let filtered = businessCard.filteredCard(for: sharingLevel)
    var components = URLComponents()
    components.scheme = "airmeishi"
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
      ?? "airmeishi://contact?name=\(urlEncode(filtered.name))&job=\(urlEncode(filtered.title ?? ""))"
  }

  private func urlEncode(_ value: String) -> String {
    let allowed = CharacterSet(charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_.~")
    return value.addingPercentEncoding(withAllowedCharacters: allowed) ?? value
  }
}
