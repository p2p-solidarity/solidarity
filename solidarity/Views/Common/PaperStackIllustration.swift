//
//  PaperStackIllustration.swift
//  solidarity
//
//  Empty-state artwork — Figma `document` (node 723:2292). Two leaning
//  papers (cream fill, black outline) with a cast shadow wedge and
//  five horizontal text lines on the front sheet. Canvas 214×214.
//

import SwiftUI

struct PaperStackIllustration: View {
  private let paperFill = Color(red: 0.984, green: 0.976, blue: 0.949)  // #FBF9F2
  private let ink = Color(red: 0.184, green: 0.184, blue: 0.188)         // #2F2F30

  private let base: CGFloat = 214

  var body: some View {
    GeometryReader { geo in
      let s = min(geo.size.width, geo.size.height) / base
      ZStack(alignment: .topLeading) {
        Vector14Shape(s: s).fill(ink)
        Shadow1Shape(s: s).fill(ink)

        Paper2Shape(s: s).fill(paperFill)
        Paper2Shape(s: s).stroke(ink, lineWidth: 1)

        Shadow2Shape(s: s).fill(ink)

        Paper1FillShape(s: s).fill(paperFill)
        Paper1StrokeShape(s: s).stroke(ink, lineWidth: 1)

        TextShape(s: s).fill(ink)
        CornerShape(s: s).fill(ink)
      }
      .frame(width: geo.size.width, height: geo.size.height, alignment: .topLeading)
    }
    .aspectRatio(1, contentMode: .fit)
  }
}

// MARK: - Shapes (coords in native 214×214 space; scaled by `s`)

private struct Vector14Shape: Shape {
  let s: CGFloat
  func path(in _: CGRect) -> Path {
    var p = Path()
    p.move(to: CGPoint(x: 102.436 * s, y: 172.183 * s))
    p.addLine(to: CGPoint(x: 169.44 * s, y: 146.075 * s))
    p.addLine(to: CGPoint(x: 169.44 * s, y: 130.712 * s))
    p.addLine(to: CGPoint(x: 160.961 * s, y: 130.712 * s))
    p.addLine(to: CGPoint(x: 83.1 * s, y: 152 * s))
    p.closeSubpath()
    return p
  }
}

private struct Shadow1Shape: Shape {
  let s: CGFloat
  func path(in _: CGRect) -> Path {
    var p = Path()
    p.move(to: CGPoint(x: 71.9 * s, y: 154.4 * s))
    p.addLine(to: CGPoint(x: 145.934 * s, y: 117.966 * s))
    p.addLine(to: CGPoint(x: 148.7 * s, y: 114.8 * s))
    p.addLine(to: CGPoint(x: 121.152 * s, y: 114.8 * s))
    p.addLine(to: CGPoint(x: 28.7 * s, y: 114.8 * s))
    p.closeSubpath()
    return p
  }
}

private struct Paper2Shape: Shape {
  let s: CGFloat
  func path(in _: CGRect) -> Path {
    var p = Path()
    p.move(to: CGPoint(x: 72.6785 * s, y: 153.442 * s))
    p.addLine(to: CGPoint(x: 58.0461 * s, y: 32.4434 * s))
    p.addLine(to: CGPoint(x: 133.21 * s, y: 39.4632 * s))
    p.addLine(to: CGPoint(x: 147.997 * s, y: 142.968 * s))
    p.closeSubpath()
    return p
  }
}

private struct Paper1FillShape: Shape {
  let s: CGFloat
  func path(in _: CGRect) -> Path {
    var p = Path()
    p.move(to: CGPoint(x: 103.524 * s, y: 170.754 * s))
    p.addLine(to: CGPoint(x: 89.1694 * s, y: 49.7925 * s))
    p.addLine(to: CGPoint(x: 152.024 * s, y: 55.6301 * s))
    p.addLine(to: CGPoint(x: 165.126 * s, y: 68.7317 * s))
    p.addLine(to: CGPoint(x: 181.214 * s, y: 158.032 * s))
    p.closeSubpath()
    return p
  }
}

private struct Paper1StrokeShape: Shape {
  let s: CGFloat
  func path(in _: CGRect) -> Path {
    var p = Path()
    p.move(to: CGPoint(x: 152.024 * s, y: 55.6301 * s))
    p.addLine(to: CGPoint(x: 89.1694 * s, y: 49.7925 * s))
    p.addLine(to: CGPoint(x: 103.524 * s, y: 170.754 * s))
    p.addLine(to: CGPoint(x: 181.214 * s, y: 158.032 * s))
    p.addLine(to: CGPoint(x: 165.126 * s, y: 68.7317 * s))
    // Folded-corner triangle
    p.move(to: CGPoint(x: 152.024 * s, y: 55.6301 * s))
    p.addLine(to: CGPoint(x: 155.118 * s, y: 67.8007 * s))
    p.addLine(to: CGPoint(x: 165.126 * s, y: 68.7317 * s))
    return p
  }
}

private struct Shadow2Shape: Shape {
  let s: CGFloat
  func path(in _: CGRect) -> Path {
    var p = Path()
    p.move(to: CGPoint(x: 72.7937 * s, y: 57.3872 * s))
    p.addLine(to: CGPoint(x: 83.1 * s, y: 151.6 * s))
    p.addLine(to: CGPoint(x: 101.1 * s, y: 150.4 * s))
    p.addLine(to: CGPoint(x: 90.6914 * s, y: 58.6508 * s))
    p.closeSubpath()
    return p
  }
}

private struct TextShape: Shape {
  let s: CGFloat
  func path(in _: CGRect) -> Path {
    var p = Path()
    let lines: [[(CGFloat, CGFloat)]] = [
      [(143.348, 77.5303), (104.467, 76.1001), (105.099, 81.1025), (143.947, 81.945)],
      [(106.854, 94.9918), (107.288, 98.4327), (157.263, 97.6252), (156.778, 94.6089)],
      [(158.497, 105.293), (157.966, 101.994), (107.901, 103.279), (108.346, 106.805)],
      [(108.751, 110.011), (109.205, 113.604), (159.442, 111.168), (158.922, 107.938)],
      [(139.366, 118.474), (138.895, 115.088), (109.616, 116.861), (110.079, 120.521)],
    ]
    for quad in lines {
      p.move(to: CGPoint(x: quad[0].0 * s, y: quad[0].1 * s))
      for pt in quad.dropFirst() {
        p.addLine(to: CGPoint(x: pt.0 * s, y: pt.1 * s))
      }
      p.closeSubpath()
    }
    return p
  }
}

private struct CornerShape: Shape {
  let s: CGFloat
  func path(in _: CGRect) -> Path {
    var p = Path()
    p.move(to: CGPoint(x: 154.989 * s, y: 67.7745 * s))
    p.addLine(to: CGPoint(x: 152.3 * s, y: 56.3999 * s))
    p.addLine(to: CGPoint(x: 164.833 * s, y: 68.8913 * s))
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
