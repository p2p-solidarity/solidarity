//
//  MatchingOrbitView.swift
//  solidarity
//
//  Lightweight orbit animation used on the simplified Match screen
//

import SwiftUI

struct MatchingOrbitView: View {
  var body: some View {
    MatchingView()
  }
}

#Preview {
  ZStack {
    Color.Theme.pageBg.ignoresSafeArea()
    MatchingOrbitView().frame(width: 300, height: 300)
  }
}
