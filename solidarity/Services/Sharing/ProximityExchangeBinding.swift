//
//  ProximityExchangeBinding.swift
//  solidarity
//
//  Builds the canonical bytes that proximity exchange signatures commit to.
//  These bytes bind: protocol version, both peers' DIDs, the business card
//  hash, the ephemeral message hash, a fresh nonce, and a timestamp. Any
//  receiver MUST recompute these bytes from the same inputs and verify the
//  signature against the sender's published JWK before trusting the payload.
//

import CryptoKit
import Foundation

enum ProximityExchangeBinding {
  // MARK: - Card sharing payload

  // swiftlint:disable function_parameter_count
  /// Canonical bytes for `ProximitySharingPayload` (one-way card send).
  /// Format (newline-separated, deterministic):
  ///   v=<protocolVersion>
  ///   kind=card
  ///   shareId=<uuid>
  ///   senderDID=<did>
  ///   receiver=<peerDisplayName>
  ///   senderID=<displayName>
  ///   cardId=<uuid>
  ///   cardHash=<sha256(JSON(card))-hex>
  ///   selectedFields=<sorted-csv>
  ///   scope=<scope>
  ///   nonce=<uuid>
  ///   ts=<unix-seconds>
  static func cardCanonicalBytes(
    protocolVersion: Int,
    shareId: UUID,
    senderDID: String,
    receiverPeerName: String,
    senderID: String,
    card: BusinessCard,
    selectedFields: [BusinessCardField],
    scope: String,
    nonce: String,
    timestamp: Date
  ) -> Data {
    let lines: [String] = [
      "v=\(protocolVersion)",
      "kind=card",
      "shareId=\(shareId.uuidString)",
      "senderDID=\(senderDID)",
      "receiver=\(receiverPeerName)",
      "senderID=\(senderID)",
      "cardId=\(card.id.uuidString)",
      "cardHash=\(hashOfCard(card))",
      "selectedFields=\(canonicalFields(selectedFields))",
      "scope=\(scope)",
      "nonce=\(nonce)",
      "ts=\(Int(timestamp.timeIntervalSince1970))"
    ]
    return Data(lines.joined(separator: "\n").utf8)
  }
  // swiftlint:enable function_parameter_count

  // MARK: - Exchange request / accept

  // swiftlint:disable function_parameter_count
  /// Canonical bytes for an exchange request or accept payload. The two
  /// directions share the format so verification logic is symmetric.
  static func exchangeCanonicalBytes(
    protocolVersion: Int,
    direction: Direction,
    requestId: UUID,
    senderDID: String,
    receiverPeerName: String,
    senderID: String,
    cardPreview: BusinessCard,
    selectedFields: [BusinessCardField],
    ephemeralMessage: String?,
    nonce: String,
    timestamp: Date
  ) -> Data {
    let lines: [String] = [
      "v=\(protocolVersion)",
      "kind=\(direction.rawValue)",
      "requestId=\(requestId.uuidString)",
      "senderDID=\(senderDID)",
      "receiver=\(receiverPeerName)",
      "senderID=\(senderID)",
      "cardId=\(cardPreview.id.uuidString)",
      "cardHash=\(hashOfCard(cardPreview))",
      "selectedFields=\(canonicalFields(selectedFields))",
      "msgHash=\(hashOfMessage(ephemeralMessage))",
      "nonce=\(nonce)",
      "ts=\(Int(timestamp.timeIntervalSince1970))"
    ]
    return Data(lines.joined(separator: "\n").utf8)
  }
  // swiftlint:enable function_parameter_count

  enum Direction: String {
    case request = "exchange.request"
    case accept = "exchange.accept"
  }

  // MARK: - Helpers

  /// Stable SHA-256 over the deterministically-encoded business card JSON.
  /// We encode with `.sortedKeys` so receiver and sender produce the same
  /// bytes for the same content regardless of property order.
  private static func hashOfCard(_ card: BusinessCard) -> String {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
    encoder.dateEncodingStrategy = .iso8601
    guard let data = try? encoder.encode(card) else { return "" }
    let digest = SHA256.hash(data: data)
    return digest.map { String(format: "%02x", $0) }.joined()
  }

  /// SHA-256 of the (truncated) ephemeral message, or empty for nil/empty.
  private static func hashOfMessage(_ message: String?) -> String {
    guard let message, !message.isEmpty else { return "" }
    let truncated = String(message.prefix(140))
    guard let bytes = truncated.data(using: .utf8) else { return "" }
    let digest = SHA256.hash(data: bytes)
    return digest.map { String(format: "%02x", $0) }.joined()
  }

  /// Sorted, comma-separated rawValues so field ordering does not flip the
  /// signature even if callers reorder selectedFields between sign and verify.
  private static func canonicalFields(_ fields: [BusinessCardField]) -> String {
    fields.map(\.rawValue).sorted().joined(separator: ",")
  }
}
