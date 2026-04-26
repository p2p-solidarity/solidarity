import SwiftUI

extension PassportOnboardingFlowView {

    var proofStepSection: some View {
        VStack(spacing: 48) {
            // Hero: shield icon + title + description (Figma 756:3317)
            VStack(spacing: 16) {
                Image(systemName: "checkmark.shield")
                    .font(.system(size: 48, weight: .regular))
                    .foregroundColor(Color.Theme.terminalGreen)
                    .frame(width: 64, height: 64)

                VStack(spacing: 8) {
                    Text("Create Privacy Proof")
                        .font(.system(size: 16, weight: .medium))
                        .foregroundColor(Color.Theme.textPrimary)
                        .multilineTextAlignment(.center)

                    Text("Securely generate a proof from your passport to verify your identity — without sharing raw data.")
                        .font(.system(size: 14))
                        .foregroundColor(Color.Theme.textSecondary)
                        .multilineTextAlignment(.center)
                        .lineSpacing(4)
                        .padding(.horizontal, 32)
                }
            }

            VStack(spacing: 32) {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Selective Disclosures")
                        .font(.system(size: 14))
                        .foregroundColor(Color.Theme.textPrimary)

                    VStack(spacing: 8) {
                        BulletGuaranteeRow(text: "Runs entirely on your device")
                        BulletGuaranteeRow(text: "No personal data is uploaded")
                    }
                }
                .padding(.horizontal, 16)

                if pipeline.isLoading {
                    VStack(spacing: 8) {
                        ProgressView()
                        Text(pipeline.proofProgressMessage)
                            .font(.system(size: 12))
                            .foregroundColor(Color.Theme.textTertiary)
                            .animation(.easeInOut, value: pipeline.proofProgressMessage)
                    }
                }

                if let proof = pipeline.proofResult {
                    proofResultCard(proof)
                        .padding(.horizontal, 16)
                }

                Button {
                    pipeline.generateProof()
                } label: {
                    Text("Generate Proof")
                }
                .buttonStyle(ThemedPrimaryButtonStyle())
                .disabled(pipeline.isLoading || pipeline.chipSnapshot == nil)
                .padding(.horizontal, 16)
            }
        }
        .padding(.top, 32)
    }

    func proofResultCard(_ proof: PassportProofResult) -> some View {
        let systemLabel = proofSystemLabel(proof.proofType)

        return VStack(alignment: .leading, spacing: 4) {
            HStack {
                Image(systemName: proof.generationFailed ? "exclamationmark.triangle" : "checkmark.seal.fill")
                    .foregroundColor(proof.generationFailed ? .orange : .green)
                Text(proof.generationFailed ? "Fallback (SD-JWT)" : "ZK proof ready")
                    .font(.caption.weight(.semibold))
                    .foregroundColor(proof.generationFailed ? .orange : .green)
                Spacer()
                Text(proof.trustLevel.uppercased())
                    .font(.caption2.monospaced().weight(.bold))
                    .padding(.horizontal, 6)
                    .padding(.vertical, 2)
                    .background(proof.generationFailed ? Color.orange.opacity(0.15) : Color.green.opacity(0.15))
                    .cornerRadius(4)
            }
            HStack(spacing: 4) {
                Image(systemName: systemLabel.icon)
                    .font(.caption2)
                    .foregroundColor(systemLabel.color)
                Text(systemLabel.label)
                    .font(.caption2.monospaced().weight(.semibold))
                    .foregroundColor(systemLabel.color)
            }
            Text("Type: \(proof.proofType)")
                .font(.caption2.monospaced())
                .foregroundColor(Color.Theme.textTertiary)
        }
        .padding(8)
        .background(Color.Theme.searchBg)
        .cornerRadius(6)
    }

    struct ProofSystemLabel {
        let label: String
        let icon: String
        let color: Color
    }

    private func proofSystemLabel(_ proofType: String) -> ProofSystemLabel {
        switch proofType {
        case "mopro-noir":
            return ProofSystemLabel(label: "OpenPassport (Noir/Mopro)", icon: "bolt.shield.fill", color: .green)
        case "semaphore-zk":
            return ProofSystemLabel(label: "Semaphore ZK", icon: "shield.checkered", color: .green)
        default:
            return ProofSystemLabel(label: "SD-JWT Fallback", icon: "exclamationmark.triangle", color: .orange)
        }
    }

    var persistStepSection: some View {
        VStack(spacing: 12) {
            Text("Credential is ready. Save it to your identity wallet.")
                .font(.subheadline)
                .foregroundColor(Color.Theme.textSecondary)

            Button {
                pipeline.persist()
                if let proof = pipeline.proofResult {
                    onCompleted(proof)
                    dismiss()
                }
            } label: {
                Text("Save Passport Credential")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(ThemedPrimaryButtonStyle())
            .disabled(pipeline.proofResult == nil || pipeline.isLoading)
        }
        .padding(14)
        .background(Color.Theme.cardBg)
        .cornerRadius(10)
    }

    func chipSnapshotCard(_ chip: PassportChipSnapshot) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            if chip.isSimulated {
                HStack {
                    Image(systemName: "exclamationmark.triangle.fill")
                        .foregroundColor(.orange)
                    Text("Simulated")
                        .font(.caption.weight(.semibold))
                        .foregroundColor(.orange)
                }
            }

            HStack(spacing: 16) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Nationality")
                        .font(.caption2)
                        .foregroundColor(Color.Theme.textTertiary)
                    Text(chip.nationalityCode)
                        .font(.callout.weight(.semibold))
                }
                VStack(alignment: .leading, spacing: 2) {
                    Text("Document")
                        .font(.caption2)
                        .foregroundColor(Color.Theme.textTertiary)
                    Text(chip.maskedDocNumber)
                        .font(.callout.monospaced())
                }
            }

            HStack(spacing: 12) {
                authBadge("BAC", passed: chip.bacVerified)
                authBadge("PACE", passed: chip.paceVerified)
                authBadge("PA", passed: chip.passiveAuthPassed)
            }

            HStack(spacing: 4) {
                Text("DGs:")
                    .font(.caption2.weight(.semibold))
                    .foregroundColor(Color.Theme.textTertiary)
                Text(chip.dataGroupsRead.joined(separator: ", "))
                    .font(.caption2.monospaced())
                    .foregroundColor(Color.Theme.textTertiary)
            }

            VStack(alignment: .leading, spacing: 2) {
                Text("Doc hash: \(String(chip.documentHash.prefix(16)))...")
                    .font(.caption2.monospaced())
                    .foregroundColor(Color.Theme.textTertiary)
                Text("MRZ digest: \(String(chip.mrzDigest.prefix(16)))...")
                    .font(.caption2.monospaced())
                    .foregroundColor(Color.Theme.textTertiary)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(10)
        .background(Color.Theme.searchBg)
        .cornerRadius(8)
    }

    func authBadge(_ label: String, passed: Bool) -> some View {
        HStack(spacing: 4) {
            Image(systemName: passed ? "checkmark.circle.fill" : "xmark.circle")
                .font(.caption2)
                .foregroundColor(passed ? .green : Color.Theme.textTertiary)
            Text(label)
                .font(.caption2.weight(.semibold))
                .foregroundColor(passed ? .green : Color.Theme.textTertiary)
        }
    }
}

// MARK: - Bullet guarantee row (Figma 756:3327)

struct BulletGuaranteeRow: View {
    let text: String

    var body: some View {
        HStack(spacing: 8) {
            Text(text)
                .font(.system(size: 15))
                .foregroundColor(Color.Theme.textPrimary)

            Spacer(minLength: 0)

            ZStack {
                Circle()
                    .fill(Color.Theme.terminalGreen)
                    .frame(width: 18, height: 18)
                Image(systemName: "checkmark")
                    .font(.system(size: 10, weight: .bold))
                    .foregroundColor(.white)
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 16)
        .background(
            RoundedRectangle(cornerRadius: 8)
                .fill(Color.Theme.mutedSurface)
        )
    }
}
