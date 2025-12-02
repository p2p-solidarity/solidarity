import Foundation

/// Settings for delivering Group Credentials to members
struct GroupCredentialDeliverySettings: Codable, Equatable {
    /// Default delivery method to use
    var defaultDeliveryMethod: DeliveryMethod = .sakura
    
    /// Set of enabled delivery methods
    var enabledMethods: Set<DeliveryMethod> = [.sakura, .proximity, .qrCode, .airdrop]
    
    /// Whether to automatically send to all active members upon issuance
    var autoSendToAllMembers: Bool = false
    
    /// Whether to restrict sending only to members who have exchanged cards (and thus have sealed routes)
    var onlySendToExchangedContacts: Bool = true
    
    /// Whether to allow members to choose their preferred delivery method
    var allowMemberCustomDelivery: Bool = true
    
    /// Whether to require a PIN for Proximity delivery
    var requirePIN: Bool = false
    
    /// The PIN for Proximity delivery (if required)
    var pin: String?
    
    /// Whether to encrypt messages (Sakura is encrypted by default, this might toggle additional layers or be a UI preference)
    var encryptMessages: Bool = true
    
    /// Supported delivery methods
    enum DeliveryMethod: String, Codable, CaseIterable {
        case sakura = "Sakura"           // Via Sakura secure messaging
        case proximity = "Proximity"      // Via Proximity (BLE/Nearby Interaction) - Owner only
        case qrCode = "QR Code"           // Via QR Code scanning
        case airdrop = "AirDrop"          // Via iOS AirDrop
        
        var displayName: String { rawValue }
        
        /// Whether this method requires a sealed route (encryption)
        var requiresSealedRoute: Bool {
            switch self {
            case .sakura, .proximity: return true
            case .qrCode, .airdrop: return false
            }
        }
        
        /// Whether this method requires owner privileges (e.g. accessing all device tokens)
        var requiresOwnerPermission: Bool {
            switch self {
            case .proximity: return true
            case .sakura, .qrCode, .airdrop: return false
            }
        }
    }
}
