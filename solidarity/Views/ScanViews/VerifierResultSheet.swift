import SwiftUI

struct VerifierResultSheet: View {
  let result: VpTokenVerificationResult
  @Environment(\.dismiss) private var dismiss

  var body: some View {
    NavigationStack {
      VStack(spacing: 14) {
        SolidarityPlaceholderCard(
          screenID: .verifyResult,
          title: result.title,
          subtitle: result.reason
        )

        VStack(alignment: .leading, spacing: 8) {
          ForEach(result.details, id: \.self) { detail in
            Text("• \(detail)")
              .font(.caption)
              .foregroundColor(.secondary)
          }
        }
        .frame(maxWidth: .infinity, alignment: .leading)

        Button("Close") { dismiss() }
          .buttonStyle(ThemedPrimaryButtonStyle())
      }
      .padding(16)
      .navigationTitle("Verifier")
      .navigationBarTitleDisplayMode(.inline)
    }
  }
}
