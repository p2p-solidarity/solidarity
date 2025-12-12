//
//  AirDropManager.swift
//  airmeishi
//
//  Manages AirDrop integration for sharing business cards and Apple Wallet passes
//

import Foundation
import UIKit
import PassKit

/// Protocol for AirDrop sharing operations
protocol AirDropManagerProtocol {
    func shareBusinessCard(_ card: BusinessCard, sharingLevel: SharingLevel, from viewController: UIViewController)
    func shareWalletPass(_ passData: Data, from viewController: UIViewController)
    func shareQRCode(_ qrCodeImage: UIImage, card: BusinessCard, from viewController: UIViewController)
    func canShareViaAirDrop() -> Bool
}

/// Manages AirDrop integration for sharing business cards and passes
class AirDropManager: AirDropManagerProtocol, ObservableObject {
    static let shared = AirDropManager()
    
    @Published private(set) var isSharing = false
    @Published private(set) var lastError: CardError?
    
    private let passKitManager = PassKitManager.shared
    private let qrCodeManager = QRCodeManager.shared
    
    private init() {}
    
    // MARK: - Public Methods
    
    /// Share a business card via AirDrop as a vCard file
    func shareBusinessCard(_ card: BusinessCard, sharingLevel: SharingLevel, from viewController: UIViewController) {
        guard canShareViaAirDrop() else {
            lastError = .sharingError("AirDrop is not available")
            return
        }
        
        isSharing = true
        
        // Filter card based on sharing level
        let filteredCard = card.filteredCard(for: sharingLevel)
        
        // Create vCard data
        let vCardData = createVCardData(for: filteredCard)
        
        // Create temporary file
        let tempURL = createTemporaryFile(with: vCardData, filename: "\(filteredCard.name).vcf")
        
        // Create activity items
        var activityItems: [Any] = [tempURL]
        
        // Add business card JSON for apps that can handle it
        do {
            let cardJSON = try JSONEncoder().encode(filteredCard)
            activityItems.append(cardJSON)
        } catch {
            print("Failed to encode card JSON: \(error)")
            // Continue without JSON data
        }
        
        // Create activity view controller
        let activityVC = UIActivityViewController(
            activityItems: activityItems,
            applicationActivities: nil
        )
        
        // Configure for AirDrop
        activityVC.excludedActivityTypes = [
            .assignToContact, // We'll handle contact creation ourselves
            .saveToCameraRoll,
            .postToFacebook,
            .postToTwitter,
            .postToWeibo,
            .postToVimeo,
            .postToTencentWeibo,
            .postToFlickr
        ]
        
        // Set completion handler
        activityVC.completionWithItemsHandler = { [weak self] activityType, completed, _, error in
            DispatchQueue.main.async {
                self?.isSharing = false
                
                if let error = error {
                    self?.lastError = .sharingError("AirDrop failed: \(error.localizedDescription)")
                } else if completed {
                    print("Business card shared successfully via \(activityType?.rawValue ?? "unknown")")
                }
                
                // Clean up temporary file
                try? FileManager.default.removeItem(at: tempURL)
            }
        }
        
        // Present activity view controller
        if let popover = activityVC.popoverPresentationController {
            popover.sourceView = viewController.view
            popover.sourceRect = CGRect(x: viewController.view.bounds.midX, y: viewController.view.bounds.midY, width: 0, height: 0)
            popover.permittedArrowDirections = []
        }
        
        viewController.present(activityVC, animated: true)
    }
    
    /// Share an Apple Wallet pass via AirDrop
    func shareWalletPass(_ passData: Data, from viewController: UIViewController) {
        guard canShareViaAirDrop() else {
            lastError = .sharingError("AirDrop is not available")
            return
        }
        
        isSharing = true
        
        // Create temporary .pkpass file
        let tempURL = createTemporaryFile(with: passData, filename: "BusinessCard.pkpass")
        
        // Create activity view controller
        let activityVC = UIActivityViewController(
            activityItems: [tempURL],
            applicationActivities: nil
        )
        
        // Configure for pass sharing
        activityVC.excludedActivityTypes = [
            .assignToContact,
            .saveToCameraRoll,
            .postToFacebook,
            .postToTwitter,
            .postToWeibo,
            .postToVimeo,
            .postToTencentWeibo,
            .postToFlickr
        ]
        
        // Set completion handler
        activityVC.completionWithItemsHandler = { [weak self] activityType, completed, _, error in
            DispatchQueue.main.async {
                self?.isSharing = false
                
                if let error = error {
                    self?.lastError = .sharingError("Pass sharing failed: \(error.localizedDescription)")
                } else if completed {
                    print("Wallet pass shared successfully via \(activityType?.rawValue ?? "unknown")")
                }
                
                // Clean up temporary file
                try? FileManager.default.removeItem(at: tempURL)
            }
        }
        
        // Present activity view controller
        if let popover = activityVC.popoverPresentationController {
            popover.sourceView = viewController.view
            popover.sourceRect = CGRect(x: viewController.view.bounds.midX, y: viewController.view.bounds.midY, width: 0, height: 0)
            popover.permittedArrowDirections = []
        }
        
        viewController.present(activityVC, animated: true)
    }
    
    /// Share a QR code image with business card context
    func shareQRCode(_ qrCodeImage: UIImage, card: BusinessCard, from viewController: UIViewController) {
        guard canShareViaAirDrop() else {
            lastError = .sharingError("AirDrop is not available")
            return
        }
        
        isSharing = true
        
        // Create share text
        let shareText = "Business Card: \(card.name)"
        let activityItems: [Any] = [qrCodeImage, shareText]
        
        // Create activity view controller
        let activityVC = UIActivityViewController(
            activityItems: activityItems,
            applicationActivities: nil
        )
        
        // Set completion handler
        activityVC.completionWithItemsHandler = { [weak self] activityType, completed, _, error in
            DispatchQueue.main.async {
                self?.isSharing = false
                
                if let error = error {
                    self?.lastError = .sharingError("QR code sharing failed: \(error.localizedDescription)")
                } else if completed {
                    print("QR code shared successfully via \(activityType?.rawValue ?? "unknown")")
                }
            }
        }
        
        // Present activity view controller
        if let popover = activityVC.popoverPresentationController {
            popover.sourceView = viewController.view
            popover.sourceRect = CGRect(x: viewController.view.bounds.midX, y: viewController.view.bounds.midY, width: 0, height: 0)
            popover.permittedArrowDirections = []
        }
        
        viewController.present(activityVC, animated: true)
    }
    
    /// Check if AirDrop is available on the device
    func canShareViaAirDrop() -> Bool {
        // AirDrop is available on iOS devices (not simulator)
        #if targetEnvironment(simulator)
        return false
        #else
        return true
        #endif
    }
    
    /// Share multiple items via AirDrop (e.g., both vCard and pass)
    func shareMultipleItems(_ items: [AirDropItem], from viewController: UIViewController) {
        guard canShareViaAirDrop() else {
            lastError = .sharingError("AirDrop is not available")
            return
        }
        
        isSharing = true
        
        var activityItems: [Any] = []
        var tempURLs: [URL] = []
        
        for item in items {
            switch item {
            case .businessCard(let card, let level):
                let filteredCard = card.filteredCard(for: level)
                let vCardData = createVCardData(for: filteredCard)
                let tempURL = createTemporaryFile(with: vCardData, filename: "\(filteredCard.name).vcf")
                activityItems.append(tempURL)
                tempURLs.append(tempURL)
                
            case .walletPass(let passData):
                let tempURL = createTemporaryFile(with: passData, filename: "BusinessCard.pkpass")
                activityItems.append(tempURL)
                tempURLs.append(tempURL)
                
            case .qrCode(let image):
                activityItems.append(image)
                
            case .text(let text):
                activityItems.append(text)
            }
        }
        
        // Create activity view controller
        let activityVC = UIActivityViewController(
            activityItems: activityItems,
            applicationActivities: nil
        )
        
        // Set completion handler
        activityVC.completionWithItemsHandler = { [weak self] activityType, completed, _, error in
            DispatchQueue.main.async {
                self?.isSharing = false
                
                if let error = error {
                    self?.lastError = .sharingError("Sharing failed: \(error.localizedDescription)")
                } else if completed {
                    print("Items shared successfully via \(activityType?.rawValue ?? "unknown")")
                }
                
                // Clean up temporary files
                for url in tempURLs {
                    try? FileManager.default.removeItem(at: url)
                }
            }
        }
        
        // Present activity view controller
        if let popover = activityVC.popoverPresentationController {
            popover.sourceView = viewController.view
            popover.sourceRect = CGRect(x: viewController.view.bounds.midX, y: viewController.view.bounds.midY, width: 0, height: 0)
            popover.permittedArrowDirections = []
        }
        
        viewController.present(activityVC, animated: true)
    }
    
    // MARK: - Private Methods
    
    /// Create vCard data from business card
    private func createVCardData(for card: BusinessCard) -> Data {
        var vCard = "BEGIN:VCARD\n"
        vCard += "VERSION:3.0\n"
        
        // Name (required)
        vCard += "FN:\(card.name)\n"
        vCard += "N:\(card.name);;;;\n"
        
        // Title and organization
        if let title = card.title, !title.isEmpty {
            vCard += "TITLE:\(title)\n"
        }
        
        if let company = card.company, !company.isEmpty {
            vCard += "ORG:\(company)\n"
        }
        
        // Contact information
        if let email = card.email, !email.isEmpty {
            vCard += "EMAIL:\(email)\n"
        }
        
        if let phone = card.phone, !phone.isEmpty {
            vCard += "TEL:\(phone)\n"
        }
        
        // Skills as notes
        if !card.skills.isEmpty {
            let skillsText = card.skills.map { "\($0.name) (\($0.proficiencyLevel.rawValue))" }.joined(separator: ", ")
            vCard += "NOTE:Skills: \(skillsText)\n"
        }
        
        // Categories
        if !card.categories.isEmpty {
            let categoriesText = card.categories.joined(separator: ",")
            vCard += "CATEGORIES:\(categoriesText)\n"
        }
        
        // Profile image (if available and small enough)
        if let imageData = card.profileImage, imageData.count < 50000 { // Limit to ~50KB
            let base64Image = imageData.base64EncodedString()
            vCard += "PHOTO;ENCODING=BASE64;TYPE=JPEG:\(base64Image)\n"
        }
        
        vCard += "END:VCARD\n"
        
        return vCard.data(using: .utf8) ?? Data()
    }
    
    /// Create a temporary file with the given data
    private func createTemporaryFile(with data: Data, filename: String) -> URL {
        let tempDir = FileManager.default.temporaryDirectory
        let tempURL = tempDir.appendingPathComponent(filename)
        
        do {
            try data.write(to: tempURL)
        } catch {
            print("Failed to write temporary file: \(error)")
        }
        
        return tempURL
    }
}

// MARK: - Supporting Types

/// Types of items that can be shared via AirDrop
enum AirDropItem {
    case businessCard(BusinessCard, SharingLevel)
    case walletPass(Data)
    case qrCode(UIImage)
    case text(String)
}
