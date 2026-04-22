//
//  MauvePetalMotif.swift
//  solidarity
//
//  Decorative watermark used behind hero/profile cards in the new
//  Person detail design. Two overlapping 4-petal flower silhouettes
//  drawn with the `dustyMauve` theme token at ~10% opacity. The
//  motif is non-interactive and visually abstract — it is intentionally
//  not a pixel-perfect match with the Pencil source vector.
//

import SwiftUI

struct MauvePetalMotif: View {
  /// Base tint; defaults to the design system's dusty mauve.
  var color: Color = Color.Theme.dustyMauve
  /// Overall opacity of the motif; design ask is ~10%.
  var opacity: Double = 0.10

  var body: some View {
    GeometryReader { geo in
      let width = geo.size.width
      let height = geo.size.height
      let petalWidth: CGFloat = max(48, width * 0.22)
      let petalHeight: CGFloat = max(92, height * 0.28)

      ZStack {
        // Upper flower — shifted slightly right of center.
        flower(petalWidth: petalWidth, petalHeight: petalHeight)
          .frame(width: width * 0.62, height: height * 0.50)
          .position(x: width * 0.56, y: height * 0.33)

        // Lower flower — mirrored and shifted left to interleave.
        flower(petalWidth: petalWidth, petalHeight: petalHeight)
          .frame(width: width * 0.62, height: height * 0.50)
          .rotationEffect(.degrees(180))
          .position(x: width * 0.44, y: height * 0.72)
      }
      .foregroundStyle(color.opacity(opacity))
    }
  }

  /// A single 4-petal silhouette — four long ellipses radiating from
  /// center at 0/90/180/270 degrees.
  private func flower(petalWidth: CGFloat, petalHeight: CGFloat) -> some View {
    ZStack {
      ForEach(0..<4, id: \.self) { index in
        Capsule()
          .fill(Color.black)  // tint applied by parent foregroundStyle
          .frame(width: petalWidth, height: petalHeight)
          .offset(y: -petalHeight * 0.42)
          .rotationEffect(.degrees(Double(index) * 90))
      }
    }
  }
}

#Preview {
  ZStack {
    LinearGradient(
      colors: [Color.Theme.gradientLavender, Color.Theme.gradientPeach],
      startPoint: .top,
      endPoint: .bottom
    )
    MauvePetalMotif()
  }
  .frame(width: 361, height: 520)
  .cornerRadius(4)
  .padding()
}
