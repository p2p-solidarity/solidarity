//
//  PrivacySettingsView.swift
//  airmeishi
//
//  Privacy controls for selective information sharing
//

import SwiftUI

struct PrivacySettingsView: View {
    @Binding var sharingPreferences: SharingPreferences
    @Environment(\.dismiss) private var dismiss
    @State private var selectedLevel: SharingLevel = .public
    
    // Get all fields except name (which is always required)
    private var selectableFields: [BusinessCardField] {
        BusinessCardField.allCases.filter { $0 != .name }
    }
    
    var body: some View {
        Form {
            // ZK toggle
            Section {
                Toggle("Enable ZK Selective Disclosure", isOn: $sharingPreferences.useZK)
                Text("When enabled, QR and proximity shares include proofs and only reveal allowed fields per level.")
                    .font(.caption)
                    .foregroundColor(.secondary)
            } header: {
                Text("Zero-Knowledge")
            }
            
            // Privacy Level Selector - Swipeable cards
            Section {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 12) {
                        ForEach(SharingLevel.allCases, id: \.self) { level in
                            PrivacyLevelCard(
                                level: level,
                                isSelected: selectedLevel == level,
                                fieldCount: fieldsForLevel(level).count
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
            
            // Fields Selection for Selected Level
            Section {
                VStack(alignment: .leading, spacing: 16) {
                    // Name is always included
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
                    
                    Divider()
                    
                    // Selectable fields
                    ForEach(selectableFields, id: \.self) { field in
                        FieldToggleRow(
                            field: field,
                            isEnabled: fieldsForSelectedLevel.contains(field),
                            onToggle: { enabled in
                                toggleField(field, enabled: enabled)
                            }
                        )
                    }
                }
                .padding(.vertical, 8)
            } header: {
                Text("Fields for \(selectedLevel.displayName)")
            } footer: {
                Text(footerTextForLevel(selectedLevel))
                    .font(.caption)
            }
            
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
        .navigationTitle("Privacy Settings")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .navigationBarTrailing) {
                Button("Done") {
                    dismiss()
                }
            }
        }
    }
    
    private func fieldsForLevel(_ level: SharingLevel) -> Set<BusinessCardField> {
        switch level {
        case .public:
            return sharingPreferences.publicFields
        case .professional:
            return sharingPreferences.professionalFields
        case .personal:
            return sharingPreferences.personalFields
        }
    }
    
    private var fieldsForSelectedLevel: Set<BusinessCardField> {
        fieldsForLevel(selectedLevel)
    }
    
    private func toggleField(_ field: BusinessCardField, enabled: Bool) {
        // Name field cannot be toggled - it's always required
        guard field != .name else { return }
        
        switch selectedLevel {
        case .public:
            if enabled {
                sharingPreferences.publicFields.insert(field)
            } else {
                sharingPreferences.publicFields.remove(field)
            }
        case .professional:
            if enabled {
                sharingPreferences.professionalFields.insert(field)
            } else {
                sharingPreferences.professionalFields.remove(field)
            }
        case .personal:
            if enabled {
                sharingPreferences.personalFields.insert(field)
            } else {
                sharingPreferences.personalFields.remove(field)
            }
        }
        
        // Ensure name is always included after any change
        sharingPreferences.publicFields.insert(.name)
        sharingPreferences.professionalFields.insert(.name)
        sharingPreferences.personalFields.insert(.name)
    }
    
    private func iconForLevel(_ level: SharingLevel) -> String {
        switch level {
        case .public:
            return "globe"
        case .professional:
            return "briefcase"
        case .personal:
            return "person.crop.circle"
        }
    }
    
    private func footerTextForLevel(_ level: SharingLevel) -> String {
        switch level {
        case .public:
            return "Information visible to anyone who scans your QR code"
        case .professional:
            return "Information shared in business contexts"
        case .personal:
            return "Full information for trusted contacts"
        }
    }
}

#Preview {
    NavigationView {
        PrivacySettingsView(sharingPreferences: .constant(SharingPreferences()))
    }
}

// MARK: - Components

struct PrivacyLevelCard: View {
    let level: SharingLevel
    let isSelected: Bool
    let fieldCount: Int
    let onTap: () -> Void
    
    var body: some View {
        Button(action: {
            let impact = UIImpactFeedbackGenerator(style: .medium)
            impact.impactOccurred()
            onTap()
        }) {
            VStack(spacing: 8) {
                Image(systemName: iconForLevel(level))
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
    
    private func iconForLevel(_ level: SharingLevel) -> String {
        switch level {
        case .public:
            return "globe"
        case .professional:
            return "briefcase"
        case .personal:
            return "person.crop.circle"
        }
    }
}

struct FieldToggleRow: View {
    let field: BusinessCardField
    let isEnabled: Bool
    let onToggle: (Bool) -> Void
    
    var body: some View {
        Button(action: {
            let impact = UIImpactFeedbackGenerator(style: .light)
            impact.impactOccurred()
            onToggle(!isEnabled)
        }) {
            HStack(spacing: 12) {
                Image(systemName: iconForField(field))
                    .foregroundColor(isEnabled ? .blue : .gray)
                    .frame(width: 24)
                
                VStack(alignment: .leading, spacing: 2) {
                    Text(field.displayName)
                        .font(.subheadline.weight(.medium))
                        .foregroundColor(.primary)
                    
                    if let description = descriptionForField(field) {
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
    
    private func iconForField(_ field: BusinessCardField) -> String {
        switch field {
        case .name:
            return "person.fill"
        case .title:
            return "briefcase.fill"
        case .company:
            return "building.2.fill"
        case .email:
            return "envelope.fill"
        case .phone:
            return "phone.fill"
        case .profileImage:
            return "photo.fill"
        case .socialNetworks:
            return "link"
        case .skills:
            return "star.fill"
        }
    }
    
    private func descriptionForField(_ field: BusinessCardField) -> String? {
        switch field {
        case .email:
            return "Contact email"
        case .phone:
            return "Phone number"
        case .title:
            return "Job title"
        case .company:
            return "Company name"
        case .profileImage:
            return "Profile photo"
        case .socialNetworks:
            return "Social media links"
        case .skills:
            return "Your skills"
        default:
            return nil
        }
    }
}