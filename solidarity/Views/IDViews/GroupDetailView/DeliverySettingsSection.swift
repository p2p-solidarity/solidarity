//
//  DeliverySettingsSection.swift
//  solidarity
//
//  Section for configuring Group VC delivery settings
//

import SwiftUI

struct DeliverySettingsSection: View {
  let group: GroupModel

  var body: some View {
    NavigationLink(destination: GroupCredentialDeliverySettingsView(group: group)) {
      Label("Delivery Settings", systemImage: "envelope.badge.gearshape")
    }
    .padding(16)
    .background(Color.Theme.searchBg)
    .overlay(Rectangle().stroke(Color.Theme.divider, lineWidth: 1))
  }
}
