import Foundation
import Testing
@testable import solidarity

struct IdentityEntitiesTests {
  @Test func testContactEntityMappingRoundTrip() async throws {
    let card = BusinessCard(
      id: UUID(),
      name: "Alice",
      title: "Engineer",
      company: "Solidarity",
      email: "alice@example.com",
      phone: "+123456789"
    )
    let legacy = Contact(
      id: UUID(),
      businessCard: card,
      source: .proximity,
      tags: ["trusted"],
      notes: "met at conference",
      verificationStatus: .verified,
      sealedRoute: "route",
      pubKey: "pub",
      signPubKey: "sign"
    )

    let entity = ContactEntity.fromLegacy(legacy)
    let restored = entity.toLegacyContact()

    #expect(restored.businessCard.name == legacy.businessCard.name)
    #expect(restored.businessCard.email == legacy.businessCard.email)
    #expect(restored.source == legacy.source)
    #expect(restored.verificationStatus == legacy.verificationStatus)
  }
}
