//
//  ShareLinkOptionsComponents.swift
//  solidarity
//

import SwiftUI

// MARK: - Business Card Summary

struct BusinessCardSummary: View {
  let businessCard: BusinessCard
  let sharingLevel: SharingLevel

  var body: some View {
    VStack(alignment: .leading, spacing: 12) {
      HStack {
        Text("What will be shared")
          .font(.headline)

        Spacer()

        Text(sharingLevel.displayName)
          .font(.caption)
          .padding(.horizontal, 8)
          .padding(.vertical, 4)
          .background(Color.Theme.primaryBlue.opacity(0.2))
          .foregroundColor(Color.Theme.primaryBlue)
          .cornerRadius(4)
      }

      VStack(alignment: .leading, spacing: 8) {
        SharedFieldRow(label: String(localized: "Name"), value: businessCard.name)

        if let title = businessCard.title {
          SharedFieldRow(label: String(localized: "Title"), value: title)
        }

        if let company = businessCard.company {
          SharedFieldRow(label: String(localized: "Company"), value: company)
        }

        if let email = businessCard.email {
          SharedFieldRow(label: String(localized: "Email"), value: email)
        }

        if let phone = businessCard.phone {
          SharedFieldRow(label: String(localized: "Phone"), value: phone)
        }

        if !businessCard.skills.isEmpty {
          SharedFieldRow(
            label: String(localized: "Skills"),
            value: businessCard.skills.map { $0.name }.joined(separator: ", ")
          )
        }
      }
    }
    .padding()
    .background(Color.Theme.cardBg)
    .cornerRadius(12)
  }
}

struct SharedFieldRow: View {
  let label: String
  let value: String

  var body: some View {
    HStack {
      Text(label)
        .font(.caption)
        .foregroundColor(.secondary)
        .frame(width: 60, alignment: .leading)

      Text(value)
        .font(.caption)
        .lineLimit(1)

      Spacer()
    }
  }
}

// MARK: - Option Buttons

struct UsesOptionButton: View {
  let uses: Int
  let isSelected: Bool
  let onTap: () -> Void

  var body: some View {
    Button(action: onTap) {
      VStack(spacing: 4) {
        Text("\(uses)")
          .font(.title3)
          .fontWeight(.bold)

        Text(uses == 1 ? String(localized: "use") : String(localized: "uses"))
          .font(.caption2)
      }
      .foregroundColor(isSelected ? .white : .primary)
      .frame(maxWidth: .infinity)
      .padding(.vertical, 12)
      .background(isSelected ? Color.Theme.primaryBlue : Color.Theme.searchBg)
      .cornerRadius(8)
    }
    .buttonStyle(PlainButtonStyle())
  }
}

struct ExpirationOptionButton: View {
  let hours: Int
  let isSelected: Bool
  let onTap: () -> Void

  private var displayText: String {
    if hours < 24 {
      return "\(hours)h"
    } else {
      let days = hours / 24
      return "\(days)d"
    }
  }

  private var fullText: String {
    if hours < 24 {
      if hours == 1 { return String(localized: "1 hour") }
      let format = String(localized: "%d hours")
      return String(format: format, hours)
    } else {
      let days = hours / 24
      if days == 1 { return String(localized: "1 day") }
      let format = String(localized: "%d days")
      return String(format: format, days)
    }
  }

  var body: some View {
    Button(action: onTap) {
      VStack(spacing: 4) {
        Text(displayText)
          .font(.title3)
          .fontWeight(.bold)

        Text(fullText)
          .font(.caption2)
      }
      .foregroundColor(isSelected ? .white : .primary)
      .frame(maxWidth: .infinity)
      .padding(.vertical, 12)
      .background(isSelected ? Color.Theme.primaryBlue : Color.Theme.searchBg)
      .cornerRadius(8)
    }
    .buttonStyle(PlainButtonStyle())
  }
}

// MARK: - Security Notice

struct SecurityNoticeView: View {
  var body: some View {
    VStack(alignment: .leading, spacing: 12) {
      HStack {
        Image(systemName: "shield.checkered")
          .foregroundColor(.orange)

        Text("Security Notice")
          .font(.headline)
          .foregroundColor(.orange)
      }

      VStack(alignment: .leading, spacing: 8) {
        Text("• Links are encrypted and secure")
        Text("• You can deactivate links at any time")
        Text("• Links automatically expire after the set time")
        Text("• Usage is tracked and limited")
      }
      .font(.caption)
      .foregroundColor(.secondary)
    }
    .padding()
    .background(Color.orange.opacity(0.1))
    .cornerRadius(12)
  }
}

// MARK: - Created Link View

struct CreatedLinkView: View {
  let shareLink: ShareLink

  @Environment(\.dismiss) private var dismiss

  private var generatedShareURL: String {
    ShareLinkManager.shared.generateShareURL(for: shareLink)
  }

  var body: some View {
    NavigationStack {
      ScrollView {
        VStack(spacing: 24) {
          VStack(spacing: 16) {
            Image(systemName: "checkmark.circle.fill")
              .font(.system(size: 80))
              .foregroundColor(.green)

            Text("Share Link Created!")
              .font(.title2)
              .fontWeight(.bold)

            Text("Your secure sharing link is ready to use")
              .font(.subheadline)
              .foregroundColor(.secondary)
          }

          VStack(alignment: .leading, spacing: 16) {
            Text("Link Details")
              .font(.headline)

            VStack(spacing: 12) {
              LinkDetailRow(
                icon: "link",
                label: String(localized: "Share URL"),
                value: generatedShareURL
              )

              LinkDetailRow(
                icon: "number",
                label: String(localized: "Max Uses"),
                value: "\(shareLink.maxUses)"
              )

              LinkDetailRow(
                icon: "clock",
                label: String(localized: "Expires"),
                value: shareLink.expirationDate.formatted(date: .abbreviated, time: .shortened)
              )

              LinkDetailRow(
                icon: "eye",
                label: String(localized: "Privacy Level"),
                value: shareLink.sharingLevel.displayName
              )
            }
          }
          .padding()
          .background(Color.Theme.cardBg)
          .cornerRadius(12)

          VStack(spacing: 12) {
            Button(action: shareLinkAction) {
              HStack {
                Image(systemName: "square.and.arrow.up")
                Text("Share Link")
              }
              .font(.headline)
              .foregroundColor(.white)
              .frame(maxWidth: .infinity)
              .padding()
              .background(Color.Theme.primaryBlue)
              .cornerRadius(12)
            }

            Button(action: copyLinkToClipboard) {
              HStack {
                Image(systemName: "doc.on.doc")
                Text("Copy Link")
              }
              .font(.subheadline)
              .foregroundColor(Color.Theme.primaryBlue)
              .frame(maxWidth: .infinity)
              .padding()
              .background(Color.blue.opacity(0.1))
              .cornerRadius(12)
            }
          }

          Spacer()
        }
        .padding()
      }
      .navigationTitle("Share Link Created")
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

  private func shareLinkAction() {
    let activityVC = UIActivityViewController(
      activityItems: [generatedShareURL],
      applicationActivities: nil
    )

    if let windowScene = UIApplication.shared.connectedScenes.first as? UIWindowScene,
      let window = windowScene.windows.first
    {
      window.rootViewController?.present(activityVC, animated: true)
    }
  }

  private func copyLinkToClipboard() {
    UIPasteboard.general.string = generatedShareURL
  }
}

struct LinkDetailRow: View {
  let icon: String
  let label: String
  let value: String

  var body: some View {
    HStack(alignment: .top, spacing: 12) {
      Image(systemName: icon)
        .foregroundColor(Color.Theme.primaryBlue)
        .frame(width: 20)

      VStack(alignment: .leading, spacing: 2) {
        Text(label)
          .font(.caption)
          .foregroundColor(.secondary)

        Text(value)
          .font(.subheadline)
      }

      Spacer()
    }
  }
}
