//
//  HybridAirdrop.swift
//  @solidarity/nitro-airdrop (iOS)
//
//  Wraps `UIActivityViewController` filtered so AirDrop is the headline
//  action. Mirrors the legacy Swift surface in
//  `solidarity/Services/Sharing/AirDropManager.swift` so the Expo client
//  can share business cards (`.vcf`), wallet passes (`.pkpass`), or any
//  other UTI-tagged blob via the iOS share sheet.
//
//  Flow:
//    1. JS calls share({ fileName, utiType, data })
//    2. We write `data` to a temp file under
//       FileManager.default.temporaryDirectory using `fileName` so AirDrop
//       and the receiving app see a stable display name + extension.
//    3. We build a UIActivityViewController with that file URL and a
//       filtered `excludedActivityTypes` set so AirDrop is featured
//       (mirrors the Swift AirDropManager.swift exclusion list).
//    4. Present from the top view controller of the active foreground
//       window scene. On iPad we configure the popover's source view to
//       avoid the "must provide sourceView" runtime exception.
//    5. The completion handler resolves the Promise with an AirdropResult
//       describing completion/cancel/error, then we clean up the temp file.
//
//  Threading:
//    Promise.async dispatches us off the JS thread; UIKit presentation
//    runs on the main thread (we hop via `DispatchQueue.main.async`).
//
//  Security:
//    - No force-unwraps, no fatalError.
//    - We never log payload bytes or filenames (filenames may contain
//      personal data — e.g. "Alice Smith.vcf"); we only log counters +
//      classes on failure paths.
//    - On missing top VC we reject with a structured error so the JS
//      caller can surface "share unavailable" UX rather than hang.
//

import Foundation
import NitroModules
import UIKit

final class HybridAirdrop: HybridAirdropSpec {

  // MARK: - Availability

  /// UIActivityViewController is always available on iOS. AirDrop itself
  /// requires Bluetooth/Wi-Fi to be active on the receiver, but the
  /// presentation sheet still surfaces other share targets (Mail, Notes
  /// extensions, etc.) so we return true.
  func isAvailable() -> Bool {
    return true
  }

  // MARK: - Share

  func share(payload: AirdropPayload) throws -> Promise<AirdropResult> {
    return Promise.async {
      try await self.performShare(payload: payload)
    }
  }

  private func performShare(payload: AirdropPayload) async throws -> AirdropResult {
    // Write the payload bytes to a temp file. We use `payload.fileName`
    // verbatim so AirDrop shows the user-meaningful filename
    // ("Alice.vcf") rather than a UUID, and so the receiving app's
    // Document Provider picks the right UTI from the extension.
    let tempURL = FileManager.default.temporaryDirectory
      .appendingPathComponent(payload.fileName)

    let bytes = payload.data.toData(copyIfNeeded: true)
    do {
      try bytes.write(to: tempURL, options: [.atomic])
    } catch {
      throw self.error(
        code: "airdrop_temp_file_failed",
        message: "Failed to stage AirDrop payload: \(error.localizedDescription)"
      )
    }

    // UIKit presentation MUST happen on the main thread. We bridge the
    // completion handler into an async continuation so the Promise resolves
    // when the activity sheet dismisses (or rejects if presentation fails).
    do {
      return try await withCheckedThrowingContinuation { continuation in
        DispatchQueue.main.async {
          self.presentActivityViewController(fileURL: tempURL, continuation: continuation)
        }
      }
    } catch {
      // Continuation rejected — clean up the staged file if presentation
      // never started (the completion handler path also cleans up, but a
      // pre-presentation failure won't have triggered it).
      try? FileManager.default.removeItem(at: tempURL)
      throw error
    }
  }

  // MARK: - Presentation (main thread)

  private func presentActivityViewController(
    fileURL: URL,
    continuation: CheckedContinuation<AirdropResult, Error>
  ) {
    // Look up the active window scene + key window + top-most VC. If any
    // step fails we resume the continuation with a structured error so the
    // JS caller knows the share could not be presented (versus a cancel).
    guard let topVC = Self.topMostViewController() else {
      continuation.resume(throwing: self.error(
        code: "airdrop_no_view_controller",
        message: "Cannot present AirDrop share sheet — no foreground view controller."
      ))
      return
    }

    let activityVC = UIActivityViewController(
      activityItems: [fileURL],
      applicationActivities: nil
    )

    // Filter activity types so AirDrop sits front-and-centre. Mirrors the
    // Swift AirDropManager exclusion list — keep the social platforms +
    // assignToContact / saveToCameraRoll out so the user lands on AirDrop
    // by default.
    activityVC.excludedActivityTypes = [
      .assignToContact,
      .saveToCameraRoll,
      .print,
      .copyToPasteboard,
      .addToReadingList,
      .mail,
      .message,
      .postToFacebook,
      .postToTwitter,
      .postToWeibo,
      .postToVimeo,
      .postToTencentWeibo,
      .postToFlickr,
    ]

    // iPad: UIActivityViewController is a popover when not embedded in a
    // sheet. Without a sourceView UIKit throws
    // `NSInternalInconsistencyException` at runtime — anchor it to the
    // centre of the presenting VC's view so the popover appears over the
    // app's main content area.
    if let popover = activityVC.popoverPresentationController {
      popover.sourceView = topVC.view
      popover.sourceRect = CGRect(
        x: topVC.view.bounds.midX,
        y: topVC.view.bounds.midY,
        width: 0,
        height: 0
      )
      popover.permittedArrowDirections = []
    }

    // UIKit invokes the completion handler exactly once per contract.
    // Guard against accidental double-resume in case a future iOS rev
    // double-fires (defensive — has happened in older Catalyst rev's).
    var resumed = false
    activityVC.completionWithItemsHandler = { activityType, completed, _, error in
      if resumed { return }
      resumed = true

      // Always clean up the staged temp file. Use try? — if AirDrop has
      // copied the bytes out the file is no longer needed; if it hasn't,
      // the system temp directory is wiped on app suspend/exit anyway.
      try? FileManager.default.removeItem(at: fileURL)

      let cancelled = !completed && activityType == nil && error == nil
      let result = AirdropResult(
        completed: completed,
        cancelled: cancelled,
        errorMessage: error?.localizedDescription
      )
      continuation.resume(returning: result)
    }
    topVC.present(activityVC, animated: true)
  }

  // MARK: - View controller traversal

  /// Walks the foreground window scene's view-controller hierarchy to
  /// find the top-most presented controller. Mirrors the convenience
  /// extension in the Swift app so the share sheet always appears above
  /// any modal that's currently on screen.
  private static func topMostViewController() -> UIViewController? {
    // Prefer the active foreground scene; fall back to the first scene
    // for cases where `.foregroundActive` hasn't been reached yet (e.g.
    // immediate share on cold start).
    let scenes = UIApplication.shared.connectedScenes
    let windowScene = scenes.first { ($0 as? UIWindowScene)?.activationState == .foregroundActive } as? UIWindowScene
      ?? scenes.first as? UIWindowScene
    guard let keyWindow = windowScene?.windows.first(where: { $0.isKeyWindow })
      ?? windowScene?.windows.first else {
      return nil
    }
    var top = keyWindow.rootViewController
    while let presented = top?.presentedViewController {
      top = presented
    }
    return top
  }

  // MARK: - Errors

  private func error(code: String, message: String) -> NSError {
    return NSError(
      domain: "gg.solidarity.airdrop",
      code: 0,
      userInfo: [
        NSLocalizedDescriptionKey: message,
        "errorCode": code,
      ]
    )
  }
}
