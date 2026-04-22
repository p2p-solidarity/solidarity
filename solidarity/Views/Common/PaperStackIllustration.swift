//
//  PaperStackIllustration.swift
//  solidarity
//
//  Empty-state artwork reproducing Pencil node `TruU1` in solidarity.pen.
//  Two cream papers with a cast parallelogram shadow and a folded corner.
//
//  Paper fill: #fbf9f2, ink/shadow: #2f2f30. Canvas is 214×214.
//

import SwiftUI

struct PaperStackIllustration: View {
  private let paperFill = Color(red: 0.984, green: 0.976, blue: 0.949)
  private let ink = Color(red: 0.184, green: 0.184, blue: 0.188)

  private let base: CGFloat = 214

  var body: some View {
    GeometryReader { geo in
      let s = min(geo.size.width, geo.size.height) / base
      ZStack(alignment: .topLeading) {
        Vector14Shape()
          .fill(ink)
          .frame(width: 86.34 * s, height: 41.47 * s)
          .offset(x: 83.10 * s, y: 130.71 * s)

        Shadow1Shape()
          .fill(ink)
          .frame(width: 120 * s, height: 39.60 * s)
          .offset(x: 28.70 * s, y: 114.80 * s)

        Paper2Shape()
          .fill(paperFill)
          .overlay(Paper2Shape().stroke(ink, lineWidth: 1))
          .frame(width: 89.95 * s, height: 120.99 * s)
          .offset(x: 58.05 * s, y: 32.44 * s)

        Paper1Shape()
          .fill(paperFill)
          .overlay(Paper1Shape().stroke(ink, lineWidth: 1))
          .frame(width: 92.05 * s, height: 120.96 * s)
          .offset(x: 89.17 * s, y: 49.79 * s)

        Shadow2Shape()
          .fill(ink)
          .frame(width: 28.31 * s, height: 94.21 * s)
          .offset(x: 72.79 * s, y: 57.39 * s)

        CornerShape()
          .fill(ink)
          .frame(width: 12.53 * s, height: 12.49 * s)
          .offset(x: 152.30 * s, y: 56.40 * s)
      }
      .frame(width: geo.size.width, height: geo.size.height, alignment: .topLeading)
    }
    .aspectRatio(1, contentMode: .fit)
  }
}

// MARK: - Path shapes (native coords from solidarity.pen / TruU1)

private struct Vector14Shape: Shape {
  func path(in rect: CGRect) -> Path {
    let sx = rect.width / 107.925
    let sy = rect.height / 51.838
    var p = Path()
    p.move(to: CGPoint(x: 107.925 * sx, y: 19.203 * sy))
    p.addLine(to: CGPoint(x: 24.170 * sx, y: 51.838 * sy))
    p.addLine(to: CGPoint(x: 0, y: 26.609 * sy))
    p.addLine(to: CGPoint(x: 97.327 * sx, y: 0))
    p.addLine(to: CGPoint(x: 107.925 * sx, y: 0))
    p.closeSubpath()
    return p
  }
}

private struct Shadow1Shape: Shape {
  func path(in rect: CGRect) -> Path {
    let sx = rect.width / 150
    let sy = rect.height / 49.5
    var p = Path()
    p.move(to: CGPoint(x: 146.543 * sx, y: 3.958 * sy))
    p.addLine(to: CGPoint(x: 54 * sx, y: 49.5 * sy))
    p.addLine(to: CGPoint(x: 0, y: 0))
    p.addLine(to: CGPoint(x: 150 * sx, y: 0))
    p.closeSubpath()
    return p
  }
}

private struct Paper2Shape: Shape {
  func path(in rect: CGRect) -> Path {
    let sx = rect.width / 74.959
    let sy = rect.height / 100.832
    var p = Path()
    p.move(to: CGPoint(x: 0, y: 0))
    p.addLine(to: CGPoint(x: 12.194 * sx, y: 100.832 * sy))
    p.addLine(to: CGPoint(x: 74.959 * sx, y: 92.104 * sy))
    p.addLine(to: CGPoint(x: 62.637 * sx, y: 5.850 * sy))
    p.closeSubpath()
    return p
  }
}

private struct Paper1Shape: Shape {
  func path(in rect: CGRect) -> Path {
    let sx = rect.width / 115.056
    let sy = rect.height / 151.202
    var p = Path()
    p.move(to: CGPoint(x: 17.943 * sx, y: 151.202 * sy))
    p.addLine(to: CGPoint(x: 0, y: 0))
    p.addLine(to: CGPoint(x: 78.568 * sx, y: 7.297 * sy))
    p.addLine(to: CGPoint(x: 94.945 * sx, y: 23.674 * sy))
    p.addLine(to: CGPoint(x: 115.056 * sx, y: 135.300 * sy))
    p.closeSubpath()
    // Folded-corner detail strokes (no enclosed area — stroke only)
    p.move(to: CGPoint(x: 82.435 * sx, y: 22.510 * sy))
    p.addLine(to: CGPoint(x: 94.944 * sx, y: 23.674 * sy))
    p.move(to: CGPoint(x: 78.567 * sx, y: 7.297 * sy))
    p.addLine(to: CGPoint(x: 82.435 * sx, y: 22.510 * sy))
    return p
  }
}

private struct Shadow2Shape: Shape {
  func path(in rect: CGRect) -> Path {
    let sx = rect.width / 35.383
    let sy = rect.height / 117.766
    var p = Path()
    p.move(to: CGPoint(x: 0, y: 0))
    p.addLine(to: CGPoint(x: 22.372 * sx, y: 1.580 * sy))
    p.addLine(to: CGPoint(x: 35.383 * sx, y: 116.266 * sy))
    p.addLine(to: CGPoint(x: 12.883 * sx, y: 117.766 * sy))
    p.closeSubpath()
    return p
  }
}

private struct CornerShape: Shape {
  func path(in rect: CGRect) -> Path {
    let sx = rect.width / 10.444
    let sy = rect.height / 10.410
    var p = Path()
    p.move(to: CGPoint(x: 0, y: 0))
    p.addLine(to: CGPoint(x: 2.240 * sx, y: 9.479 * sy))
    p.addLine(to: CGPoint(x: 10.444 * sx, y: 10.410 * sy))
    p.closeSubpath()
    return p
  }
}

#Preview {
  ZStack {
    Color(red: 0.984, green: 0.976, blue: 0.949).ignoresSafeArea()
    PaperStackIllustration()
      .frame(width: 214, height: 214)
  }
}
