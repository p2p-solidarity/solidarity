//
//  IncomingInvitationOverlay.swift
//  solidarity
//
//  Hosts the IncomingInvitationPopupView whenever ProximityManager has a
//  pending invitation. Mounted at root (MainTabView) so the dialog appears no
//  matter which tab is active, and re-mounted inside any modal sheet that
//  could otherwise occlude it (SwiftUI .sheet covers root overlays).
//

import SwiftUI

struct IncomingInvitationOverlay: ViewModifier {
  @ObservedObject var manager = ProximityManager.shared

  func body(content: Content) -> some View {
    ZStack {
      content
      if let invitation = manager.pendingInvitation {
        IncomingInvitationPopupView(
          invitation: invitation,
          onAccept: { manager.respondToPendingInvitation(accept: true) },
          onDecline: { manager.respondToPendingInvitation(accept: false) },
          onDismiss: { manager.releaseInvitationPresentation() }
        )
        .transition(.opacity)
        .zIndex(200)
        .onAppear { HapticFeedbackManager.shared.heavyImpact() }
      }
    }
  }
}

extension View {
  func incomingInvitationOverlay() -> some View {
    self.modifier(IncomingInvitationOverlay())
  }
}
