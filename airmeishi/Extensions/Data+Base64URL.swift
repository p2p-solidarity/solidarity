//
//  Data+Base64URL.swift
//  airmeishi
//
//  Lightweight helper for RFC 7515 URL-safe base64 encoding.
//

import Foundation

extension Data {
    /// Base64 URL-safe encoding without padding.
    func base64URLEncodedString() -> String {
        return base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }

    /// Initialize from a Base64 URL-safe encoded string.
    init?(base64URLEncoded string: String) {
        var base64 = string
            .replacingOccurrences(of: "-", with: "+")
            .replacingOccurrences(of: "_", with: "/")

        let padding = 4 - (base64.count % 4)
        if padding < 4 {
            base64.append(String(repeating: "=", count: padding))
        }

        self.init(base64Encoded: base64)
    }
}

