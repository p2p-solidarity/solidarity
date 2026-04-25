//
//  MauvePetalMotif.swift
//  solidarity
//
//  Decorative watermark behind the Person-detail hero. Mirrors the
//  Figma SVG (node 723:2352 / 723:2357): four horseshoe arches laid
//  out in a 127.562 × 134.735 viewbox and stamped twice across the
//  hero — once at the left (inset off-edge) and once at the right,
//  horizontally mirrored. Rendered at 10 % opacity in `dustyMauve`
//  so the gradient underneath still reads through.
//

import SwiftUI

struct MauvePetalMotif: View {
  var color: Color = Color.Theme.dustyMauve
  var opacity: Double = 0.10

  var body: some View {
    GeometryReader { geo in
      // Figma hero card is 361pt wide; petals are 127.562 × 134.735
      // anchored at x ≈ -20 (left) / 263 (right), y ≈ 16–18.
      let cardW = max(geo.size.width, 1)
      let flowerW = cardW * (127.562 / 361.0)
      let flowerH = flowerW * (134.735 / 127.562)
      let topInset: CGFloat = cardW * (16.26 / 361.0)
      let leftX: CGFloat = cardW * (-20.0 / 361.0)
      let rightX: CGFloat = cardW * (263.0 / 361.0)

      ZStack(alignment: .topLeading) {
        MauvePetalFlower()
          .fill(color)
          .frame(width: flowerW, height: flowerH)
          .offset(x: leftX, y: topInset)

        MauvePetalFlower(mirrored: true)
          .fill(color)
          .frame(width: flowerW, height: flowerH)
          .offset(x: rightX, y: topInset)
      }
      .opacity(opacity)
    }
  }
}

/// Four horseshoe arches matching the Figma petal SVG. The raw
/// coordinate system is the SVG's 127.562 × 134.735 viewBox; the
/// shape scales uniformly to whatever rect it is placed in.
private struct MauvePetalFlower: Shape {
  /// Horizontally mirror for the right-hand side of the motif.
  var mirrored: Bool = false

  func path(in rect: CGRect) -> Path {
    // The motif's aspect ratio is locked by MauvePetalMotif, so sx
    // and sy match — use sx for both position and radius scaling.
    let vbW: CGFloat = 127.562
    let vbH: CGFloat = 134.735
    let sx = rect.width / vbW
    let sy = rect.height / vbH

    // Outer / inner radius (from SVG: outer Ø ≈ 72.7, inner Ø ≈ 36.2).
    let outerR: CGFloat = 36.35
    let innerR: CGFloat = 18.10

    // Each horseshoe's baseline midpoint in SVG space.
    // `peakUp = true` → arch curves upward (toward y = 0).
    let arches: [(cx: CGFloat, cy: CGFloat, peakUp: Bool)] = [
      (37.36, 38.11, true),  // Ellipse 291 — top, peak up
      (91.21, 97.24, true),  // Ellipse 292 — middle-right, peak up
      (36.35, 96.63, false),  // Ellipse 293 — bottom-left, peak down
      (56.58, 42.93, false),  // Ellipse 294 — center, peak down
    ]

    var path = Path()
    for a in arches {
      let cx = mirrored ? (vbW - a.cx) : a.cx
      path.addPath(
        Self.horseshoe(
          center: CGPoint(x: cx * sx, y: a.cy * sy),
          outerR: outerR * sx,
          innerR: innerR * sx,
          peakUp: a.peakUp
        ))
    }
    return path
  }

  /// A single horseshoe: outer semicircle + inner semicircle sharing
  /// a flat baseline through `center`. `peakUp` flips the opening
  /// direction (baseline is always horizontal in SVG space).
  private static func horseshoe(
    center: CGPoint, outerR: CGFloat, innerR: CGFloat, peakUp: Bool
  ) -> Path {
    var path = Path()
    let steps = 48
    // SwiftUI y-down convention: -π/2 points up, +π/2 points down.
    let peakRad: CGFloat = peakUp ? -.pi / 2 : .pi / 2
    let startRad = peakRad + .pi / 2

    // Outer arc: half-circle from one baseline end, through peak,
    // to the other baseline end.
    for i in 0...steps {
      let t = CGFloat(i) / CGFloat(steps)
      let angle = startRad - t * .pi
      let p = CGPoint(
        x: center.x + outerR * cos(angle),
        y: center.y + outerR * sin(angle)
      )
      if i == 0 { path.move(to: p) } else { path.addLine(to: p) }
    }

    // Step across to the inner baseline, then trace inner arc back.
    let innerStart = startRad - .pi
    path.addLine(
      to: CGPoint(
        x: center.x + innerR * cos(innerStart),
        y: center.y + innerR * sin(innerStart)
      ))
    for i in 0...steps {
      let t = CGFloat(i) / CGFloat(steps)
      let angle = innerStart + t * .pi
      let p = CGPoint(
        x: center.x + innerR * cos(angle),
        y: center.y + innerR * sin(angle)
      )
      path.addLine(to: p)
    }
    path.closeSubpath()
    return path
  }
}

#Preview {
  ZStack {
    LinearGradient(
      stops: [
        .init(color: Color.Theme.gradientLavender, location: 0.36),
        .init(color: Color.Theme.gradientPeach, location: 0.68),
      ],
      startPoint: UnitPoint(x: 0.35, y: 0.98),
      endPoint: UnitPoint(x: 0.65, y: 0.02)
    )
    MauvePetalMotif()
  }
  .frame(width: 361, height: 260)
  .cornerRadius(4)
  .padding()
}
