import SwiftUI

struct BusinessCardHeaderView: View {
    let card: BusinessCard?
    let onPrivacy: () -> Void
    let onAppearance: () -> Void
    let onBackup: () -> Void
    let onGroup: () -> Void
    var isPrivacyEnabled: Bool
    var onFormatChange: ((SharingFormat) -> Void)? = nil

    @ObservedObject private var identity = IdentityCoordinator.shared

    var body: some View {
        VStack(spacing: 16) {
            NavigationButtonsRow(
                onPrivacy: onPrivacy,
                onAppearance: onAppearance,
                onBackup: onBackup,
                onGroup: onGroup,
                isPrivacyEnabled: isPrivacyEnabled
            )

            SharingFormatPicker(
                selected: formatBinding,
                verificationStatus: card.flatMap { identity.verificationStatus(for: $0.id) },
                lastImport: identity.state.lastImportEvent
            )
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 16)
        .background(
            RoundedRectangle(cornerRadius: 20, style: .continuous)
                .fill(Color.gray.opacity(0.12))
                .overlay(
                    RoundedRectangle(cornerRadius: 20, style: .continuous)
                        .stroke(Color.white.opacity(0.08), lineWidth: 1)
                )
        )
    }

    private var formatBinding: Binding<SharingFormat> {
        if let card = card, let onFormatChange = onFormatChange {
            return Binding(
                get: { card.sharingPreferences.sharingFormat },
                set: { onFormatChange($0) }
            )
        }
        return .constant(.plaintext)
    }
}

private struct NavigationButtonsRow: View {
    let onPrivacy: () -> Void
    let onAppearance: () -> Void
    let onBackup: () -> Void
    let onGroup: () -> Void
    var isPrivacyEnabled: Bool

    var body: some View {
        HStack(spacing: 12) {
            NavigationButton(icon: "lock.shield", title: "Privacy", isEnabled: isPrivacyEnabled, action: onPrivacy)
            NavigationButton(icon: "paintbrush.fill", title: "Appearance", action: onAppearance)
            NavigationButton(icon: "square.and.arrow.up", title: "Backup", action: onBackup)
            NavigationButton(icon: "person.3.fill", title: "Group", action: onGroup)
        }
    }
}

private struct NavigationButton: View {
    let icon: String
    let title: String
    var isEnabled: Bool = true
    let action: () -> Void

    var body: some View {
        Button(action: trigger) {
            VStack(spacing: 8) {
                ZStack {
                    RoundedRectangle(cornerRadius: 10, style: .continuous)
                        .fill(isEnabled ? Color.white.opacity(0.18) : Color.white.opacity(0.08))
                        .overlay(
                            RoundedRectangle(cornerRadius: 10, style: .continuous)
                                .stroke(Color.white.opacity(isEnabled ? 0.25 : 0.1), lineWidth: 1.5)
                        )
                        .frame(width: 44, height: 44)

                    Image(systemName: icon)
                        .font(.system(size: 20, weight: .semibold))
                        .foregroundColor(isEnabled ? .white : .white.opacity(0.5))
                        .frame(width: 44, height: 44)
                        .contentShape(Rectangle())
                }

                Text(title)
                    .font(.caption2.weight(.semibold))
                    .foregroundColor(isEnabled ? .white : .white.opacity(0.5))
                    .multilineTextAlignment(.center)
                    .lineLimit(2)
                    .minimumScaleFactor(0.75)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 10)
        }
        .buttonStyle(PlainButtonStyle())
        .disabled(!isEnabled)
    }

    private func trigger() {
        guard isEnabled else { return }
        #if canImport(UIKit)
        UIImpactFeedbackGenerator(style: .medium).impactOccurred()
        #endif
        action()
    }
}

private struct SharingFormatPicker: View {
    @Binding var selected: SharingFormat
    let verificationStatus: VerificationStatus?
    let lastImport: IdentityState.ImportEvent?

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Picker("Sharing Format", selection: $selected) {
                ForEach(SharingFormat.allCases) { format in
                    Text(format.displayName).tag(format)
                }
            }
            .pickerStyle(.segmented)

            VStack(alignment: .leading, spacing: 4) {
                Text(selected.detail)
                    .font(.caption)
                    .foregroundColor(.secondary)

                if let status = verificationStatus {
                    HStack(spacing: 6) {
                        Image(systemName: status.systemImageName)
                            .foregroundColor(color(for: status))
                        Text("Verification: \(status.displayName)")
                            .font(.caption)
                            .foregroundColor(.secondary)
                    }
                }

                if let importEvent = lastImport {
                    HStack(spacing: 6) {
                        Image(systemName: "clock")
                            .foregroundColor(.secondary)
                        Text(importEvent.summary)
                            .font(.caption2)
                            .foregroundColor(.secondary)
                    }
                }
            }
        }
    }
}

private func color(for status: VerificationStatus) -> Color {
    switch status {
    case .verified: return .green
    case .pending: return .orange
    case .unverified: return .gray
    case .failed: return .red
    }
}

#Preview {
    BusinessCardHeaderView(
        card: .sample,
        onPrivacy: {},
        onAppearance: {},
        onBackup: {},
        onGroup: {},
        isPrivacyEnabled: true,
        onFormatChange: { _ in }
    )
}
