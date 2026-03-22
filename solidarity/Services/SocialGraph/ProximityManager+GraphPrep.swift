import Foundation

extension ProximityManager {
  @MainActor
  func createCommonFriendsHandshakePayload() -> GraphIntersectionHandshake {
    SocialGraphIntersectionService.shared.createHandshake()
  }

  @MainActor
  func intersectCommonFriends(with remote: GraphIntersectionHandshake) -> [ContactEntity] {
    SocialGraphIntersectionService.shared.intersect(with: remote)
  }
}
