//
//  ShareLinkManager.swift
//  airmeishi
//
//  Share link management with rate limiting and expiration controls
//

import Combine
import Foundation

/// Manages one-time sharing links with rate limiting and usage tracking
class ShareLinkManager: ObservableObject {
  static let shared = ShareLinkManager()

  @Published private(set) var activeLinks: [ShareLink] = []
  @Published private(set) var isLoading = false
  @Published private(set) var lastError: CardError?

  private let storageKey = "active_share_links"
  private let maxLinksPerCard = 5
  private let defaultExpirationHours = 24

  private init() {
    loadActiveLinks()
  }

  // MARK: - Public Methods

  /// Create a new sharing link with rate limiting
  func createShareLink(
    for businessCard: BusinessCard,
    sharingLevel: SharingLevel,
    maxUses: Int = 1,
    expirationHours: Int? = nil
  ) -> CardResult<ShareLink> {
    // Check rate limiting
    let existingLinksForCard = activeLinks.filter { $0.businessCardId == businessCard.id }

    if existingLinksForCard.count >= maxLinksPerCard {
      return .failure(.sharingError("Maximum number of active links reached for this card"))
    }

    // Clean up expired links first
    cleanupExpiredLinks()

    // Create new share link
    let expirationDate = Date()
      .addingTimeInterval(
        TimeInterval((expirationHours ?? defaultExpirationHours) * 60 * 60)
      )

    let shareLink = ShareLink(
      id: UUID(),
      businessCardId: businessCard.id,
      businessCard: businessCard.filteredCard(for: sharingLevel),
      sharingLevel: sharingLevel,
      maxUses: maxUses,
      currentUses: 0,
      createdAt: Date(),
      expirationDate: expirationDate,
      isActive: true
    )

    // Add to active links
    activeLinks.append(shareLink)

    // Save to storage
    let saveResult = saveActiveLinks()

    switch saveResult {
    case .success:
      return .success(shareLink)
    case .failure(let error):
      // Rollback on failure
      activeLinks.removeAll { $0.id == shareLink.id }
      return .failure(error)
    }
  }

  /// Retrieve business card from share link
  func retrieveBusinessCard(from linkId: UUID) -> CardResult<BusinessCard> {
    guard let shareLink = activeLinks.first(where: { $0.id == linkId }) else {
      return .failure(.notFound("Share link not found"))
    }

    // Check if link is still active
    if !shareLink.isActive {
      return .failure(.sharingError("Share link has been deactivated"))
    }

    // Check expiration
    if shareLink.expirationDate < Date() {
      // Deactivate expired link
      _ = deactivateLink(linkId)
      return .failure(.sharingError("Share link has expired"))
    }

    // Check usage limits
    if shareLink.currentUses >= shareLink.maxUses {
      // Deactivate used up link
      _ = deactivateLink(linkId)
      return .failure(.sharingError("Share link has reached maximum uses"))
    }

    // Increment usage count
    let incrementResult = incrementLinkUsage(linkId)

    switch incrementResult {
    case .success:
      return .success(shareLink.businessCard)
    case .failure(let error):
      return .failure(error)
    }
  }

  /// Deactivate a specific share link
  func deactivateLink(_ linkId: UUID) -> CardResult<Void> {
    guard let index = activeLinks.firstIndex(where: { $0.id == linkId }) else {
      return .failure(.notFound("Share link not found"))
    }

    activeLinks[index].isActive = false

    return saveActiveLinks()
  }

  /// Deactivate all links for a specific business card
  func deactivateAllLinks(for businessCardId: UUID) -> CardResult<Void> {
    for index in activeLinks.indices where activeLinks[index].businessCardId == businessCardId {
      activeLinks[index].isActive = false
    }

    return saveActiveLinks()
  }

  /// Get active links for a specific business card
  func getActiveLinks(for businessCardId: UUID) -> [ShareLink] {
    return activeLinks.filter {
      $0.businessCardId == businessCardId && $0.isActive && $0.expirationDate > Date()
    }
  }

  /// Get link statistics
  func getLinkStatistics(for businessCardId: UUID) -> ShareLinkStatistics {
    let cardLinks = activeLinks.filter { $0.businessCardId == businessCardId }

    let activeCount = cardLinks.filter { $0.isActive && $0.expirationDate > Date() }.count
    let expiredCount = cardLinks.filter { $0.expirationDate <= Date() }.count
    let totalUses = cardLinks.reduce(0) { $0 + $1.currentUses }
    let maxPossibleUses = cardLinks.reduce(0) { $0 + $1.maxUses }

    return ShareLinkStatistics(
      totalLinks: cardLinks.count,
      activeLinks: activeCount,
      expiredLinks: expiredCount,
      totalUses: totalUses,
      maxPossibleUses: maxPossibleUses,
      lastCreated: cardLinks.map { $0.createdAt }.max()
    )
  }

  /// Clean up expired and inactive links
  func cleanupExpiredLinks() {
    let now = Date()
    let originalCount = activeLinks.count

    activeLinks.removeAll { link in
      !link.isActive || link.expirationDate < now || link.currentUses >= link.maxUses
    }

    if activeLinks.count != originalCount {
      _ = saveActiveLinks()
    }
  }

  /// Generate shareable URL for a link
  func generateShareURL(for shareLink: ShareLink) -> String {
    let baseURL = "https://airmeishi.app/share"  // Your actual domain
    return "\(baseURL)/\(shareLink.id.uuidString)"
  }

  // MARK: - Private Methods

  /// Increment usage count for a share link
  private func incrementLinkUsage(_ linkId: UUID) -> CardResult<Void> {
    guard let index = activeLinks.firstIndex(where: { $0.id == linkId }) else {
      return .failure(.notFound("Share link not found"))
    }

    activeLinks[index].currentUses += 1

    // Deactivate if max uses reached
    if activeLinks[index].currentUses >= activeLinks[index].maxUses {
      activeLinks[index].isActive = false
    }

    return saveActiveLinks()
  }

  /// Load active links from storage
  private func loadActiveLinks() {
    isLoading = true
    lastError = nil

    guard let data = UserDefaults.standard.data(forKey: storageKey) else {
      // No stored links, start with empty array
      activeLinks = []
      isLoading = false
      return
    }

    do {
      let decoder = JSONDecoder()
      activeLinks = try decoder.decode([ShareLink].self, from: data)

      // Clean up expired links on load
      cleanupExpiredLinks()

    } catch {
      lastError = .storageError("Failed to load share links: \(error.localizedDescription)")
      activeLinks = []
    }

    isLoading = false
  }

  /// Save active links to storage
  private func saveActiveLinks() -> CardResult<Void> {
    do {
      let encoder = JSONEncoder()
      let data = try encoder.encode(activeLinks)
      UserDefaults.standard.set(data, forKey: storageKey)
      return .success(())
    } catch {
      return .failure(.storageError("Failed to save share links: \(error.localizedDescription)"))
    }
  }
}

// MARK: - Supporting Models

/// Share link data structure
struct ShareLink: Codable, Identifiable {
  let id: UUID
  let businessCardId: UUID
  let businessCard: BusinessCard
  let sharingLevel: SharingLevel
  let maxUses: Int
  var currentUses: Int
  let createdAt: Date
  let expirationDate: Date
  var isActive: Bool

  /// Check if link is currently usable
  var isUsable: Bool {
    return isActive && expirationDate > Date() && currentUses < maxUses
  }

  /// Get remaining uses
  var remainingUses: Int {
    return max(0, maxUses - currentUses)
  }

  /// Get time until expiration
  var timeUntilExpiration: TimeInterval {
    return expirationDate.timeIntervalSinceNow
  }
}

/// Statistics for share links
struct ShareLinkStatistics {
  let totalLinks: Int
  let activeLinks: Int
  let expiredLinks: Int
  let totalUses: Int
  let maxPossibleUses: Int
  let lastCreated: Date?

  /// Usage rate as percentage
  var usageRate: Double {
    guard maxPossibleUses > 0 else { return 0 }
    return Double(totalUses) / Double(maxPossibleUses) * 100
  }
}
