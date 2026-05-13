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
        // Haptic is fired by ProximityManager when pendingInvitation is
        // set — the overlay can mount in multiple containers (root tab
        // + any sheet that re-applies the modifier), so .onAppear here
        // would double-fire the impact.
      }
    }
  }
}

extension View {
  func incomingInvitationOverlay() -> some View {
    self.modifier(IncomingInvitationOverlay())
  }
}
