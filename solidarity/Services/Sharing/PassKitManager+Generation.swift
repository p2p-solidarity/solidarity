//
//  PassKitManager+Generation.swift
//  solidarity
//
//  Pass bundle generation, image creation, and signing logic
//

import CryptoKit
import Foundation
import UIKit

// MARK: - Pass Data Creation

extension PassKitManager {
    /// Create pass.json data structure
    func createPassData(
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
    func createPassBundle(
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
}

// MARK: - Helper Methods

extension PassKitManager {
    /// Calculate SHA1 hash for manifest
    func sha1Hash(_ data: Data) -> String {
        let digest = Insecure.SHA1.hash(data: data)
        return digest.map { String(format: "%02hhx", $0) }.joined()
    }

    /// Create PKCS#7 detached signature for manifest
    ///
    /// Uses server-side signing API to generate production-ready signatures.
    /// The API handles certificate management and PKCS#7 structure creation.
    func createSignature(for manifestData: Data) throws -> Data {
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
    func createLogoImage() -> UIImage {
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
    func createIconImage() -> UIImage {
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
}
