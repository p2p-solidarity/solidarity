//
//  ContentView.swift
//  airmeishi
//
//  Main app content view with business card management
//

import SwiftUI

struct ContentView: View {
  @AppStorage("solidarity.onboarding.completed") private var onboardingCompleted = false

  var body: some View {
    Group {
      if onboardingCompleted {
        MainTabView()
      } else {
        OnboardingFlowView()
      }
    }
  }
}

#Preview {
  ContentView()
}
