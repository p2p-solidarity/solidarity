//
//  LanguageSelectionView.swift
//  airmeishi
//
//  Language selection interface for OCR scanning
//

import SwiftUI

struct LanguageSelectionView: View {
  @Binding var selectedLanguage: ScanLanguage
  let onLanguageSelected: (ScanLanguage) -> Void
  @Environment(\.dismiss) private var dismiss

  var body: some View {
    NavigationView {
      VStack(spacing: 24) {
        // Header
        VStack(spacing: 12) {
          Image(systemName: "globe")
            .font(.system(size: 50))
            .foregroundColor(.blue)

          Text("Select Language")
            .font(.title2)
            .fontWeight(.semibold)

          Text("Choose the language of the business card you want to scan")
            .font(.body)
            .foregroundColor(.secondary)
            .multilineTextAlignment(.center)
        }
        .padding(.top, 20)

        // Language options
        VStack(spacing: 12) {
          ForEach(ScanLanguage.allCases) { language in
            LanguageOptionView(
              language: language,
              isSelected: selectedLanguage == language
            ) {
              selectedLanguage = language
              onLanguageSelected(language)
            }
          }
        }
        .padding(.horizontal, 20)

        Spacer()
      }
      .navigationTitle("Language Selection")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .navigationBarTrailing) {
          Button("Done") {
            dismiss()
          }
        }
      }
    }
  }
}

struct LanguageOptionView: View {
  let language: ScanLanguage
  let isSelected: Bool
  let onTap: () -> Void

  var body: some View {
    Button(action: onTap) {
      HStack(spacing: 18) {
        Text(language.flag)
          .font(.system(size: 36))

        VStack(alignment: .leading, spacing: 6) {
          Text(language.displayName)
            .font(.body)
            .fontWeight(.semibold)
            .foregroundColor(.primary)

          Text(language.rawValue)
            .font(.subheadline)
            .foregroundColor(.secondary)
        }

        Spacer()

        if isSelected {
          Image(systemName: "checkmark.circle.fill")
            .foregroundColor(.blue)
            .font(.title2)
        }
      }
      .padding(.horizontal, 20)
      .padding(.vertical, 18)
      .background(
        RoundedRectangle(cornerRadius: 14)
          .fill(isSelected ? Color.blue.opacity(0.12) : Color(.systemGray6))
          .overlay(
            RoundedRectangle(cornerRadius: 14)
              .stroke(isSelected ? Color.blue : Color.clear, lineWidth: 2)
          )
      )
    }
    .buttonStyle(PlainButtonStyle())
  }
}

#Preview {
  LanguageSelectionView(
    selectedLanguage: .constant(.english)
  ) { _ in }
}
