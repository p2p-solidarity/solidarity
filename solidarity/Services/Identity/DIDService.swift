//
//  DIDService.swift
//  solidarity
//
//  DID derivation utilities backed by SpruceKit.
//

import Foundation
import LocalAuthentication
import SpruceIDMobileSdkRs

/// Provides helper functions to derive DID identifiers and documents from the local key material.
final class DIDService {
  /// Supported DID methods.
  ///
  /// did:ethr was previously listed but its derivation was algorithmically
  /// broken (SHA-256 of the JWK JSON instead of keccak256 of an
  /// uncompressed secp256k1 public key), and the underlying signing keys
  /// here are P-256, not secp256k1. Rather than ship a cryptographically
  /// invalid identifier, the method has been removed.
  /// TODO: re-introduce did:ethr only after secp256k1 keys + keccak256 are
  /// available in the project (e.g. via a vetted FFI module).
  enum DIDMethod: String, CaseIterable {
    case key = "did:key"
  }

  private let keychain: KeychainService
  private let didKeyUtils: DidMethodUtils
  private let verificationMethodFragment: String
  private var currentMethod: DIDMethod = .key

  init(
    keychain: KeychainService = .shared,
    verificationMethodFragment: String = "keys-1"
  ) {
    self.keychain = keychain
    self.didKeyUtils = DidMethodUtils(method: .key)
    self.verificationMethodFragment = verificationMethodFragment
  }

  // MARK: - Method Switching

  func switchMethod(to method: DIDMethod) -> CardResult<DIDDescriptor> {
    self.currentMethod = method
    return currentDescriptor()
  }

  func currentDescriptor(context: LAContext? = nil) -> CardResult<DIDDescriptor> {
    currentDescriptor(for: nil, context: context)
  }

  func currentDescriptor(for relyingPartyDomain: String?, context: LAContext? = nil) -> CardResult<DIDDescriptor> {
    switch currentMethod {
    case .key:
      return currentDidKey(context: context, relyingPartyDomain: relyingPartyDomain)
    }
  }

  func document(for descriptor: DIDDescriptor, services: [DIDServiceEndpoint]) throws -> DIDDocument {
    // Only did:key and did:web are produced by this service; both share the
    // same JsonWebKey2020 verification method shape, so route everything
    // through documentForKey.
    return documentForKey(descriptor, services: services)
  }

  // MARK: - DID:key

  /// Returns the descriptor (DID, verification method ID, JWK) for the current did:key identity.
  func currentDidKey(context: LAContext? = nil, relyingPartyDomain: String? = nil) -> CardResult<DIDDescriptor> {
    let ensureResult: CardResult<Void>
    if let relyingPartyDomain {
      ensureResult = keychain.ensurePairwiseKey(for: relyingPartyDomain)
    } else {
      ensureResult = keychain.ensureSigningKey()
    }

    switch ensureResult {
    case .failure(let error):
      #if DEBUG
      print("[DIDService] Failed to ensure signing key: \(error)")
      #endif
      return .failure(error)
    case .success:
      break
    }

    let publicJwkResult: CardResult<PublicKeyJWK>
    if let relyingPartyDomain {
      publicJwkResult = keychain.pairwisePublicJwk(for: relyingPartyDomain, context: context)
    } else {
      publicJwkResult = keychain.publicJwk(context: context)
    }

    switch publicJwkResult {
    case .failure(let error):
      #if DEBUG
      print("[DIDService] Failed to get public JWK: \(error)")
      #endif
      return .failure(error)
    case .success(let jwk):
      do {
        let did = try didKeyUtils.didFromJwk(jwk: try jwk.jsonString())
        #if DEBUG
        print("[DIDService] Successfully derived DID: \(did)")
        #endif
        return .success(descriptor(for: did, jwk: jwk))
      } catch {
        #if DEBUG
        print("[DIDService] Failed to derive did:key: \(error)")
        #endif
        return .failure(.keyManagementError("Failed to derive did:key: \(error.localizedDescription)"))
      }
    }
  }

  /// Produces a DID Document for did:key using the locally stored signing key.
  func didKeyDocument(
    context: LAContext? = nil,
    services: [DIDServiceEndpoint] = []
  ) -> CardResult<DIDDocument> {
    switch currentDidKey(context: context) {
    case .failure(let error):
      return .failure(error)
    case .success(let descriptor):
      return .success(documentForKey(descriptor, services: services))
    }
  }

  // MARK: - DID:web

  /// Produces a DID Document for did:web by combining the local key with the supplied domain/path.
  ///
  /// TODO(security): when did:web *resolution* is implemented (fetching the
  /// remote `.well-known/did.json` for verification), the resolver MUST verify
  /// that the resolved document's `id` exactly matches the DID being resolved.
  /// Otherwise an attacker who can serve a JSON document over HTTPS at any
  /// domain could substitute their key under a different DID's identity. The
  /// check belongs in the resolver, not in this construction helper, but this
  /// note is kept here so future work doesn't lose track.
  func didWebDocument(
    domain: String,
    pathComponents: [String],
    services: [DIDServiceEndpoint] = [],
    context: LAContext? = nil
  ) -> CardResult<DIDDocument> {
    switch keychain.pairwisePublicJwk(for: domain, context: context) {
    case .failure(let error):
      return .failure(error)
    case .success(let jwk):
      let didWeb = makeDidWebIdentifier(domain: domain, pathComponents: pathComponents)
      let descriptor = descriptor(for: didWeb, jwk: jwk)
      return .success(documentForKey(descriptor, services: services))
    }
  }

  // MARK: - Document encoding

  /// Encodes the DID document to JSON data.
  func encodeDocument(_ document: DIDDocument, prettyPrinted: Bool = true) -> CardResult<Data> {
    do {
      let encoder = JSONEncoder()
      var formatting: JSONEncoder.OutputFormatting = [.sortedKeys]
      if prettyPrinted {
        formatting.insert(.prettyPrinted)
      }
      formatting.insert(.withoutEscapingSlashes)
      encoder.outputFormatting = formatting
      return .success(try encoder.encode(document))
    } catch {
      return .failure(.storageError("Failed to encode DID document: \(error.localizedDescription)"))
    }
  }

  // MARK: - Helpers

  private func descriptor(for did: String, jwk: PublicKeyJWK) -> DIDDescriptor {
    let verificationId = "\(did)#\(verificationMethodFragment)"
    return DIDDescriptor(
      did: did,
      verificationMethodId: verificationId,
      jwk: jwk
    )
  }

  private func documentForKey(_ descriptor: DIDDescriptor, services: [DIDServiceEndpoint]) -> DIDDocument {
    DIDDocument(
      context: ["https://www.w3.org/ns/did/v1"],
      id: descriptor.did,
      verificationMethod: [
        DIDDocument.VerificationMethod(
          id: descriptor.verificationMethodId,
          type: "JsonWebKey2020",
          controller: descriptor.did,
          publicKeyJwk: descriptor.jwk
        )
      ],
      authentication: [descriptor.verificationMethodId],
      assertionMethod: [descriptor.verificationMethodId],
      service: services.isEmpty ? nil : services
    )
  }

  private func makeDidWebIdentifier(domain: String, pathComponents: [String]) -> String {
    let sanitizedDomain = sanitizeDomain(domain)
    let sanitizedPath =
      pathComponents
      .filter { !$0.isEmpty }
      .map(sanitizePathComponent)
    let joined = ([sanitizedDomain] + sanitizedPath).joined(separator: ":")
    return "did:web:\(joined)"
  }

  private func sanitizeDomain(_ domain: String) -> String {
    var cleaned =
      domain
      .replacingOccurrences(of: "https://", with: "")
      .replacingOccurrences(of: "http://", with: "")
    cleaned = cleaned.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
    return cleaned.lowercased()
  }

  private func sanitizePathComponent(_ component: String) -> String {
    let trimmed = component.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
    let allowed = CharacterSet(charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~")
    return trimmed.addingPercentEncoding(withAllowedCharacters: allowed) ?? trimmed
  }
}

// MARK: - Models

/// Descriptor representing a DID and its associated verification method.
struct DIDDescriptor: Equatable {
  let did: String
  let verificationMethodId: String
  let jwk: PublicKeyJWK
}

/// Minimal DID Document structure suitable for did:key and did:web methods.
struct DIDDocument: Codable, Equatable {
  let context: [String]
  let id: String
  let verificationMethod: [VerificationMethod]
  let authentication: [String]
  let assertionMethod: [String]
  let service: [DIDServiceEndpoint]?

  enum CodingKeys: String, CodingKey {
    case context = "@context"
    case id
    case verificationMethod
    case authentication
    case assertionMethod
    case service
  }

  struct VerificationMethod: Codable, Equatable {
    let id: String
    let type: String
    let controller: String
    let publicKeyJwk: PublicKeyJWK
  }
}

/// DID document service endpoint.
struct DIDServiceEndpoint: Codable, Equatable {
  let id: String
  let type: String
  let serviceEndpoint: String
}
