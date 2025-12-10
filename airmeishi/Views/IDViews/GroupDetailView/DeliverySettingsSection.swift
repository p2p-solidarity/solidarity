//
//  DeliverySettingsSection.swift
//  airmeishi
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
        .padding()
        .background(Color(.secondarySystemGroupedBackground))
        .cornerRadius(12)
    }
}
