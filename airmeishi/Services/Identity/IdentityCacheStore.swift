import Foundation
import Security

/// Lightweight cache backed by Keychain for DID documents and JWK material.
final class IdentityCacheStore {
    private let service = "com.kidneyweakx.airmeishi.identity-cache"
    private let documentsAccount = "did-documents"
    private let jwkAccount = "public-jwks"
    private let queue = DispatchQueue(label: "com.kidneyweakx.airmeishi.identity-cache", qos: .utility)

    func loadDocuments() -> [String: DIDDocument] {
        queue.sync {
            data(for: documentsAccount)
                .flatMap { try? JSONDecoder().decode([String: DIDDocument].self, from: $0) }
                ?? [:]
        }
    }

    func saveDocuments(_ documents: [String: DIDDocument]) {
        queue.async {
            guard let data = try? JSONEncoder().encode(documents) else { return }
            self.store(data, for: self.documentsAccount)
        }
    }

    func loadJwks() -> [String: PublicKeyJWK] {
        queue.sync {
            data(for: jwkAccount)
                .flatMap { try? JSONDecoder().decode([String: PublicKeyJWK].self, from: $0) }
                ?? [:]
        }
    }

    func saveJwks(_ jwks: [String: PublicKeyJWK]) {
        queue.async {
            guard let data = try? JSONEncoder().encode(jwks) else { return }
            self.store(data, for: self.jwkAccount)
        }
    }

    private func data(for account: String) -> Data? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne
        ]

        var result: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data = result as? Data else { return nil }
        return data
    }

    private func store(_ data: Data, for account: String) {
        var query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
            kSecValueData as String: data
        ]

        SecItemDelete(query as CFDictionary)
        let status = SecItemAdd(query as CFDictionary, nil)
        if status == errSecDuplicateItem {
            query.removeValue(forKey: kSecValueData as String)
            let attributes: [String: Any] = [kSecValueData as String: data]
            SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
        }
    }
}
