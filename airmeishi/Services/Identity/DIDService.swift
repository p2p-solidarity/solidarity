//
//  DIDService.swift
//  airmeishi
//
//  DID derivation utilities backed by SpruceKit.
//

import Foundation
import LocalAuthentication
import SpruceIDMobileSdkRs

/// Provides helper functions to derive DID identifiers and documents from the local key material.
final class DIDService {
    private let keychain: KeychainService
    private let didKeyUtils: DidMethodUtils
    private let verificationMethodFragment: String

    init(
        keychain: KeychainService = .shared,
        verificationMethodFragment: String = "keys-1"
    ) {
        self.keychain = keychain
        self.didKeyUtils = DidMethodUtils(method: .key)
        self.verificationMethodFragment = verificationMethodFragment
    }

    // MARK: - DID:key

    /// Returns the descriptor (DID, verification method ID, JWK) for the current did:key identity.
    func currentDidKey(context: LAContext? = nil) -> CardResult<DIDDescriptor> {
        // First ensure the signing key exists
        switch keychain.ensureSigningKey() {
        case .failure(let error):
            print("[DIDService] Failed to ensure signing key: \(error)")
            return .failure(error)
        case .success:
            break
        }
        
        switch keychain.publicJwk(context: context) {
        case .failure(let error):
            print("[DIDService] Failed to get public JWK: \(error)")
            
            // If we get "empty result" error, the key might be corrupted, try resetting it
            if error.localizedDescription.contains("empty result") {
                print("[DIDService] Key seems corrupted, attempting reset...")
                switch keychain.resetSigningKey() {
                case .failure(let resetError):
                    print("[DIDService] Failed to reset key: \(resetError)")
                    return .failure(resetError)
                case .success:
                    // Try again after reset
                    switch keychain.publicJwk(context: context) {
                    case .failure(let retryError):
                        print("[DIDService] Still failed after reset: \(retryError)")
                        return .failure(retryError)
                    case .success(let jwk):
                        do {
                            let did = try didKeyUtils.didFromJwk(jwk: try jwk.jsonString())
                            print("[DIDService] Successfully derived DID after reset: \(did)")
                            return .success(descriptor(for: did, jwk: jwk))
                        } catch {
                            print("[DIDService] Failed to derive did:key after reset: \(error)")
                            return .failure(.keyManagementError("Failed to derive did:key: \(error.localizedDescription)"))
                        }
                    }
                }
            }
            
            return .failure(error)
        case .success(let jwk):
            do {
                let did = try didKeyUtils.didFromJwk(jwk: try jwk.jsonString())
                print("[DIDService] Successfully derived DID: \(did)")
                return .success(descriptor(for: did, jwk: jwk))
            } catch {
                print("[DIDService] Failed to derive did:key: \(error)")
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
            return .success(document(for: descriptor, services: services))
        }
    }

    // MARK: - DID:web

    /// Produces a DID Document for did:web by combining the local key with the supplied domain/path.
    func didWebDocument(
        domain: String,
        pathComponents: [String],
        services: [DIDServiceEndpoint] = [],
        context: LAContext? = nil
    ) -> CardResult<DIDDocument> {
        switch keychain.publicJwk(context: context) {
        case .failure(let error):
            return .failure(error)
        case .success(let jwk):
            let didWeb = makeDidWebIdentifier(domain: domain, pathComponents: pathComponents)
            let descriptor = descriptor(for: didWeb, jwk: jwk)
            return .success(document(for: descriptor, services: services))
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

    private func document(for descriptor: DIDDescriptor, services: [DIDServiceEndpoint]) -> DIDDocument {
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
        let sanitizedPath = pathComponents
            .filter { !$0.isEmpty }
            .map(sanitizePathComponent)
        let joined = ([sanitizedDomain] + sanitizedPath).joined(separator: ":")
        return "did:web:\(joined)"
    }

    private func sanitizeDomain(_ domain: String) -> String {
        var cleaned = domain
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

