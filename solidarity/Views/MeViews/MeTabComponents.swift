import SwiftUI

struct PreparedSelfInitiatedProof: Identifiable {
  let id = UUID().uuidString
  let claim: ProvableClaimEntity
  let qrImage: UIImage
}

// MARK: - Section header (Figma 737:2560: 14pt regular)

struct MeSectionHeader: View {
  let title: String

  var body: some View {
    Text(title)
      .font(.system(size: 14))
      .foregroundColor(Color.Theme.textPrimary)
      .frame(maxWidth: .infinity, alignment: .leading)
      .padding(.horizontal, 16)
  }
}

// MARK: - Profile header card (Figma 737:2545)

struct ProfileHeaderCard: View {
  let name: String
  let did: String
  let avatar: AnyView
  let onEdit: () -> Void

  var body: some View {
    HStack(alignment: .top, spacing: 24) {
      HStack(alignment: .top, spacing: 16) {
        avatarCircle

        VStack(alignment: .leading, spacing: 8) {
          Text(name)
            .font(.system(size: 24, weight: .medium))
            .foregroundColor(Color.Theme.textPrimary)
            .lineLimit(1)

          didPill
        }
      }
      .frame(maxWidth: .infinity, alignment: .leading)

      Button(action: onEdit) {
        Text("Edit")
          .font(.system(size: 13, weight: .medium))
          .foregroundColor(Color.Theme.invertedButtonText)
          .padding(.horizontal, 16)
          .frame(height: 28)
          .background(
            RoundedRectangle(cornerRadius: 2)
              .fill(Color.Theme.invertedButtonBg)
          )
      }
      .buttonStyle(.plain)
    }
    .padding(.horizontal, 12)
    .padding(.top, 16)
    .padding(.bottom, 24)
    .background(
      RoundedRectangle(cornerRadius: 3)
        .fill(Color.Theme.mutedSurface)
    )
    .padding(.horizontal, 16)
  }

  private var avatarCircle: some View {
    ZStack {
      Circle()
        .fill(Color.Theme.warmCream)
      avatar
    }
    .frame(width: 56, height: 56)
    .clipShape(Circle())
  }

  private var didPill: some View {
    HStack(spacing: 4) {
      Image(systemName: "key")
        .font(.system(size: 9, weight: .regular))
        .frame(width: 12, height: 12)
      Text(did)
        .font(.system(size: 10))
        .lineLimit(1)
        .truncationMode(.middle)
    }
    .foregroundColor(Color.Theme.textSecondary)
    .padding(.horizontal, 4)
    .padding(.vertical, 2)
    .overlay(
      RoundedRectangle(cornerRadius: 2)
        .stroke(Color.Theme.pillBorder, lineWidth: 0.5)
    )
  }
}

// MARK: - Verified credential card (Figma 743:2981)

struct VerifiedCredentialRow: View {
  let icon: String
  let title: String
  let trustLevel: String
  let issuerType: String

  private var levelText: String {
    switch trustLevel {
    case "green": return "Level 3 - ZK Verified"
    case "blue": return "Level 2 - Fallback"
    default: return "Level 1 - Self-attested"
    }
  }

  private var levelColor: Color {
    switch trustLevel {
    case "green": return Color.Theme.terminalGreen
    case "blue": return Color.Theme.primaryBlue
    default: return Color.Theme.textTertiary
    }
  }

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      HStack(spacing: 8) {
        Image(systemName: icon)
          .font(.system(size: 14, weight: .regular))
          .foregroundColor(Color.Theme.textPrimary)
          .frame(width: 18, height: 18)

        Text(title)
          .font(.system(size: 15))
          .foregroundColor(Color.Theme.textPrimary)
          .lineLimit(1)

        Spacer(minLength: 0)

        Image(systemName: "chevron.right")
          .font(.system(size: 12, weight: .semibold))
          .foregroundColor(Color.Theme.textTertiary)
          .frame(width: 18, height: 18)
      }
      .padding(.bottom, 12)
      .overlay(alignment: .bottom) {
        Rectangle()
          .fill(Color.Theme.divider)
          .frame(height: 0.5)
      }

      HStack(spacing: 4) {
        Image(systemName: "checkmark.seal.fill")
          .font(.system(size: 11))
          .foregroundColor(levelColor)
          .frame(width: 12, height: 12)
        Text(levelText)
          .font(.system(size: 11))
          .foregroundColor(levelColor)

        Spacer(minLength: 0)

        Text(issuerType.capitalized)
          .font(.system(size: 11))
          .foregroundColor(Color.Theme.textTertiary)
      }
      .padding(.vertical, 4)
    }
    .padding(12)
    .background(
      RoundedRectangle(cornerRadius: 8)
        .fill(Color.Theme.mutedSurface)
    )
    .padding(.horizontal, 16)
  }
}

// MARK: - Action tile (Figma 737:2565: 40pt mauve bubble + label)

struct MeActionTile: View {
  let icon: String
  let title: String
  let action: () -> Void

  var body: some View {
    Button(action: action) {
      HStack(spacing: 8) {
        ZStack {
          Circle()
            .fill(Color.Theme.primaryBlue.opacity(0.15))
            .frame(width: 40, height: 40)
          Image(systemName: icon)
            .font(.system(size: 18, weight: .regular))
            .foregroundColor(Color.Theme.primaryBlue)
        }

        Text(title)
          .font(.system(size: 15))
          .foregroundColor(Color.Theme.textPrimary)
          .multilineTextAlignment(.leading)
          .lineLimit(2)
          .frame(maxWidth: .infinity, alignment: .leading)
      }
      .padding(.horizontal, 12)
      .padding(.vertical, 16)
      .frame(maxWidth: .infinity, minHeight: 72, alignment: .leading)
      .background(
        RoundedRectangle(cornerRadius: 2)
          .fill(Color.Theme.mutedSurface)
      )
    }
    .buttonStyle(.plain)
  }
}

// MARK: - Developer row (Figma 737:2755: icon + title + trailing + chevron)

struct MeDeveloperRow: View {
  let icon: String
  let title: String
  let trailingText: String?
  let action: () -> Void

  var body: some View {
    Button(action: action) {
      HStack(spacing: 8) {
        Image(systemName: icon)
          .font(.system(size: 14, weight: .regular))
          .foregroundColor(Color.Theme.textPrimary)
          .frame(width: 18, height: 18)

        Text(title)
          .font(.system(size: 15))
          .foregroundColor(Color.Theme.textPrimary)

        Spacer(minLength: 4)

        if let trailingText {
          Text(trailingText)
            .font(.system(size: 15))
            .foregroundColor(Color.Theme.textSecondary)
        }

        Image(systemName: "chevron.right")
          .font(.system(size: 12, weight: .semibold))
          .foregroundColor(Color.Theme.textTertiary)
          .frame(width: 18, height: 18)
      }
      .padding(.horizontal, 12)
      .padding(.vertical, 16)
      .background(
        RoundedRectangle(cornerRadius: 2)
          .fill(Color.Theme.mutedSurface)
      )
    }
    .buttonStyle(.plain)
  }
}

// MARK: - Disclosure row (Figma 724:22770: icon + title + src + Show)

struct DisclosureRowView: View {
  let icon: String
  let title: String
  let source: String
  let actionTitle: String
  let isLoading: Bool
  let isDisabled: Bool
  let onPresent: () -> Void

  var body: some View {
    HStack(spacing: 8) {
      Image(systemName: icon)
        .font(.system(size: 14, weight: .regular))
        .foregroundColor(Color.Theme.terminalGreen)
        .frame(width: 18, height: 18)

      VStack(alignment: .leading, spacing: 4) {
        Text(title)
          .font(.system(size: 15))
          .foregroundColor(Color.Theme.textPrimary)
        Text(source)
          .font(.system(size: 11))
          .foregroundColor(Color.Theme.textTertiary)
      }

      Spacer(minLength: 4)

      Button(action: onPresent) {
        Group {
          if isLoading {
            ProgressView()
              .progressViewStyle(CircularProgressViewStyle(tint: Color.Theme.pageBg))
              .scaleEffect(0.7)
          } else {
            Text(actionTitle)
              .font(.system(size: 13, weight: .medium))
          }
        }
        .foregroundColor(Color.Theme.pageBg)
        .padding(.horizontal, 8)
        .frame(minWidth: 56, minHeight: 28)
        .background(
          RoundedRectangle(cornerRadius: 2)
            .fill(Color.Theme.textPrimary)
        )
      }
      .buttonStyle(.plain)
      .disabled(isDisabled)
      .opacity(isDisabled && !isLoading ? 0.5 : 1)
    }
    .padding(.horizontal, 12)
    .padding(.vertical, 16)
    .background(
      RoundedRectangle(cornerRadius: 8)
        .fill(Color.Theme.mutedSurface)
    )
    .padding(.horizontal, 16)
  }
}

// MARK: - Self-initiated proof sheet

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
