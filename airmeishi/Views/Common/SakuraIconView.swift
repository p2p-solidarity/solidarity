//
//  SakuraIconView.swift
//  airmeishi
//
//  Sakura (cherry blossom) icon view for Ichigoichie feature
//

import SwiftUI

#if canImport(UIKit)
  import UIKit
#endif

struct SakuraIconView: View {
  let size: CGFloat
  let color: Color
  let isAnimating: Bool

  init(size: CGFloat = 32, color: Color = .white, isAnimating: Bool = false) {
    self.size = size
    self.color = color
    self.isAnimating = isAnimating
  }

  var body: some View {
    ZStack {
      // Sakura petals - 5 petals arranged in a circle
      ForEach(0..<5, id: \.self) { index in
        Ellipse()
          .fill(color)
          .frame(width: size * 0.28, height: size * 0.48)
          .offset(y: -size * 0.28)
          .rotationEffect(.degrees(Double(index) * 72))
          .opacity(isAnimating ? 0.95 : 0.85)
          .scaleEffect(isAnimating ? 1.0 : 0.95)
      }

      // Center circle
      Circle()
        .fill(color.opacity(0.8))
        .frame(width: size * 0.18, height: size * 0.18)
    }
    .frame(width: size, height: size)
    .animation(
      isAnimating ? .easeInOut(duration: 2.0).repeatForever(autoreverses: true) : .default,
      value: isAnimating
    )
  }
}

// MARK: - UIImage Rendering Helper for Tab Bar
extension SakuraIconView {
  #if canImport(UIKit)
    /// Renders the sakura icon as a UIImage for use in tab bars
    @available(iOS 16.0, *)
    static func renderAsImage(size: CGFloat = 19, color: UIColor = .white) -> UIImage? {
      let view = SakuraIconView(size: size, color: Color(color), isAnimating: false)
        .frame(width: size, height: size)

      let renderer = ImageRenderer(content: view)
      renderer.scale = UIScreen.main.scale

      renderer.isOpaque = false

      return renderer.uiImage
    }
  #endif
}

#Preview {
  VStack(spacing: 20) {
    SakuraIconView(size: 30, color: .pink, isAnimating: true)
    SakuraIconView(size: 24, color: .white, isAnimating: false)
    SakuraIconView(size: 40, color: .yellow, isAnimating: true)
  }
  .padding()
  .background(Color.black)
}
