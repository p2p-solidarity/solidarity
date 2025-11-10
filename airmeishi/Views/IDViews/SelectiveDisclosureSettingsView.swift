import SwiftUI
#if canImport(UIKit)
import UIKit
#endif

struct SelectiveDisclosureSettingsView: View {
    @Binding var sharingPreferences: SharingPreferences
    @State private var selectedLevel: SharingLevel = .public

    private var selectableFields: [BusinessCardField] {
        BusinessCardField.allCases.filter { $0 != .name }
    }

    var body: some View {
        Form {
            zeroKnowledgeSection
            levelPickerSection
            fieldsSection
            additionalSettingsSection
        }
        .onAppear {
            selectedLevel = defaultLevel()
        }
    }

    private var zeroKnowledgeSection: some View {
        Section {
            Toggle("Enable ZK Selective Disclosure", isOn: $sharingPreferences.useZK)
            Text("When enabled, QR and proximity shares include proofs and only reveal allowed fields per level.")
                .font(.caption)
                .foregroundColor(.secondary)
        } header: {
            Text("Zero-Knowledge")
        }
    }

    private var levelPickerSection: some View {
        Section {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 12) {
                    ForEach(SharingLevel.allCases, id: \.self) { level in
                        PrivacyLevelCard(
                            level: level,
                            isSelected: selectedLevel == level,
                            fieldCount: fields(for: level).count
                        ) {
                            withAnimation(.spring(response: 0.3, dampingFraction: 0.7)) {
                                selectedLevel = level
                            }
                        }
                    }
                }
                .padding(.horizontal, 4)
            }
            .frame(height: 100)
        } header: {
            Text("Select Privacy Level")
        }
    }

    private var fieldsSection: some View {
        Section {
            VStack(alignment: .leading, spacing: 16) {
                nameRow
                Divider()
                ForEach(selectableFields, id: \.self) { field in
                    FieldToggleRow(
                        field: field,
                        isEnabled: fields(for: selectedLevel).contains(field)
                    ) { enabled in
                        toggle(field, enabled: enabled)
                    }
                }
            }
            .padding(.vertical, 8)
        } header: {
            Text("Fields for \(selectedLevel.displayName)")
        } footer: {
            Text(footerText())
                .font(.caption)
        }
    }

    private var additionalSettingsSection: some View {
        Section("Additional Settings") {
            Toggle("Allow Forwarding", isOn: $sharingPreferences.allowForwarding)

            DatePicker(
                "Expiration Date",
                selection: Binding(
                    get: { sharingPreferences.expirationDate ?? Date().addingTimeInterval(86400 * 30) },
                    set: { sharingPreferences.expirationDate = $0 }
                ),
                displayedComponents: [.date]
            )

            Button("Remove Expiration") {
                sharingPreferences.expirationDate = nil
            }
            .foregroundColor(.red)
            .disabled(sharingPreferences.expirationDate == nil)
        }
    }

    private var nameRow: some View {
        HStack {
            Image(systemName: "person.fill")
                .foregroundColor(.blue)
                .frame(width: 24)
            Text("Name")
                .font(.subheadline.weight(.medium))
            Spacer()
            Image(systemName: "checkmark.circle.fill")
                .foregroundColor(.green)
                .font(.system(size: 18))
            Text("Required")
                .font(.caption)
                .foregroundColor(.secondary)
        }
        .padding(.vertical, 8)
    }

    private func defaultLevel() -> SharingLevel {
        if sharingPreferences.personalFields.count > sharingPreferences.professionalFields.count {
            return .personal
        }
        if sharingPreferences.professionalFields.count > sharingPreferences.publicFields.count {
            return .professional
        }
        return .public
    }

    private func fields(for level: SharingLevel) -> Set<BusinessCardField> {
        switch level {
        case .public:
            return sharingPreferences.publicFields
        case .professional:
            return sharingPreferences.professionalFields
        case .personal:
            return sharingPreferences.personalFields
        }
    }

    private func toggle(_ field: BusinessCardField, enabled: Bool) {
        guard field != .name else { return }

        switch selectedLevel {
        case .public:
            update(&sharingPreferences.publicFields, field: field, enabled: enabled)
        case .professional:
            update(&sharingPreferences.professionalFields, field: field, enabled: enabled)
        case .personal:
            update(&sharingPreferences.personalFields, field: field, enabled: enabled)
        }

        sharingPreferences.publicFields.insert(.name)
        sharingPreferences.professionalFields.insert(.name)
        sharingPreferences.personalFields.insert(.name)
    }

    private func update(
        _ set: inout Set<BusinessCardField>,
        field: BusinessCardField,
        enabled: Bool
    ) {
        if enabled {
            set.insert(field)
        } else {
            set.remove(field)
        }
    }

    private func footerText() -> String {
        switch selectedLevel {
        case .public:
            return "Information visible to anyone who scans your QR code"
        case .professional:
            return "Information shared in business contexts"
        case .personal:
            return "Full information for trusted contacts"
        }
    }
}

struct PrivacyLevelCard: View {
    let level: SharingLevel
    let isSelected: Bool
    let fieldCount: Int
    let onTap: () -> Void

    var body: some View {
        Button(action: {
            impact(.medium)
            onTap()
        }) {
            VStack(spacing: 8) {
                Image(systemName: icon(for: level))
                    .font(.system(size: 28, weight: .semibold))
                    .foregroundColor(isSelected ? .white : .primary)
                    .frame(width: 44, height: 44)
                    .background(
                        Circle()
                            .fill(isSelected ? Color.accentColor : Color(.systemGray5))
                    )

                Text(level.displayName)
                    .font(.subheadline.weight(.semibold))
                    .foregroundColor(isSelected ? .primary : .secondary)

                Text("\(fieldCount) fields")
                    .font(.caption2)
                    .foregroundColor(.secondary)
            }
            .frame(width: 110)
            .padding(.vertical, 12)
            .padding(.horizontal, 8)
            .background(
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .fill(isSelected ? Color.accentColor.opacity(0.1) : Color(.systemGray6))
                    .overlay(
                        RoundedRectangle(cornerRadius: 12, style: .continuous)
                            .stroke(isSelected ? Color.accentColor : Color.clear, lineWidth: 2)
                    )
            )
        }
        .buttonStyle(PlainButtonStyle())
    }

    private func icon(for level: SharingLevel) -> String {
        switch level {
        case .public: return "globe"
        case .professional: return "briefcase"
        case .personal: return "person.crop.circle"
        }
    }
}

struct FieldToggleRow: View {
    let field: BusinessCardField
    let isEnabled: Bool
    let onToggle: (Bool) -> Void

    var body: some View {
        Button(action: {
            impact(.light)
            onToggle(!isEnabled)
        }) {
            HStack(spacing: 12) {
                Image(systemName: icon(for: field))
                    .foregroundColor(isEnabled ? .blue : .gray)
                    .frame(width: 24)

                VStack(alignment: .leading, spacing: 2) {
                    Text(field.displayName)
                        .font(.subheadline.weight(.medium))
                        .foregroundColor(.primary)

                    if let description = description(for: field) {
                        Text(description)
                            .font(.caption2)
                            .foregroundColor(.secondary)
                    }
                }

                Spacer()

                Image(systemName: isEnabled ? "checkmark.circle.fill" : "circle")
                    .foregroundColor(isEnabled ? .green : .gray)
                    .font(.system(size: 22))
            }
            .padding(.vertical, 8)
            .contentShape(Rectangle())
        }
        .buttonStyle(PlainButtonStyle())
    }

    private func icon(for field: BusinessCardField) -> String {
        switch field {
        case .name: return "person.fill"
        case .title: return "briefcase.fill"
        case .company: return "building.2.fill"
        case .email: return "envelope.fill"
        case .phone: return "phone.fill"
        case .profileImage: return "photo.fill"
        case .socialNetworks: return "link"
        case .skills: return "star.fill"
        }
    }

    private func description(for field: BusinessCardField) -> String? {
        switch field {
        case .email: return "Contact email"
        case .phone: return "Phone number"
        case .title: return "Job title"
        case .company: return "Company name"
        case .profileImage: return "Profile photo"
        case .socialNetworks: return "Social media links"
        case .skills: return "Your skills"
        default: return nil
        }
    }
}

private func impact(_ style: UIImpactFeedbackGenerator.FeedbackStyle) {
    #if canImport(UIKit)
    UIImpactFeedbackGenerator(style: style).impactOccurred()
    #endif
}

#Preview {
    NavigationView {
        SelectiveDisclosureSettingsView(sharingPreferences: .constant(SharingPreferences()))
    }
}
