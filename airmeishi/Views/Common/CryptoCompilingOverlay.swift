import SwiftUI

/// An overlay that simulates the intense "computation" of generating a Zero-Knowledge Proof.
/// Uses terminal aesthetics, rapid string generation, and haptic feedback to build anticipation.
struct CryptoCompilingOverlay: View {
  @Binding var isPresented: Bool
  var onCompletion: (() -> Void)? = nil
  
  @State private var phase: AnimationPhase = .preparing
  @State private var scrollingHashes: [String] = []
  @State private var timer: Timer?
  
  enum AnimationPhase {
    case preparing
    case compiling
    case verified
  }
  
  var body: some View {
    ZStack {
      // Background dimmer
      Color.Theme.pageBg.opacity(0.95)
        .ignoresSafeArea()
      
      VStack(spacing: 32) {
        
        // Status Text (Typewriter / Blinking)
        HStack {
          Text(statusText)
            .font(.system(size: 24, weight: .bold, design: .monospaced))
            .foregroundColor(statusColor)
          
          if phase != .verified {
            Rectangle()
              .fill(Color.Theme.primaryBlue)
              .frame(width: 12, height: 24)
              .opacity(phase == .preparing ? 0 : 1)
              .animation(Animation.easeInOut(duration: 0.3).repeatForever(), value: phase)
          }
        }
        
        // Scrolling Hashes
        if phase == .compiling {
          ScrollViewReader { proxy in
            ScrollView {
              VStack(alignment: .leading, spacing: 4) {
                ForEach(scrollingHashes.indices, id: \.self) { index in
                  Text(scrollingHashes[index])
                    .font(.system(size: 14, weight: .regular, design: .monospaced))
                    .foregroundColor(Color.Theme.textTertiary)
                    .lineLimit(1)
                    .id(index)
                }
              }
              .frame(maxWidth: .infinity, alignment: .leading)
              .padding(16)
            }
            .frame(height: 200)
            .background(Color.black)
            .overlay(
              Rectangle()
                .stroke(Color.Theme.divider, lineWidth: 1)
            )
            .onChange(of: scrollingHashes.count) { _ in
              withAnimation {
                proxy.scrollTo(scrollingHashes.count - 1, anchor: .bottom)
              }
            }
          }
        }
        
        // Large Verified Badge
        if phase == .verified {
          Text("[ VERIFIED ]")
            .font(.system(size: 48, weight: .black, design: .monospaced))
            .foregroundColor(Color.Theme.terminalGreen)
            .shadow(color: Color.Theme.terminalGreen.opacity(0.6), radius: 10, x: 0, y: 0)
            .transition(.scale(scale: 0.5).combined(with: .opacity))
        }
      }
      .padding(24)
    }
    .onAppear(perform: startSequence)
    .onDisappear {
      timer?.invalidate()
    }
  }
  
  private var statusText: String {
    switch phase {
    case .preparing: return "Initializing Circuit..."
    case .compiling: return "Generating ZK Proof..."
    case .verified: return "Proof Accepted."
    }
  }
  
  private var statusColor: Color {
    switch phase {
    case .preparing: return Color.Theme.textPrimary
    case .compiling: return Color.Theme.primaryBlue
    case .verified: return Color.Theme.terminalGreen
    }
  }
  
  private func startSequence() {
    // 1. Preparing
    phase = .preparing
    HapticFeedbackManager.shared.rigidImpact()
    
    // 2. Compiling (after 0.8s)
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.8) {
      guard isPresented else { return }
      phase = .compiling
      startHashGeneration()
    }
    
    // 3. Verified (after 3.5s)
    DispatchQueue.main.asyncAfter(deadline: .now() + 3.5) {
      guard isPresented else { return }
      timer?.invalidate()
      withAnimation(.spring(response: 0.4, dampingFraction: 0.6)) {
        phase = .verified
      }
      HapticFeedbackManager.shared.successNotification()
      
      // Auto-dismiss or call completion
      DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) {
        if isPresented {
          isPresented = false
          onCompletion?()
        }
      }
    }
  }
  
  private func startHashGeneration() {
    timer = Timer.scheduledTimer(withTimeInterval: 0.05, repeats: true) { _ in
      let randomLength = Int.random(in: 24...48)
      let hexChars = "0123456789abcdef"
      let newHash = "0x" + String((0..<randomLength).map { _ in hexChars.randomElement()! })
      
      scrollingHashes.append(newHash)
      if scrollingHashes.count > 40 {
        scrollingHashes.removeFirst()
      }
      
      // Light haptics for crunching
      if Int.random(in: 0...3) == 0 {
        HapticFeedbackManager.shared.softImpact()
      }
    }
  }
}

// MARK: - View Modifier for Easy Presentation

struct CryptoCompilingModifier: ViewModifier {
  @Binding var isPresented: Bool
  var onCompletion: (() -> Void)?
  
  func body(content: Content) -> some View {
    ZStack {
      content
      
      if isPresented {
        CryptoCompilingOverlay(isPresented: $isPresented, onCompletion: onCompletion)
          .transition(.opacity)
          .zIndex(100)
      }
    }
    .animation(.easeInOut(duration: 0.2), value: isPresented)
  }
}

extension View {
  /// Presents the ZK Compiling animation overlay
  func cryptoCompilingOverlay(isPresented: Binding<Bool>, onCompletion: (() -> Void)? = nil) -> some View {
    self.modifier(CryptoCompilingModifier(isPresented: isPresented, onCompletion: onCompletion))
  }
}

#Preview {
  CryptoCompilingOverlay(isPresented: .constant(true))
}
