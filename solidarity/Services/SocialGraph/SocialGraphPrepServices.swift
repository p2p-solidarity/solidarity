import CryptoKit
import Foundation

struct GraphIntersectionHandshake: Codable {
  let version: Int
  let nonce: String
  let hashedContacts: [String]
  let createdAt: Date
}

@MainActor
final class SocialGraphIntersectionService {
  static let shared = SocialGraphIntersectionService()
  private init() {}

  func createHandshake() -> GraphIntersectionHandshake {
    let nonce = UUID().uuidString
    let hashed = IdentityDataStore.shared.contacts.map { contact in
      hashValue("\(contact.name.lowercased())|\(nonce)")
    }
    return GraphIntersectionHandshake(
      version: 1,
      nonce: nonce,
      hashedContacts: hashed,
      createdAt: Date()
    )
  }

  func intersect(with remote: GraphIntersectionHandshake) -> [ContactEntity] {
    let local = IdentityDataStore.shared.contacts
    let remoteSet = Set(remote.hashedContacts)
    return local.filter { contact in
      let hash = hashValue("\(contact.name.lowercased())|\(remote.nonce)")
      return remoteSet.contains(hash)
    }
  }

  private func hashValue(_ raw: String) -> String {
    let digest = SHA256.hash(data: Data(raw.utf8))
    return digest.map { String(format: "%02x", $0) }.joined()
  }
}

@MainActor
final class SocialGraphExportService {
  static let shared = SocialGraphExportService()
  private init() {}

  func exportGraphJSON() -> CardResult<URL> {
    let contacts = IdentityDataStore.shared.contacts
    let payload: [String: Any] = [
      "version": 1,
      "exported_at": ISO8601DateFormatter().string(from: Date()),
      "edges": contacts.map { contact in
        [
          "id": contact.id,
          "name": contact.name,
          "verification": contact.verificationStatus,
          "exchange_timestamp": contact.exchangeTimestamp?.timeIntervalSince1970 as Any,
          "graph_edge_id": contact.graphExportEdgeId ?? "",
          "my_signature": contact.myExchangeSignature?.base64EncodedString() ?? "",
          "their_signature": contact.exchangeSignature?.base64EncodedString() ?? "",
          "my_message": contact.myEphemeralMessage ?? "",
          "their_message": contact.theirEphemeralMessage ?? "",
        ]
      },
    ]

    do {
      let data = try JSONSerialization.data(withJSONObject: payload, options: [.prettyPrinted, .sortedKeys])
      let fileURL = FileManager.default.temporaryDirectory.appendingPathComponent(
        "solidarity_graph_\(Int(Date().timeIntervalSince1970)).json"
      )
      try data.write(to: fileURL, options: [.atomic])
      return .success(fileURL)
    } catch {
      return .failure(.storageError("Failed to export graph: \(error.localizedDescription)"))
    }
  }

  func buildGraphCredentialReference() -> CardResult<String> {
    let exportResult = exportGraphJSON()
    switch exportResult {
    case .failure(let error):
      return .failure(error)
    case .success(let fileURL):
      let reference = "graph://\(fileURL.lastPathComponent)"
      return .success(reference)
    }
  }
}
