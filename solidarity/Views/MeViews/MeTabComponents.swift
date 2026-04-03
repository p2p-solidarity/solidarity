import SwiftUI

struct PreparedSelfInitiatedProof: Identifiable {
  let id = UUID().uuidString
  let claim: ProvableClaimEntity
  let qrImage: UIImage
}

struct ClaimRowView: View {
  let title: String
  let source: String
  let actionTitle: String
  let isLoading: Bool
  let isDisabled: Bool
  let onPresent: () -> Void

  var body: some View {
    HStack(spacing: 12) {
      VStack(alignment: .leading, spacing: 6) {
        Text(title)
          .font(.system(size: 16, weight: .bold))
          .foregroundColor(Color.Theme.textPrimary)
        Text(source)
          .font(.system(size: 10, weight: .bold, design: .monospaced))
          .foregroundColor(Color.Theme.textSecondary)
      }
      Spacer()
      Button(action: onPresent) {
        Group {
          if isLoading {
            ProgressView()
              .progressViewStyle(CircularProgressViewStyle(tint: Color.Theme.textPrimary))
              .scaleEffect(0.8)
          } else {
            Text(actionTitle)
              .font(.system(size: 12, weight: .bold, design: .monospaced))
          }
        }
        .foregroundColor(Color.Theme.textPrimary)
        .frame(minWidth: 72)
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(Color.Theme.pageBg)
        .overlay(Rectangle().stroke(Color.Theme.divider, lineWidth: 1))
      }
      .disabled(isDisabled)
      .opacity(isDisabled && !isLoading ? 0.5 : 1)
    }
    .padding(16)
    .background(Color.Theme.cardBg)
    .overlay(Rectangle().stroke(Color.Theme.divider, lineWidth: 1))
    .padding(.horizontal, 16)
  }
}

struct IdentityStatusCard: View {
  let emoji: String
  let title: String
  let trustText: String
  let subtitle: String
  let ctaTitle: String
  var onCTA: (() -> Void)?

  var body: some View {
    VStack(alignment: .leading, spacing: 12) {
      HStack {
        Text("\(emoji) \(title)")
          .font(.system(size: 16, weight: .bold))
          .foregroundColor(Color.Theme.textPrimary)
        Spacer()
        if let onCTA {
          Button(action: onCTA) {
            Text(ctaTitle)
              .font(.system(size: 10, weight: .bold, design: .monospaced))
              .foregroundColor(.black)
              .padding(.horizontal, 10)
              .padding(.vertical, 6)
              .background(Color.Theme.terminalGreen)
          }
          .buttonStyle(.plain)
        } else {
          Image(systemName: "chevron.right")
            .font(.system(size: 10, weight: .bold))
            .foregroundColor(Color.Theme.textTertiary)
        }
      }

      Rectangle()
        .fill(Color.Theme.divider)
        .frame(height: 1)

      HStack {
        Text(trustText)
          .font(.system(size: 10, weight: .bold, design: .monospaced))
          .foregroundColor(Color.Theme.terminalGreen)
        Spacer()
        Text(subtitle.uppercased())
          .font(.system(size: 10, weight: .bold, design: .monospaced))
          .foregroundColor(Color.Theme.textTertiary)
      }
    }
    .padding(16)
    .background(Color.Theme.cardBg)
    .overlay(Rectangle().stroke(Color.Theme.divider, lineWidth: 1))
    .padding(.horizontal, 16)
  }
}

struct EmptyMeStateCard: View {
  let title: String
  let subtitle: String
  let primaryTitle: String
  let secondaryTitle: String
  let onPrimaryTap: () -> Void
  let onSecondaryTap: () -> Void

  var body: some View {
    VStack(spacing: 24) {
      Image(systemName: "lock.shield")
        .font(.system(size: 48))
        .foregroundColor(Color.Theme.textTertiary)

      VStack(spacing: 8) {
        Text(title.uppercased())
          .font(.system(size: 16, weight: .bold, design: .monospaced))
          .foregroundColor(Color.Theme.textPrimary)
        Text(subtitle)
          .font(.system(size: 14))
          .foregroundColor(Color.Theme.textSecondary)
          .multilineTextAlignment(.center)
      }

      VStack(spacing: 12) {
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
    .padding(24)
    .frame(maxWidth: .infinity)
    .background(Color.Theme.searchBg)
    .overlay(Rectangle().stroke(Color.Theme.textTertiary, style: StrokeStyle(lineWidth: 1, dash: [4, 4])))
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
              .foregroundColor(.white)
          }
        }
      }
    }
  }
}
