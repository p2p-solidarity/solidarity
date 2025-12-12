//
//  ProximityDebug.swift
//  airmeishi
//
//  Debug helpers for proximity sharing configuration
//

import Foundation

extension ProximityManager {
    /// Verbose debug dump of Info.plist network-related keys and current state
    func debugLogInfoPlist() {
        print("[Proximity][Debug] === Info.plist Network Configuration Dump ===")
        guard let info = Bundle.main.infoDictionary else {
            print("[Proximity][Debug] Bundle.main.infoDictionary is nil")
            return
        }
        print("[Proximity][Debug] bundleIdentifier=\(Bundle.main.bundleIdentifier ?? "<nil>")")
        let sortedKeys = info.keys.sorted()
        print("[Proximity][Debug] keys(\(sortedKeys.count))=\(sortedKeys)")

        if let localDesc = info["NSLocalNetworkUsageDescription"] as? String {
            print("[Proximity][Debug] NSLocalNetworkUsageDescription=\(localDesc)")
        } else if let keyed = info["INFOPLIST_KEY_NSLocalNetworkUsageDescription"] as? String {
            print("[Proximity][Debug] NSLocalNetworkUsageDescription via INFOPLIST_KEY=\(keyed)")
        } else if let raw = info["NSLocalNetworkUsageDescription"] {
            print("[Proximity][Debug] NSLocalNetworkUsageDescription present but unexpected type=\(type(of: raw)) value=\(raw)")
        } else {
            print("[Proximity][Debug] NSLocalNetworkUsageDescription=<missing>")
        }

        if let services = info["NSBonjourServices"] as? [String] {
            print("[Proximity][Debug] NSBonjourServices=\(services)")
        } else if let keyed = info["INFOPLIST_KEY_NSBonjourServices"] as? [String] {
            print("[Proximity][Debug] NSBonjourServices via INFOPLIST_KEY=\(keyed)")
        } else if let raw = info["NSBonjourServices"] {
            print("[Proximity][Debug] NSBonjourServices present but unexpected type=\(type(of: raw)) value=\(raw)")
        } else {
            print("[Proximity][Debug] NSBonjourServices=<missing>")
        }

        print("[Proximity][Debug] isAdvertising=\(isAdvertising) isBrowsing=\(isBrowsing) nearbyPeers=\(nearbyPeers.count)")
        print("[Proximity][Debug] =============================================")
    }
}
