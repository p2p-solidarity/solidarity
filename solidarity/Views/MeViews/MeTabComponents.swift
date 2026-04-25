import SwiftUI

struct PreparedSelfInitiatedProof: Identifiable {
  let id = UUID().uuidString
  let claim: ProvableClaimEntity
  let qrImage: UIImage
}

// MARK: - Section header

struct MeSectionHeader: View {
  let title: String

  var body: some View {
    Text(title)
      .font(.system(size: 15, weight: .semibold))
      .foregroundColor(Color.Theme.textPrimary)
      .frame(maxWidth: .infinity, alignment: .leading)
      .padding(.horizontal, 16)
  }
}

// MARK: - Card surface

struct MeCardSurface<Content: View>: View {
  let content: Content
  init(@ViewBuilder content: () -> Content) { self.content = content() }
  var body: some View {
    content
      .background(
        RoundedRectangle(cornerRadius: 12)
          .fill(Color.Theme.searchBg)
      )
  }
}

// MARK: - Profile header card

struct ProfileHeaderCard: View {
  let name: String
  let did: String
  let avatar: AnyView
  let onEdit: () -> Void

  var body: some View {
    HStack(alignment: .center, spacing: 14) {
      avatar
        .frame(width: 56, height: 56)
        .clipShape(Circle())

      VStack(alignment: .leading, spacing: 6) {
        Text(name)
          .font(.system(size: 22, weight: .bold))
          .foregroundColor(Color.Theme.textPrimary)
          .lineLimit(1)

        HStack(spacing: 4) {
          Image(systemName: "key.fill")
            .font(.system(size: 9))
          Text(did)
            .font(.system(size: 11, weight: .medium, design: .monospaced))
            .lineLimit(1)
            .truncationMode(.middle)
        }
        .foregroundColor(Color.Theme.textTertiary)
      }

      Spacer(minLength: 4)

      Button(action: onEdit) {
        Text("Edit")
          .font(.system(size: 14, weight: .semibold))
          .foregroundColor(Color.Theme.pageBg)
          .padding(.horizontal, 16)
          .padding(.vertical, 8)
          .background(
            RoundedRectangle(cornerRadius: 8)
              .fill(Color.Theme.textPrimary)
          )
      }
      .buttonStyle(.plain)
    }
    .padding(14)
    .background(
      RoundedRectangle(cornerRadius: 14)
        .fill(Color.Theme.searchBg)
    )
    .padding(.horizontal, 16)
  }
}

// MARK: - Action tile (icon circle + label)

struct ActionTile: View {
  let icon: String
  let title: String
  let action: () -> Void

  var body: some View {
    Button(action: action) {
      HStack(spacing: 12) {
        ZStack {
          Circle()
            .fill(Color.Theme.primaryBlue.opacity(0.15))
            .frame(width: 36, height: 36)
          Image(systemName: icon)
            .font(.system(size: 16, weight: .regular))
            .foregroundColor(Color.Theme.primaryBlue)
        }

        Text(title)
          .font(.system(size: 14, weight: .medium))
          .foregroundColor(Color.Theme.textPrimary)
          .multilineTextAlignment(.leading)
          .lineLimit(2)
          .minimumScaleFactor(0.9)

        Spacer(minLength: 0)
      }
      .padding(14)
      .frame(maxWidth: .infinity, minHeight: 76, alignment: .leading)
      .background(
        RoundedRectangle(cornerRadius: 12)
          .fill(Color.Theme.searchBg)
      )
    }
    .buttonStyle(.plain)
  }
}

// MARK: - Disclosure row (title + source + Show button)

struct DisclosureRowView: View {
  let title: String
  let source: String
  let actionTitle: String
  let isLoading: Bool
  let isDisabled: Bool
  let onPresent: () -> Void

  var body: some View {
    HStack(alignment: .center, spacing: 12) {
      VStack(alignment: .leading, spacing: 4) {
        Text(title)
          .font(.system(size: 15, weight: .semibold))
          .foregroundColor(Color.Theme.textPrimary)
        Text(source)
          .font(.system(size: 11, weight: .regular, design: .monospaced))
          .foregroundColor(Color.Theme.textTertiary)
      }
      Spacer()
      Button(action: onPresent) {
        Group {
          if isLoading {
            ProgressView()
              .progressViewStyle(CircularProgressViewStyle(tint: Color.Theme.pageBg))
              .scaleEffect(0.8)
          } else {
            Text(actionTitle)
              .font(.system(size: 14, weight: .semibold))
          }
        }
        .foregroundColor(Color.Theme.pageBg)
        .frame(minWidth: 56)
        .padding(.horizontal, 14)
        .padding(.vertical, 8)
        .background(
          RoundedRectangle(cornerRadius: 8)
            .fill(Color.Theme.textPrimary)
        )
      }
      .buttonStyle(.plain)
      .disabled(isDisabled)
      .opacity(isDisabled && !isLoading ? 0.5 : 1)
    }
    .padding(14)
    .background(
      RoundedRectangle(cornerRadius: 12)
        .fill(Color.Theme.searchBg)
    )
    .padding(.horizontal, 16)
  }
}

// MARK: - Developer row (icon + title + trailing detail + chevron)

struct DeveloperRowView: View {
  let icon: String
  let title: String
  let trailingText: String?
  let action: () -> Void

  var body: some View {
    Button(action: action) {
      HStack(spacing: 12) {
        Image(systemName: icon)
          .font(.system(size: 16, weight: .regular))
          .foregroundColor(Color.Theme.textPrimary)
          .frame(width: 24)

        Text(title)
          .font(.system(size: 14, weight: .medium))
          .foregroundColor(Color.Theme.textPrimary)

        Spacer()

        if let trailingText {
          Text(trailingText)
            .font(.system(size: 13, weight: .regular))
            .foregroundColor(Color.Theme.textTertiary)
        }

        Image(systemName: "chevron.right")
          .font(.system(size: 12, weight: .semibold))
          .foregroundColor(Color.Theme.textTertiary)
      }
      .padding(14)
      .background(
        RoundedRectangle(cornerRadius: 12)
          .fill(Color.Theme.searchBg)
      )
    }
    .buttonStyle(.plain)
  }
}

// MARK: - Identity status card (legacy verified credential row)

struct IdentityStatusCard: View {
  let emoji: String
  let title: String
  let trustText: String
  let subtitle: String
  let ctaTitle: String
  var onCTA: (() -> Void)?

  var body: some View {
    VStack(alignment: .leading, spacing: 10) {
      HStack {
        Text("\(emoji) \(title)")
          .font(.system(size: 15, weight: .semibold))
          .foregroundColor(Color.Theme.textPrimary)
        Spacer()
        if let onCTA {
          Button(action: onCTA) {
            Text(ctaTitle)
              .font(.system(size: 13, weight: .semibold))
              .foregroundColor(Color.Theme.pageBg)
              .padding(.horizontal, 12)
              .padding(.vertical, 6)
              .background(
                RoundedRectangle(cornerRadius: 8)
                  .fill(Color.Theme.textPrimary)
              )
          }
          .buttonStyle(.plain)
        } else {
          Image(systemName: "chevron.right")
            .font(.system(size: 12, weight: .semibold))
            .foregroundColor(Color.Theme.textTertiary)
        }
      }

      HStack {
        Text(trustText)
          .font(.system(size: 11, weight: .medium, design: .monospaced))
          .foregroundColor(Color.Theme.terminalGreen)
        Spacer()
        Text(subtitle.uppercased())
          .font(.system(size: 11, weight: .medium, design: .monospaced))
          .foregroundColor(Color.Theme.textTertiary)
      }
    }
    .padding(14)
    .background(
      RoundedRectangle(cornerRadius: 12)
        .fill(Color.Theme.searchBg)
    )
    .padding(.horizontal, 16)
  }
}

// MARK: - Empty state

struct EmptyMeStateCard: View {
  let title: String
  let subtitle: String
  let primaryTitle: String
  let secondaryTitle: String
  let onPrimaryTap: () -> Void
  let onSecondaryTap: () -> Void

  var body: some View {
    VStack(spacing: 20) {
      Image(systemName: "lock.shield")
        .font(.system(size: 40))
        .foregroundColor(Color.Theme.textTertiary)

      VStack(spacing: 6) {
        Text(title)
          .font(.system(size: 16, weight: .semibold))
          .foregroundColor(Color.Theme.textPrimary)
        Text(subtitle)
          .font(.system(size: 13))
          .foregroundColor(Color.Theme.textSecondary)
          .multilineTextAlignment(.center)
      }

      VStack(spacing: 10) {
        Button(action: onPrimaryTap) {
          Text(primaryTitle)
        }
        .buttonStyle(ThemedPrimaryButtonStyle())

        Button(action: onSecondaryTap) {
          Text(secondaryTitle)
        }
        .buttonStyle(ThemedSecondaryButtonStyle())
      }
    }
    .padding(20)
    .frame(maxWidth: .infinity)
    .background(
      RoundedRectangle(cornerRadius: 12)
        .fill(Color.Theme.searchBg)
    )
  }
}

struct SelfInitiatedProofSheet: View {
  let preparedProof: PreparedSelfInitiatedProof
  @Environment(\.dismiss) private var dismiss

  var body: some View {
    NavigationStack {
      ScrollView {
        VStack(spacing: 24) {
          Text("Claim: [\(preparedProof.claim.claimType)]")
            .font(.system(size: 14, weight: .bold, design: .monospaced))
            .foregroundColor(Color.Theme.terminalGreen)

          Image(uiImage: preparedProof.qrImage)
            .resizable()
            .interpolation(.none)
            .scaledToFit()
            .frame(maxWidth: 260)
            .padding(16)
            .background(Color.white)
            .cornerRadius(12)

          Text("Present this QR to a verifier for proof disclosure.")
            .font(.system(size: 14))
            .foregroundColor(Color.Theme.textSecondary)
            .multilineTextAlignment(.center)
            .padding(.horizontal, 32)
        }
        .padding(.top, 24)
        .padding(.horizontal, 16)
      }
      .background(Color.Theme.pageBg.ignoresSafeArea())
      .navigationTitle("Present Proof")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .navigationBarTrailing) {
          Button {
            dismiss()
          } label: {
            Image(systemName: "xmark")
              .foregroundColor(Color.Theme.textPrimary)
          }
        }
      }
    }
  }
}
