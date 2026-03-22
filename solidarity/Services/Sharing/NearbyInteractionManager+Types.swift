//
//  NearbyInteractionManager+Types.swift
//  airmeishi
//
//  State machine types and configuration for UWB spatial triggering.
//

import Foundation
import simd

extension NearbyInteractionManager {

    /// UWB spatial trigger lifecycle states
    enum SpatialState: Equatable {
        /// No active ranging or waiting for token exchange
        case idle
        /// Distance below trigger threshold, accumulating confirmation frames
        case approaching(framesInRange: Int)
        /// Debounce passed, contact confirmed, about to trigger exchange
        case confirmed
        /// Exchange in progress, ignoring subsequent UWB updates
        case exchanging
        /// Exchange completed, cooling down to prevent duplicate triggers
        case cooldown
        /// Device does not support UWB or session invalidated
        case unavailable(reason: String)

        var isActive: Bool {
            switch self {
            case .approaching, .confirmed, .exchanging:
                return true
            default:
                return false
            }
        }

        var displayName: String {
            switch self {
            case .idle: return "Ready"
            case .approaching: return "Approaching"
            case .confirmed: return "Contact"
            case .exchanging: return "Exchanging"
            case .cooldown: return "Done"
            case .unavailable: return "Unavailable"
            }
        }
    }

    /// Tunable parameters for spatial trigger behavior
    struct SpatialConfig {
        /// Trigger distance threshold in meters
        var triggerDistance: Float = 0.15
        /// Number of consecutive frames below threshold required to confirm contact
        var requiredFrames: Int = 4
        /// Cooldown duration in seconds after exchange completes
        var cooldownDuration: TimeInterval = 5.0
        /// Distance above which the approaching frame counter resets (hysteresis band)
        var resetDistance: Float = 0.30
    }

    /// Parsed spatial data from NINearbyObject
    struct SpatialUpdate {
        let distance: Float?
        let direction: simd_float3?
    }
}
