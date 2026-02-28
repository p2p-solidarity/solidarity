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
}

struct SolidarityPlaceholderCard: View {
  let screenID: SolidarityScreenID
  let title: String
  let subtitle: String

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      Text(screenID.rawValue)
        .font(.caption.weight(.semibold))
        .foregroundColor(Color.Theme.primaryBlue)
      Text(title)
        .font(.subheadline.weight(.semibold))
        .foregroundColor(Color.Theme.textPrimary)
      Text(subtitle)
        .font(.caption)
        .foregroundColor(Color.Theme.textSecondary)
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .padding(12)
    .background(
      RoundedRectangle(cornerRadius: 8, style: .continuous)
        .fill(Color.Theme.cardBg)
        .overlay(
          RoundedRectangle(cornerRadius: 8, style: .continuous)
            .stroke(Color.Theme.divider, lineWidth: 0.5)
        )
    )
  }
}
