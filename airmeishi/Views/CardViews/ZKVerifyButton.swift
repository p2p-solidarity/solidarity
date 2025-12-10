//
//  ZKVerifyButton.swift
//  airmeishi
//
//  A small reusable button to generate and verify a local SD proof
//

import SwiftUI

struct ZKVerifyButton: View {
    let businessCard: BusinessCard
    var sharingLevel: SharingLevel = .professional
    
    @State private var isVerifying = false
    @State private var verifyMessage: String?
    @State private var isValid: Bool = false
    @State private var signatureHex: String?
    
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Button(action: verifyTapped) {
                if isVerifying {
                    ProgressView()
                } else {
                    Text("Verify ZK Proof")
                }
            }
            .buttonStyle(.bordered)
            .disabled(isVerifying)
            
            if let message = verifyMessage {
                Text(message)
                    .font(.caption)
                    .foregroundColor(isValid ? .green : .red)
            }

            if let sig = signatureHex {
                VStack(alignment: .leading, spacing: 4) {
                    HStack {
                        Text("Signature").font(.caption).foregroundColor(.secondary)
                        Spacer()
                        Button {
                            #if canImport(UIKit)
                            UIPasteboard.general.string = sig
                            #endif
                        } label: { Image(systemName: "doc.on.doc").font(.caption) }
                        .buttonStyle(.plain)
                    }
                    ScrollView(.horizontal) {
                        Text(sig)
                            .font(.caption2.monospaced())
                            .textSelection(.enabled)
                    }
                }
            }
        }
        .overlay(alignment: .bottom) {
            if signatureHex != nil {
                Text("Note: Signatures include a timestamp to prevent replay attacks, so they change on every verification.")
                    .font(.system(size: 10))
                    .foregroundColor(.secondary)
                    .multilineTextAlignment(.center)
                    .padding(.top, 8)
            }
        }
    }
    
    private func verifyTapped() {
        isVerifying = true
        verifyMessage = nil
        let allowed = businessCard.sharingPreferences.fieldsForLevel(sharingLevel)
        let result = ProofGenerationManager.shared.generateSelectiveDisclosureProof(
            businessCard: businessCard,
            selectedFields: allowed,
            recipientId: nil
        )
        switch result {
        case .success(let proof):
            signatureHex = proof.signature.map { String(format: "%02x", $0) }.joined()
            let vr = ProofGenerationManager.shared.verifySelectiveDisclosureProof(
                proof,
                expectedBusinessCardId: businessCard.id.uuidString
            )
            switch vr {
            case .success(let res):
                isValid = res.isValid
                verifyMessage = res.isValid ? "Proof valid" : "Invalid: \(res.reason)"
            case .failure(let err):
                isValid = false
                verifyMessage = err.localizedDescription
            }
        case .failure(let err):
            isValid = false
            verifyMessage = err.localizedDescription
            signatureHex = nil
        }
        isVerifying = false
    }
}


