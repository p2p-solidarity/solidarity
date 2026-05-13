import SwiftUI

struct PresentationChunkPlaybackControls: View {
  let currentIndex: Int
  let totalCount: Int
  let isPaused: Bool
  let onPrevious: () -> Void
  let onTogglePlayback: () -> Void
  let onNext: () -> Void

  var body: some View {
    VStack(spacing: 10) {
      HStack {
        Text("Chunk \(currentIndex + 1) of \(totalCount)")
          .font(.system(size: 12, weight: .medium))
          .foregroundStyle(Color.Theme.textSecondary)
        Spacer()
        Text("Offline transfer")
          .font(.system(size: 12, weight: .medium))
          .foregroundStyle(Color.Theme.terminalGreen)
      }

      ProgressView(value: Double(currentIndex + 1), total: Double(totalCount))
        .tint(Color.Theme.terminalGreen)

      HStack(spacing: 18) {
        Button(action: onPrevious) {
          Image(systemName: "chevron.left")
        }
        .accessibilityLabel("Previous chunk")

        Button(action: onTogglePlayback) {
          Image(systemName: isPaused ? "play.fill" : "pause.fill")
        }
        .accessibilityLabel(isPaused ? "Resume chunks" : "Pause chunks")

        Button(action: onNext) {
          Image(systemName: "chevron.right")
        }
        .accessibilityLabel("Next chunk")
      }
      .buttonStyle(.bordered)
      .tint(Color.Theme.terminalGreen)

      Text("The verifier can scan these frames in any order.")
        .font(.system(size: 12))
        .foregroundStyle(Color.Theme.textSecondary)
        .multilineTextAlignment(.center)
    }
    .padding(.horizontal, 20)
  }
}
