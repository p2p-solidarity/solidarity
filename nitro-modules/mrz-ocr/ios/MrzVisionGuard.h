//
//  MrzVisionGuard.h
//  MrzOcr
//
//  Objective-C++ exception barrier for Apple Vision.
//
//  `VNImageRequestHandler.performRequests:` can abort mid neural-net pass on
//  older Neural Engines (A12 / iPhone XR, iOS 18) running the `.accurate` text
//  recogniser. Observed empirically, the failure surfaces as an *uncaught C++
//  exception* thrown from inside Espresso (Apple's NN engine behind Vision) —
//  NOT an `NSException` — though Vision can also raise an `NSException`. A Swift
//  `do/catch` catches neither (only Swift `Error`s), so the throw escapes
//  uncaught → `std::terminate` → `SIGABRT` (the whole app 閃退), on whatever
//  thread ran the perform (here VisionCamera's `async-runner` worklet).
//
//  This C function wraps the perform in a combined barrier — `@try/@catch` for
//  an `NSException`, C++ `catch (...)` for any C++ exception — and turns
//  whichever fired (or a normal perform failure) into an `NSError`. The Swift
//  caller treats that as "no MRZ this frame" and skips it. Never raises.
//

#import <Foundation/Foundation.h>

@class VNImageRequestHandler;

NS_ASSUME_NONNULL_BEGIN

/// Run `requests` on `handler` inside an Objective-C++ exception barrier.
/// Returns `nil` on success, or an `NSError` describing the caught
/// `NSException` / C++ exception / perform failure. Never raises.
NSError *_Nullable MrzPerformVisionRequest(VNImageRequestHandler *handler,
                                           NSArray *requests);

/// Install a process-wide `std::set_terminate` handler that records an
/// uncaught exception's demangled type + message — for a `facebook::jsi::JSError`
/// that includes the full JS stack — into the crash report's "Application
/// Specific Information" (so it lands in the `.ips` you pull with
/// `idevicecrashreport`, no `sudo log` needed) and an `os_log` fault, then
/// chains to the previously-installed handler.
///
/// Idempotent (installs at most once). Call it LATE — e.g. on the first
/// `scanFrame` — so it wraps React Native / Hermes' own handlers rather than
/// being overwritten by them. Why this exists: an uncaught C++/JSI exception on
/// a worklet runtime otherwise aborts with only "abort() called" in the report,
/// which cost hours to trace. Now the report names the culprit itself.
void MrzInstallCrashDiagnostics(void);

NS_ASSUME_NONNULL_END
