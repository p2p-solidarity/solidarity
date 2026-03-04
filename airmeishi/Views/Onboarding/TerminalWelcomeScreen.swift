import SwiftUI

struct TerminalWelcomeScreen: View {
  let onNext: () -> Void
  @State private var displayedText = ""
  private let fullText = "Welcome to\nyour new social\nexperiment"
  @State private var showSubtitle = false
  @State private var showNext = false

  var body: some View {
    VStack {
      Spacer()

      VStack(alignment: .leading, spacing: 16) {
        Text(displayedText)
          .font(.system(size: 32, weight: .bold, design: .default))
          .foregroundColor(.white)
          .multilineTextAlignment(.leading)
          .frame(maxWidth: .infinity, alignment: .leading)

        if showSubtitle {
          Text("It's good to have you here <3\nLet's set up your profile...")
            .font(.system(size: 14, weight: .regular))
            .foregroundColor(Color.Theme.textSecondary)
            .multilineTextAlignment(.leading)
            .transition(.opacity)
        }
      }
      .padding(.horizontal, 32)

      Spacer()

      if showNext {
        Button(action: {
          HapticFeedbackManager.shared.heavyImpact()
          onNext()
        }) {
          Text("Begin")
            .font(.system(size: 18, weight: .bold, design: .monospaced))
            .frame(maxWidth: .infinity)
            .padding()
            .background(Color.white)
            .foregroundColor(.black)
            .clipShape(Rectangle())
        }
        .padding(.horizontal, 32)
        .padding(.bottom, 48)
        .transition(.move(edge: .bottom).combined(with: .opacity))
      }
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .background(Color.Theme.pageBg.ignoresSafeArea())
    .onAppear(perform: startTyping)
  }

  private func startTyping() {
    let characters = Array(fullText)
    var index = 0

    Timer.scheduledTimer(withTimeInterval: 0.05, repeats: true) { timer in
      if index < characters.count {
        displayedText.append(characters[index])
        index += 1
        HapticFeedbackManager.shared.softImpact()
      } else {
        timer.invalidate()
        withAnimation(.easeIn(duration: 0.8)) {
          showSubtitle = true
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.2) {
          withAnimation(.spring()) {
            showNext = true
          }
        }
      }
    }
  }
}

#Preview {
  TerminalWelcomeScreen(onNext: {})
}
