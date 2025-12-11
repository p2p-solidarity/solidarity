//
//  AppearanceSettingsView.swift
//  airmeishi
//
//  Lets users choose card accent color and glow
//

import SwiftUI

struct AppearanceSettingsView: View {
    @EnvironmentObject private var theme: ThemeManager
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        Form {
            Section("Card Accent Color") {
                colorGrid()
            }

            Section("Effects") {
                Toggle("Enable Glow", isOn: $theme.enableGlow)
            }
            
            Section("Global Animal Theme") {
                Picker("Select Animal", selection: $theme.selectedAnimal) {
                    Text("None").tag(Optional<AnimalCharacter>.none)
                    ForEach(AnimalCharacter.allCases) { animal in
                        Text(animal.displayName).tag(Optional(animal))
                    }
                }
                .pickerStyle(.menu)
                
                if let animal = theme.selectedAnimal {
                    Text(animal.personality)
                        .font(.caption)
                        .foregroundColor(.secondary)
                }
            }
        }
        .navigationTitle("Appearance")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .navigationBarTrailing) {
                Button("Done") { dismiss() }
            }
        }
    }

    private func colorGrid() -> some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 44), spacing: 12)], spacing: 12) {
            ForEach(Array(theme.presets.enumerated()), id: \.offset) { _, color in
                ZStack {
                    Circle()
                        .fill(color)
                        .frame(width: 36, height: 36)
                        .overlay(Circle().stroke(Color.white.opacity(0.2), lineWidth: 1))
                        .onTapGesture { theme.cardAccent = color }
                        .cardGlow(color, enabled: theme.enableGlow)
                    if color.toHexString() == theme.cardAccent.toHexString() {
                        Image(systemName: "checkmark")
                            .font(.caption.weight(.bold))
                            .foregroundColor(.white)
                    }
                }
                .padding(4)
            }
        }
        .padding(.vertical, 4)
    }
}

#Preview {
    NavigationView { AppearanceSettingsView().environmentObject(ThemeManager.shared) }
}

