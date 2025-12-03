import SwiftUI
#if canImport(UIKit)
import UIKit
#endif

struct SelectiveDisclosureSettingsView: View {
    @Binding var sharingPreferences: SharingPreferences
    @State private var expirationDays: Int = 30
    @State private var selectedLevel: SharingLevel = .public
    
    // Helper for binding to a specific field in a specific level
    private func bindingForField(_ level: SharingLevel, _ field: BusinessCardField) -> Binding<Bool> {
        Binding(
            get: {
                sharingPreferences.fieldsForLevel(level).contains(field)
            },
            set: { isIncluded in
                var currentFields = sharingPreferences.fieldsForLevel(level)
                if isIncluded {
                    currentFields.insert(field)
                } else {
                    currentFields.remove(field)
                }
                
                switch level {
                case .public:
                    sharingPreferences.publicFields = currentFields
                case .professional:
                    sharingPreferences.professionalFields = currentFields
                case .personal:
                    sharingPreferences.personalFields = currentFields
                }
            }
        )
    }

    var body: some View {
        ScrollView {
            VStack(spacing: 24) {
                overallSection
                
                VStack(spacing: 16) {
                    levelPicker
                    
                    TabView(selection: $selectedLevel) {
                        ForEach(SharingLevel.allCases) { level in
                            PrivacyLevelView(
                                level: level,
                                bindingProvider: { field in bindingForField(level, field) }
                            )
                            .tag(level)
                        }
                    }
                    .tabViewStyle(.page(indexDisplayMode: .never))
                    .frame(height: 500) // Fixed height for the content
                }
            }
            .padding(.vertical)
        }
        .background(Color(.systemGroupedBackground))
        .onAppear {
            // Set expiration days based on current expiration date
            if let expirationDate = sharingPreferences.expirationDate {
                let days = Calendar.current.dateComponents([.day], from: Date(), to: expirationDate).day ?? 30
                expirationDays = max(1, min(365, days))
            }
        }
    }

    private var overallSection: some View {
        VStack(spacing: 0) {
            ToggleRow(
                title: "Zero-Knowledge Privacy",
                subtitle: "Use selective disclosure proofs when sharing.",
                isOn: $sharingPreferences.useZK,
                icon: "eye.slash.fill",
                color: .purple
            )
            
            Divider().padding(.leading, 50)
            
            ToggleRow(
                title: "Allow Forwarding",
                subtitle: "Allow recipients to re-share your card.",
                isOn: $sharingPreferences.allowForwarding,
                icon: "arrowshape.turn.up.right.fill",
                color: .blue
            )
            
            Divider().padding(.leading, 50)
            
            HStack {
                Image(systemName: "clock.fill")
                    .font(.system(size: 20))
                    .foregroundColor(.orange)
                    .frame(width: 30, height: 30)
                    .background(Color.orange.opacity(0.1))
                    .clipShape(RoundedRectangle(cornerRadius: 8))
                
                VStack(alignment: .leading, spacing: 2) {
                    Text("Expiration")
                        .font(.body)
                        .foregroundColor(.primary)
                }
                
                Spacer()
                
                Picker("", selection: $expirationDays) {
                    Text("7 days").tag(7)
                    Text("30 days").tag(30)
                    Text("90 days").tag(90)
                    Text("Never").tag(36500)
                }
                .labelsHidden()
            }
            .padding()
        }
        .background(Color(.secondarySystemGroupedBackground))
        .cornerRadius(12)
        .padding(.horizontal)
    }
    
    private var levelPicker: some View {
        HStack(spacing: 0) {
            ForEach(SharingLevel.allCases) { level in
                Button {
                    withAnimation {
                        selectedLevel = level
                    }
                } label: {
                    VStack(spacing: 6) {
                        Image(systemName: level.icon)
                            .font(.system(size: 18, weight: .medium))
                        Text(level.displayName)
                            .font(.caption.weight(.medium))
                    }
                    .foregroundColor(selectedLevel == level ? .accentColor : .secondary)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 8)
                    .background(
                        RoundedRectangle(cornerRadius: 8)
                            .fill(selectedLevel == level ? Color.accentColor.opacity(0.1) : Color.clear)
                    )
                }
            }
        }
        .padding(4)
        .background(Color(.secondarySystemGroupedBackground))
        .cornerRadius(12)
        .padding(.horizontal)
    }
}

struct ToggleRow: View {
    let title: String
    let subtitle: String
    @Binding var isOn: Bool
    let icon: String
    let color: Color
    
    var body: some View {
        HStack {
            Image(systemName: icon)
                .font(.system(size: 20))
                .foregroundColor(color)
                .frame(width: 30, height: 30)
                .background(color.opacity(0.1))
                .clipShape(RoundedRectangle(cornerRadius: 8))
            
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.body)
                    .foregroundColor(.primary)
                Text(subtitle)
                    .font(.caption)
                    .foregroundColor(.secondary)
            }
            
            Spacer()
            
            Toggle("", isOn: $isOn)
                .labelsHidden()
        }
        .padding()
    }
}

struct PrivacyLevelView: View {
    let level: SharingLevel
    let bindingProvider: (BusinessCardField) -> Binding<Bool>
    
    var body: some View {
        VStack(spacing: 16) {
            Text(level.description)
                .font(.footnote)
                .foregroundColor(.secondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal)
            
            VStack(spacing: 0) {
                ForEach(BusinessCardField.allCases) { field in
                    let isName = field == .name
                    HStack {
                        Image(systemName: field.icon)
                            .font(.system(size: 16))
                            .foregroundColor(.secondary)
                            .frame(width: 24)
                        
                        Text(field.displayName)
                            .font(.body)
                        
                        Spacer()
                        
                        if isName {
                            Image(systemName: "checkmark.circle.fill")
                                .foregroundColor(.secondary.opacity(0.5))
                        } else {
                            Toggle("", isOn: bindingProvider(field))
                                .labelsHidden()
                        }
                    }
                    .padding()
                    .background(Color(.secondarySystemGroupedBackground))
                    
                    if field != BusinessCardField.allCases.last {
                        Divider().padding(.leading, 56)
                    }
                }
            }
            .cornerRadius(12)
            .padding(.horizontal)
            
            Spacer()
        }
    }
}

#Preview {
    NavigationView {
        SelectiveDisclosureSettingsView(sharingPreferences: .constant(SharingPreferences()))
    }
}

