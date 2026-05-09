//
//  AppearanceSettingsView.swift
//  solidarity
//
//  Lets users choose card accent color and glow
//

import SwiftUI

struct AppearanceSettingsView: View {
  @EnvironmentObject private var theme: ThemeManager
  @Environment(\.dismiss) private var dismiss

  var body: some View {
    ScrollView {
      VStack(spacing: 24) {
        colorModeSection
        cardAccentSection
        effectsSection
        animalThemeSection
      }
      .padding(.vertical, 24)
    }
    .background(Color.Theme.pageBg.ignoresSafeArea())
    .navigationTitle("Appearance")
    .navigationBarTitleDisplayMode(.inline)
    .toolbar {
      ToolbarItem(placement: .navigationBarTrailing) {
        Button("Done") { dismiss() }
      }
    }
  }

  // MARK: - Color Mode

  private var colorModeSection: some View {
    VStack(alignment: .leading, spacing: 8) {
      SettingsBlockSectionHeader(title: "Color Mode")

      Picker("Appearance", selection: $theme.appColorScheme) {
        ForEach(AppColorScheme.allCases, id: \.self) { scheme in
          Text(scheme.displayName).tag(scheme)
        }
      }
      .pickerStyle(.segmented)
      .padding(.horizontal, 14)
      .padding(.vertical, 12)
      .frame(maxWidth: .infinity, alignment: .leading)
      .background(
        RoundedRectangle(cornerRadius: 12)
          .fill(Color.Theme.mutedSurface)
      )
      .padding(.horizontal, 16)
    }
  }

  // MARK: - Card Accent

  private var cardAccentSection: some View {
    VStack(alignment: .leading, spacing: 8) {
      SettingsBlockSectionHeader(title: "Card Accent")

      colorGrid()
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
          RoundedRectangle(cornerRadius: 12)
            .fill(Color.Theme.mutedSurface)
        )
        .padding(.horizontal, 16)
    }
  }

  // MARK: - Effects

  private var effectsSection: some View {
    SettingsBlockSection("Effects") {
      SettingsBlockToggleRow(
        icon: "sparkles",
        title: "Enable Glow",
        isOn: $theme.enableGlow
      )
    }
  }

  // MARK: - Animal Theme

  private var animalThemeSection: some View {
    SettingsBlockSection("Animal Theme", footer: theme.selectedAnimal?.personality) {
      NavigationLink {
        AnimalPickerView()
          .environmentObject(theme)
      } label: {
        SettingsBlockRow(
          icon: "pawprint",
          title: "Animal",
          trailingText: theme.selectedAnimal?.displayName ?? "None"
        )
      }
      .buttonStyle(.plain)
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
  }
}

// MARK: - Animal Picker

private struct AnimalPickerView: View {
  @EnvironmentObject private var theme: ThemeManager
  @Environment(\.dismiss) private var dismiss

  var body: some View {
    ScrollView {
      VStack(spacing: 24) {
        SettingsBlockSection("Animal") {
          Button {
            theme.selectedAnimal = nil
            dismiss()
          } label: {
            SettingsBlockRow(
              icon: "circle.slash",
              title: "None",
              trailingText: theme.selectedAnimal == nil ? "✓" : nil,
              showsChevron: false
            )
          }
          .buttonStyle(.plain)

          ForEach(AnimalCharacter.allCases) { animal in
            Button {
              theme.selectedAnimal = animal
              dismiss()
            } label: {
              SettingsBlockRow(
                icon: "pawprint",
                title: animal.displayName,
                subtitle: animal.personality,
                trailingText: theme.selectedAnimal == animal ? "✓" : nil,
                showsChevron: false
              )
            }
            .buttonStyle(.plain)
          }
        }
      }
      .padding(.vertical, 24)
    }
    .background(Color.Theme.pageBg.ignoresSafeArea())
    .navigationTitle("Animal")
    .navigationBarTitleDisplayMode(.inline)
  }
}

#Preview {
  NavigationView { AppearanceSettingsView().environmentObject(ThemeManager.shared) }
}
