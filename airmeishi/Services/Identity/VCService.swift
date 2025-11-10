//
//  VCService.swift
//  airmeishi
//
//  Handles issuance and parsing of Verifiable Credentials using SpruceKit.
//

import Foundation
import CryptoKit
import LocalAuthentication
import SpruceIDMobileSdkRs

/// High level service for issuing and parsing Verifiable Credentials.
final class VCService {
    struct IssueOptions {
        var holderDid: String?
        var issuerDid: String?
        var expiration: Date?
        var authenticationContext: LAContext?
    }

    struct IssuedCredential {
        let jwt: String
        let header: [String: Any]
        let payload: [String: Any]
        let snapshot: BusinessCardSnapshot
        let issuedAt: Date
        let expiresAt: Date?
        let holderDid: String
        let issuerDid: String
    }

    struct ImportedCredential {
        let storedCredential: VCLibrary.StoredCredential
        let businessCard: BusinessCard
    }

    private let keychain: KeychainService
    private let didService: DIDService
    private let library: VCLibrary

    init(
        keychain: KeychainService = .shared,
        didService: DIDService = DIDService(),
        library: VCLibrary = .shared
    ) {
        self.keychain = keychain
        self.didService = didService
        self.library = library
    }

    /// Issues a self-signed business card credential as a JWT VC.
    func issueBusinessCardCredential(
        for card: BusinessCard,
        options: IssueOptions = IssueOptions()
    ) -> CardResult<IssuedCredential> {
        let context: LAContext
        if let providedContext = options.authenticationContext {
            context = providedContext
        } else {
            switch keychain.authenticationContext(reason: "Authorize business card credential issuance") {
            case .success(let generated):
                context = generated
            case .failure(let error):
                return .failure(error)
            }
        }

        let descriptorResult = didService.currentDidKey(context: context)
        guard case .success(let descriptor) = descriptorResult else {
            if case .failure(let error) = descriptorResult {
                return .failure(error)
            }
            return .failure(.keyManagementError("Failed to derive DID for credential issuance"))
        }

        let holderDid = options.holderDid ?? descriptor.did
        let issuerDid = options.issuerDid ?? descriptor.did
        let issuedAt = Date()

        let claims = BusinessCardCredentialClaims(
            card: card,
            issuerDid: issuerDid,
            holderDid: holderDid,
            issuanceDate: issuedAt,
            expirationDate: options.expiration,
            credentialId: UUID(),
            publicKeyJwk: descriptor.jwk
        )

        let signerResult = keychain.signingKey(context: context)
        guard case .success(let signingKey) = signerResult else {
            if case .failure(let error) = signerResult {
                return .failure(error)
            }
            return .failure(.keyManagementError("Unable to access signing key"))
        }

        do {
            let kid = descriptor.verificationMethodId
            let headerData = try claims.headerData(kid: kid)
            let payloadData = try claims.payloadData()

            let headerEncoded = headerData.base64URLEncodedString()
            let payloadEncoded = payloadData.base64URLEncodedString()
            let signingInput = "\(headerEncoded).\(payloadEncoded)"

            guard let signingInputData = signingInput.data(using: .utf8) else {
                return .failure(.invalidData("Failed to encode signing input"))
            }

            let signature = try signingKey.sign(payload: signingInputData).base64URLEncodedString()
            let jwt = "\(signingInput).\(signature)"

            // Validate using SpruceKit's parser to ensure compatibility
            _ = try JwtVc.newFromCompactJwsWithKey(jws: jwt, keyAlias: keychain.alias)

            let headerJSONObject = try JSONSerialization.jsonObject(with: headerData)
            guard let headerDict = headerJSONObject as? [String: Any] else {
                return .failure(.invalidData("Failed to deserialize JWT header"))
            }

            let payloadDict = try claims.payloadDictionary()

            return .success(
                IssuedCredential(
                    jwt: jwt,
                    header: headerDict,
                    payload: payloadDict,
                    snapshot: claims.snapshot,
                    issuedAt: issuedAt,
                    expiresAt: options.expiration,
                    holderDid: holderDid,
                    issuerDid: issuerDid
                )
            )
        } catch let cardError as CardError {
            return .failure(cardError)
        } catch {
            return .failure(.cryptographicError("Credential issuance failed: \(error.localizedDescription)"))
        }
    }

    /// Issues a credential and immediately stores it in the encrypted library.
    func issueAndStoreBusinessCardCredential(
        for card: BusinessCard,
        options: IssueOptions = IssueOptions(),
        status: VCLibrary.StoredCredential.Status = .verified
    ) -> CardResult<VCLibrary.StoredCredential> {
        switch issueBusinessCardCredential(for: card, options: options) {
        case .failure(let error):
            return .failure(error)
        case .success(let issuedCredential):
            return library.add(issuedCredential, status: status)
        }
    }

    /// Imports a presented credential (vp_token) and stores it locally.
    func importPresentedCredential(jwt: String) -> CardResult<ImportedCredential> {
        let decodeResult = decodeJWT(jwt)
        switch decodeResult {
        case .failure(let error):
            return .failure(error)
        case .success(let decoded):
            do {
                let envelope = try JSONDecoder().decode(BusinessCardCredentialEnvelope.self, from: decoded.payloadData)
                let businessCard = try envelope.toBusinessCard()
                let snapshot = BusinessCardSnapshot(card: businessCard)

                let issuedAt = envelope.issuedAtDate ?? Date()
                let expiresAt = envelope.expirationDate
                let issued = IssuedCredential(
                    jwt: jwt,
                    header: decoded.header,
                    payload: decoded.payload,
                    snapshot: snapshot,
                    issuedAt: issuedAt,
                    expiresAt: expiresAt,
                    holderDid: envelope.payload.sub ?? businessCard.id.uuidString,
                    issuerDid: envelope.payload.iss ?? "did:unknown"
                )

                switch library.add(issued, status: .unverified) {
                case .success(let stored):
                    return .success(ImportedCredential(storedCredential: stored, businessCard: businessCard))
                case .failure(let error):
                    return .failure(error)
                }
            } catch let cardError as CardError {
                return .failure(cardError)
            } catch {
                return .failure(.invalidData("Failed to parse credential subject: \(error.localizedDescription)"))
            }
        }
    }

    func verifyStoredCredential(_ credential: VCLibrary.StoredCredential) -> CardResult<VCLibrary.StoredCredential> {
        let components = credential.jwt.split(separator: ".")
        guard components.count == 3 else {
            return .failure(.invalidData("Malformed JWT"))
        }

        let signingInput = "\(components[0]).\(components[1])"
        guard
            let signatureData = Data(base64URLEncoded: String(components[2])),
            let signingData = signingInput.data(using: .utf8)
        else {
            return .failure(.invalidData("Invalid JWT signature encoding"))
        }

        let decodedResult = decodeJWT(credential.jwt)

        switch decodedResult {
        case .failure(let error):
            return .failure(error)
        case .success(let decoded):
            do {
                let envelope = try JSONDecoder().decode(BusinessCardCredentialEnvelope.self, from: decoded.payloadData)

                guard let publicKeyJwk = envelope.payload.vc.credentialSubject.publicKeyJwk else {
                    return .failure(.invalidData("Credential missing public key information"))
                }

                let publicKey = try publicKeyJwk.toP256PublicKey()
                let signature = try P256.Signing.ECDSASignature(rawRepresentation: signatureData)

                guard publicKey.isValidSignature(signature, for: signingData) else {
                    return storeVerificationResult(credential, status: .failed)
                }

                let now = Date()
                if let notBefore = envelope.payload.nbf {
                    let nbfDate = Date(timeIntervalSince1970: TimeInterval(notBefore))
                    if now < nbfDate {
                        return storeVerificationResult(credential, status: .failed)
                    }
                }

                if let expiration = envelope.payload.exp {
                    let expDate = Date(timeIntervalSince1970: TimeInterval(expiration))
                    if now > expDate {
                        return storeVerificationResult(credential, status: .failed)
                    }
                }

                return storeVerificationResult(credential, status: .verified)
            } catch let cardError as CardError {
                return .failure(cardError)
            } catch {
                return .failure(.invalidData("Verification failed: \(error.localizedDescription)"))
            }
        }
    }

    private func storeVerificationResult(
        _ credential: VCLibrary.StoredCredential,
        status: VCLibrary.StoredCredential.Status
    ) -> CardResult<VCLibrary.StoredCredential> {
        var updated = credential
        updated.status = status
        updated.lastVerifiedAt = Date()

        switch library.update(updated) {
        case .success:
            return .success(updated)
        case .failure(let error):
            return .failure(error)
        }
    }
}

// MARK: - JWT decoding helpers

private extension VCService {
    struct DecodedJWT {
        let header: [String: Any]
        let payload: [String: Any]
        let payloadData: Data
    }

    func decodeJWT(_ jwt: String) -> CardResult<DecodedJWT> {
        let components = jwt.split(separator: ".")
        guard components.count >= 2 else {
            return .failure(.invalidData("Malformed JWT"))
        }

        guard let headerData = Data(base64URLEncoded: String(components[0])),
              let payloadData = Data(base64URLEncoded: String(components[1]))
        else {
            return .failure(.invalidData("Failed to decode JWT segments"))
        }

        do {
            let headerJSON = try JSONSerialization.jsonObject(with: headerData, options: [])
            let payloadJSON = try JSONSerialization.jsonObject(with: payloadData, options: [])

            guard let headerDict = headerJSON as? [String: Any],
                  let payloadDict = payloadJSON as? [String: Any] else {
                return .failure(.invalidData("JWT segments are not valid JSON objects"))
            }

            return .success(DecodedJWT(header: headerDict, payload: payloadDict, payloadData: payloadData))
        } catch {
            return .failure(.invalidData("Failed to parse JWT JSON: \(error.localizedDescription)"))
        }
    }
}

// MARK: - Credential envelope parsing

private struct BusinessCardCredentialEnvelope: Decodable {
    struct Payload: Decodable {
        let iss: String?
        let sub: String?
        let iat: Int?
        let nbf: Int?
        let exp: Int?
        let vc: VerifiableCredential
    }

    struct VerifiableCredential: Decodable {
        let type: [String]
        let credentialSubject: CredentialSubject
    }

    struct CredentialSubject: Decodable {
        struct Organization: Decodable {
            let name: String?
        }

        struct Skill: Decodable {
            let name: String
            let inDefinedTermSet: String?
            let description: String?

            enum CodingKeys: String, CodingKey {
                case name
                case inDefinedTermSet
                case description
            }
        }

        struct SocialAccount: Decodable {
            let contactType: String?
            let identifier: String?
            let url: String?
        }

        struct AnimalPreference: Decodable {
            let id: String?
            let name: String?
        }

        let id: String?
        let type: [String]?
        let name: String
        let summary: String?
        let jobTitle: String?
        let worksFor: Organization?
        let email: [String]?
        let telephone: [String]?
        let image: String?
        let sameAs: [String]?
        let contactPoint: [SocialAccount]?
        let knowsAbout: [String]?
        let hasSkill: [Skill]?
        let preferredAnimal: AnimalPreference?
        let businessCardId: String?
        let updatedAt: String?
        let publicKeyJwk: PublicKeyJWK?
    }

    let payload: Payload

    var issuedAtDate: Date? {
        guard let iat = payload.iat else { return nil }
        return Date(timeIntervalSince1970: TimeInterval(iat))
    }

    var expirationDate: Date? {
        guard let exp = payload.exp else { return nil }
        return Date(timeIntervalSince1970: TimeInterval(exp))
    }

    func toBusinessCard() throws -> BusinessCard {
        let subject = payload.vc.credentialSubject
        let cardId = UUID(uuidString: subject.businessCardId ?? "") ?? UUID()
        let title = subject.jobTitle?.nilIfEmpty()
        let company = subject.worksFor?.name?.nilIfEmpty()
        let email = subject.email?.first?.nilIfEmpty()
        let phone = subject.telephone?.first?.nilIfEmpty()

        var profileImageData: Data?
        if let image = subject.image, let data = Data(dataURI: image) {
            profileImageData = data
        }

        let socialNetworks: [SocialNetwork] = subject.contactPoint?.compactMap { account in
            guard let platformName = account.contactType?.nilIfEmpty(),
                  let username = account.identifier?.nilIfEmpty()
            else { return nil }
            let platform = SocialPlatform(rawValue: platformName) ?? .other
            return SocialNetwork(
                platform: platform,
                username: username,
                url: account.url?.nilIfEmpty()
            )
        } ?? []

        let skills: [Skill] = subject.hasSkill?.compactMap { skill in
            let proficiency = ProficiencyLevel(rawValue: skill.description ?? "") ?? .intermediate
            return Skill(
                name: skill.name,
                category: skill.inDefinedTermSet ?? "General",
                proficiencyLevel: proficiency
            )
        } ?? []

        var animal: AnimalCharacter?
        if let animalId = subject.preferredAnimal?.id, let value = AnimalCharacter(rawValue: animalId) {
            animal = value
        }

        var card = BusinessCard(
            id: cardId,
            name: subject.name,
            title: title,
            company: company,
            email: email,
            phone: phone,
            profileImage: profileImageData,
            animal: animal,
            socialNetworks: socialNetworks,
            skills: skills,
            categories: subject.knowsAbout ?? [],
            sharingPreferences: SharingPreferences(),
            createdAt: issuedAtDate ?? Date(),
            updatedAt: Date()
        )

        if let summary = subject.summary, !summary.isEmpty {
            card.categories.append(summary)
        }

        return card
    }
}

