//
//  GroupInviteSignerTests.swift
//  solidarityTests
//
//  Regression coverage for the trust binding between a `GroupInvitePayload`
//  signature and a previously-exchanged contact key. Without this binding the
//  signature is tautological — any peer can mint a fresh keypair and sign
//  with it — so every `GroupInviteSigner.knownContact(matchingPublicKey:)`
//  hit must require a real prior card exchange.
//

import CryptoKit
import Foundation
import XCTest
@testable import solidarity

@MainActor
final class GroupInviteSignerTests: XCTestCase {
  private var contactRepository: ContactRepository!

  override func setUp() async throws {
    try await super.setUp()
    contactRepository = ContactRepository.shared
    purgeAllContacts()
  }

  override func tearDown() async throws {
    purgeAllContacts()
    try await super.tearDown()
  }

  func testKnownContactReturnsContactWhenSignPubKeyMatches() {
    let attacker = Curve25519.Signing.PrivateKey()
    let attackerPubKey = attacker.publicKey.rawRepresentation

    let card = BusinessCard(name: "Trusted Peer")
    let contact = Contact(
      businessCard: card,
      receivedAt: Date(),
      source: .proximity,
      pubKey: nil,
      signPubKey: attackerPubKey.base64EncodedString()
    )
    XCTAssertNoThrow(try storeContact(contact))

    let resolved = GroupInviteSigner.knownContact(matchingPublicKey: attackerPubKey)
    XCTAssertNotNil(resolved, "A contact whose signPubKey matches the embedded key MUST resolve.")
    XCTAssertEqual(resolved?.businessCard.name, "Trusted Peer")
  }

  func testKnownContactReturnsNilForFreshAttackerKey() {
    // Simulate the original tautological flaw: an attacker generates a
    // brand-new keypair, signs an invite with it, and embeds the public key
    // in the payload. With no prior card exchange this key has never been
    // stored, so the lookup MUST return nil — even though the signature
    // would mathematically verify against the embedded key.
    let attacker = Curve25519.Signing.PrivateKey()
    let attackerPubKey = attacker.publicKey.rawRepresentation

    let resolved = GroupInviteSigner.knownContact(matchingPublicKey: attackerPubKey)
    XCTAssertNil(resolved, "An invite key that was never persisted from a prior exchange must not resolve.")
  }

  func testKnownContactDoesNotMatchOnEncryptionKey() {
    // Trust anchor is signPubKey (Ed25519 identity) ONLY. A contact whose
    // pubKey (X25519 encryption) collides with the queried bytes must NOT
    // resolve, otherwise an attacker who learns a contact's encryption key
    // could impersonate them on group invites.
    let attacker = Curve25519.Signing.PrivateKey()
    let attackerPubKey = attacker.publicKey.rawRepresentation

    let card = BusinessCard(name: "Encryption Only")
    let contact = Contact(
      businessCard: card,
      receivedAt: Date(),
      source: .proximity,
      pubKey: attackerPubKey.base64EncodedString(),
      signPubKey: nil  // no identity key bound
    )
    XCTAssertNoThrow(try storeContact(contact))

    let resolved = GroupInviteSigner.knownContact(matchingPublicKey: attackerPubKey)
    XCTAssertNil(
      resolved,
      "Encryption key collision must not satisfy the identity-key trust anchor."
    )
  }

  // MARK: - Helpers

  private func purgeAllContacts() {
    if case .success(let contacts) = contactRepository.getAllContacts() {
      for contact in contacts {
        _ = contactRepository.deleteContact(id: contact.id)
      }
    }
  }

  private func storeContact(_ contact: Contact) throws {
    if case .failure(let error) = contactRepository.addContact(contact) {
      // setUp purges everything so duplicate-merge should not trigger here;
      // surface the failure rather than silently masking it.
      throw error
    }
  }
}
