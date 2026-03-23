//
//  ShoutoutUserPicker.swift
//  solidarity
//
//  Created by Solidarity Team.
//

import SwiftUI

// MARK: - User Picker View

struct UserPickerView: View {
  @Binding var selectedUser: ShoutoutUser?
  @Environment(\.dismiss) private var dismiss
  @Environment(\.colorScheme) private var colorScheme
  @StateObject private var chartService = ShoutoutChartService.shared
  @State private var searchText = ""
  @State private var isSakuraAnimating = false

  var filteredUsers: [ShoutoutUser] {
    if searchText.isEmpty {
      return chartService.users
    } else {
      return chartService.users.filter { user in
        user.name.localizedCaseInsensitiveContains(searchText)
          || user.company.localizedCaseInsensitiveContains(searchText)
          || user.title.localizedCaseInsensitiveContains(searchText)
      }
    }
  }

  var body: some View {
    NavigationStack {
      ZStack {
        Color.Theme.pageBg.ignoresSafeArea()

        VStack(spacing: 0) {
          // Search bar
          searchBar

          // User list
          ScrollView {
            LazyVStack(spacing: 12) {
              ForEach(filteredUsers) { user in
                LighteningUserRow(
                  user: user,
                  isLighteningAnimating: isSakuraAnimating
                ) {
                  selectedUser = user
                  dismiss()
                }
              }
            }
            .padding()
          }
        }
      }
      .navigationTitle("Select Recipient")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .navigationBarLeading) {
          Button("Cancel") {
            dismiss()
          }
        }
      }
      .onAppear {
        isSakuraAnimating = true
      }
    }
  }

  private var searchBar: some View {
    HStack {
      Image(systemName: "magnifyingglass")
        .foregroundColor(Color.Theme.accentRose)

      TextField("Search contacts...", text: $searchText)
        .textFieldStyle(PlainTextFieldStyle())
        .foregroundColor(Color.Theme.textPrimary)

      if !searchText.isEmpty {
        Button("Clear") {
          searchText = ""
        }
        .font(.caption)
        .foregroundColor(Color.Theme.textSecondary)
      }
    }
    .padding()
    .background(
      RoundedRectangle(cornerRadius: 12)
        .fill(Color.Theme.searchBg)
        .overlay(
          RoundedRectangle(cornerRadius: 12)
            .stroke(Color.Theme.accentRose.opacity(0.3), lineWidth: 1)
        )
    )
    .padding()
  }
}

// MARK: - Lightening User Row

struct LighteningUserRow: View {
  let user: ShoutoutUser
  let isLighteningAnimating: Bool
  let onTap: () -> Void

  @Environment(\.colorScheme) private var colorScheme
  @State private var isHovering = false

  var body: some View {
    Button(action: onTap) {
      HStack(spacing: 16) {
        // Profile image with lightning border
        AsyncImage(url: user.profileImageURL) { image in
          image
            .resizable()
            .aspectRatio(contentMode: .fill)
        } placeholder: {
          Circle()
            .fill(
              LinearGradient(
                colors: [Color.Theme.primaryBlue, Color.Theme.dustyMauve],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
              )
            )
            .overlay {
              Text(user.initials)
                .font(.headline)
                .foregroundColor(.white)
            }
        }
        .frame(width: 60, height: 60)
        .clipShape(Circle())
        .overlay(
          Circle()
            .stroke(Color.Theme.accentRose, lineWidth: 2)
            .scaleEffect(isLighteningAnimating ? 1.1 : 1.0)
            .animation(
              .easeInOut(duration: 0.5).repeatForever(autoreverses: true),
              value: isLighteningAnimating
            )
        )

        // User info
        VStack(alignment: .leading, spacing: 4) {
          Text(user.name)
            .font(.headline)
            .foregroundColor(Color.Theme.textPrimary)

          if !user.company.isEmpty {
            Text(user.company)
              .font(.subheadline)
              .foregroundColor(Color.Theme.textSecondary)
          }

          if !user.title.isEmpty {
            Text(user.title)
              .font(.caption)
              .foregroundColor(Color.Theme.textTertiary)
          }
        }

        Spacer()

        // Sakura and verification
        VStack(spacing: 4) {
          SakuraIconView(size: 24, color: isLighteningAnimating ? Color.Theme.accentRose : Color.Theme.textSecondary, isAnimating: isLighteningAnimating)

          Image(systemName: user.verificationStatus.systemImageName)
            .foregroundColor(verificationColor)
            .font(.caption)
        }
      }
      .padding()
      .background(
        RoundedRectangle(cornerRadius: 12)
          .fill(Color.Theme.cardSurface(for: colorScheme))
          .overlay(
            RoundedRectangle(cornerRadius: 12)
              .stroke(
                isLighteningAnimating ? Color.Theme.featureAccent.opacity(0.3) : Color.Theme.cardBorder(for: colorScheme),
                lineWidth: 1
              )
          )
      )
      .scaleEffect(isHovering ? 1.02 : 1.0)
      .animation(.spring(response: 0.3, dampingFraction: 0.7), value: isHovering)
    }
    .buttonStyle(PlainButtonStyle())
    .onHover { hovering in
      isHovering = hovering
    }
  }

  private var verificationColor: Color {
    switch user.verificationStatus {
    case .verified: return .green
    case .pending: return .orange
    case .unverified: return Color.Theme.primaryBlue
    case .failed: return .red
    }
  }
}
