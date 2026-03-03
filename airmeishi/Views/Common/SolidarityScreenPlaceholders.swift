import SwiftUI

enum SolidarityScreenID: String, CaseIterable, Identifiable {
  case onboardingWelcome = "O-1"
  case onboardingKeySetup = "O-2"
  case onboardingContactImport = "O-3"
  case onboardingPassportPrompt = "O-4"
  case onboardingComplete = "O-5"
  case passportCapture = "PP-1"
  case passportNFC = "PP-2"
  case passportProof = "PP-3"
  case passportPersist = "PP-4"
  case exchangeDiscovery = "EX-1"
  case exchangeScope = "EX-2"
  case exchangeAwaiting = "EX-3"
  case exchangeIncoming = "EX-4"
  case exchangeSign = "EX-5"
  case exchangeSaved = "EX-6"
  case scanRouter = "SC-2"
  case presentReview = "PR-1"
  case presentSigning = "PR-2"
  case presentSubmit = "PR-3"
  case presentSelfQR = "PR-1b"
  case verifyResult = "VF-1"

  var id: String { rawValue }

  /// SF Symbol name for this screen
  var iconName: String {
    switch self {
    case .onboardingWelcome: return "hand.wave"
    case .onboardingKeySetup: return "key.fill"
    case .onboardingContactImport: return "person.2.badge.plus"
    case .onboardingPassportPrompt: return "wallet.pass"
    case .onboardingComplete: return "checkmark.seal.fill"
    case .passportCapture: return "camera.fill"
    case .passportNFC: return "wave.3.left.circle.fill"
    case .passportProof: return "shield.checkerboard"
    case .passportPersist: return "lock.doc.fill"
    case .exchangeDiscovery: return "antenna.radiowaves.left.and.right"
    case .exchangeScope: return "checklist"
    case .exchangeAwaiting: return "clock.fill"
    case .exchangeIncoming: return "arrow.down.circle.fill"
    case .exchangeSign: return "signature"
    case .exchangeSaved: return "checkmark.circle.fill"
    case .scanRouter: return "qrcode.viewfinder"
    case .presentReview: return "doc.text.magnifyingglass"
    case .presentSigning: return "pencil.and.outline"
    case .presentSubmit: return "paperplane.fill"
    case .presentSelfQR: return "qrcode"
    case .verifyResult: return "checkmark.shield.fill"
    }
  }

  /// Accent color category for icon tinting
  var accentColor: Color {
    switch self {
    case .onboardingWelcome, .onboardingKeySetup,
      .onboardingContactImport, .onboardingPassportPrompt,
      .onboardingComplete:
      return Color.Theme.primaryBlue
    case .passportCapture, .passportNFC,
      .passportProof, .passportPersist:
      return Color.Theme.dustyMauve
    case .exchangeDiscovery, .exchangeScope,
      .exchangeAwaiting, .exchangeIncoming,
      .exchangeSign, .exchangeSaved:
      return Color.Theme.accentRose
    case .scanRouter, .presentReview,
      .presentSigning, .presentSubmit,
      .presentSelfQR:
      return Color.Theme.dustyMauve
    case .verifyResult:
      return .green
    }
  }
}

struct SolidarityPlaceholderCard: View {
  let screenID: SolidarityScreenID
  let title: String
  let subtitle: String

  var body: some View {
    HStack(spacing: 14) {
      // Icon circle
      Circle()
        .fill(screenID.accentColor.opacity(0.12))
        .frame(width: 40, height: 40)
        .overlay(
          Image(systemName: screenID.iconName)
            .font(.system(size: 18, weight: .semibold))
            .foregroundColor(screenID.accentColor)
        )

      // Text content
      VStack(alignment: .leading, spacing: 4) {
        Text(title)
          .font(.subheadline.weight(.semibold))
          .foregroundColor(Color.Theme.textPrimary)
        Text(subtitle)
          .font(.caption)
          .foregroundColor(Color.Theme.textSecondary)
          .lineLimit(2)
      }

      Spacer(minLength: 0)
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .padding(14)
    .background(
      RoundedRectangle(cornerRadius: 12, style: .continuous)
        .fill(Color.Theme.cardBg)
        .overlay(
          RoundedRectangle(cornerRadius: 12, style: .continuous)
            .stroke(Color.Theme.divider, lineWidth: 0.5)
        )
    )
  }
}
