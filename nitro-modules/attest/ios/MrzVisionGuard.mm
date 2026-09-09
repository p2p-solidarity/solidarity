//
//  MrzVisionGuard.mm
//  MrzOcr
//
//  See MrzVisionGuard.h. The barrier MUST live in Objective-C++ — neither a
//  Swift `do/catch` nor any Swift wrapper can intercept what Vision throws here.
//
//  Empirically (iPhone XR / A12, iOS 18.7) the `.accurate` text recogniser
//  aborts mid neural-net pass and the failure surfaces as an *uncaught C++
//  exception* thrown from inside Espresso (Apple's NN engine behind Vision) as
//  it bounces layers ANE↔CPU — NOT an NSException. The device crash report's
//  terminate chain `std::terminate -> _objc_terminate ->
//  demangling_terminate_handler` proves it: `_objc_terminate` only punts to the
//  C++ demangling handler when the live exception is NOT an NSException. So a
//  plain `@catch (NSException *)` never catches it and the app still
//  `std::terminate`s (SIGABRT / 閃退) on the `async-runner-1` worklet thread.
//
//  We therefore catch BOTH:
//    * NSException        via `@catch`              (kept; cheap, nice message)
//    * any C++ exception  via `catch (const std::exception&)` / `catch (...)`
//                                                   (the one that actually fires)
//  and turn whichever fired into an NSError the Swift caller treats as "no MRZ
//  this frame" and skips. No image bytes are ever logged — only the framework's
//  exception name / `what()` text.
//

#import "MrzVisionGuard.h"

// Non-modular import: a .mm (ObjC++) translation unit has C++ modules disabled,
// so `@import Vision;` won't compile here. The framework header pulls in the
// full VNImageRequestHandler / VNRequest interfaces.
#import <Vision/Vision.h>

#import <os/log.h>
#include <cxxabi.h>
#include <dlfcn.h>
#include <exception>
#include <string>
#include <typeinfo>

static NSString *const kMrzVisionGuardDomain = @"gg.solidarity.mrz-ocr.vision";

static NSError *MrzGuardError(NSInteger code, NSString *message) {
  return [NSError errorWithDomain:kMrzVisionGuardDomain
                             code:code
                         userInfo:@{NSLocalizedDescriptionKey : message}];
}

NSError *_Nullable MrzPerformVisionRequest(VNImageRequestHandler *handler,
                                           NSArray *requests) {
  // Outer C++ barrier, inner ObjC barrier. A C++ exception raised inside
  // `performRequests:` slips past `@catch (NSException *)` and unwinds to the
  // outer `catch`; an NSException is caught by the inner `@catch`. Both paths
  // return an NSError instead of letting the throw reach the worklet's noexcept
  // dispatch block (where it would std::terminate the app).
  try {
    @try {
      NSError *performError = nil;
      BOOL ok = [handler performRequests:requests error:&performError];
      if (ok) {
        return nil;
      }
      if (performError != nil) {
        return performError;
      }
      return MrzGuardError(-1, @"Vision perform returned false");
    } @catch (NSException *exception) {
      // No PII: only the framework's exception name + reason (never the image).
      NSString *reason = exception.reason ?: @"(no reason)";
      return MrzGuardError(-2,
          [NSString stringWithFormat:@"Vision raised NSException %@: %@",
                                     exception.name, reason]);
    }
  } catch (const std::exception &e) {
    // The case that actually fires on the A12 ANE: Espresso / MPS throws a C++
    // exception mid-inference. `what()` is the engine's own message — no image
    // data, safe to surface for diagnostics.
    return MrzGuardError(-3,
        [NSString stringWithFormat:@"Vision raised C++ exception: %s", e.what()]);
  } catch (...) {
    return MrzGuardError(-4, @"Vision raised an unknown non-Objective-C exception");
  }
}

#pragma mark - Crash diagnostics (self-identifying uncaught exceptions)

namespace {

std::terminate_handler gMrzPrevTerminate = nullptr;
// Held in a static so the C string survives until the crash report is written —
// CRSetCrashLogMessage stores the pointer, it does not copy. We abort right
// after, so a single static is safe.
std::string gMrzCrashMessage;

// Demangle + describe whatever is currently being thrown. Catches the three
// shapes that reach `std::terminate` in this app: an ObjC NSException, any
// C++ std::exception (incl. `facebook::jsi::JSError`, whose `what()` carries
// the JS stack), or something else. No PII — only framework/type text.
std::string MrzDescribeCurrentException() {
  std::exception_ptr cur = std::current_exception();
  if (!cur) {
    return "terminate called with no active exception (noexcept violation?)";
  }
  try {
    std::rethrow_exception(cur);
  } catch (NSException *ns) {
    // In the unified ObjC/C++ exception model a thrown NSException is catchable
    // as a C++ exception of type `NSException *` (do NOT use `@catch` on a C++
    // `try`).
    NSString *name = ns.name ?: @"NSException";
    NSString *reason = ns.reason ?: @"(no reason)";
    return std::string("NSException ") + name.UTF8String + ": " + reason.UTF8String;
  } catch (const std::exception &e) {
    int status = 0;
    char *demangled = abi::__cxa_demangle(typeid(e).name(), nullptr, nullptr, &status);
    std::string type = (status == 0 && demangled != nullptr) ? demangled : typeid(e).name();
    free(demangled);
    return type + ": " + e.what();
  } catch (...) {
    return "unknown non-Objective-C / non-std C++ exception";
  }
}

void MrzTerminateHandler() {
  @autoreleasepool {
    gMrzCrashMessage = std::string("[MRZ-FATAL] uncaught: ") + MrzDescribeCurrentException();
    os_log_fault(OS_LOG_DEFAULT, "%{public}s", gMrzCrashMessage.c_str());
    // Surface it in the crash report's "Application Specific Information".
    // Resolved dynamically so there is no static reference to the private
    // symbol (keeps it out of binary API scans); null-safe if unavailable.
    using CRSetFn = void (*)(const char *);
    static CRSetFn crSet = reinterpret_cast<CRSetFn>(dlsym(RTLD_DEFAULT, "CRSetCrashLogMessage"));
    if (crSet != nullptr) {
      crSet(gMrzCrashMessage.c_str());
    }
  }
  // Chain to RN/Hermes' handler (it may print its own diagnostics), then abort.
  if (gMrzPrevTerminate != nullptr) {
    gMrzPrevTerminate();
  }
  std::abort();
}

}  // namespace

void MrzInstallCrashDiagnostics(void) {
  static dispatch_once_t once;
  dispatch_once(&once, ^{
    gMrzPrevTerminate = std::set_terminate(&MrzTerminateHandler);
  });
}

// App-launch bootstrap so the diagnostics cover EVERY screen — not only ones
// that touch the camera. This pod is linked into the app, so its `+load` runs
// at launch (before `main`). We defer the actual install to the next main-loop
// turn so it lands AFTER React Native / Hermes register their own terminate
// handlers — ours then wraps (and chains to) theirs. `MrzInstallCrashDiagnostics`
// is `dispatch_once`, so the lazy call in `scanFrame` is a harmless no-op after
// this. This is why a DAG-Lab / P2P-Lab crash (a TurboModule NSException, no
// camera involved) now names itself in the crash report.
@interface MrzVisionGuardBootstrap : NSObject
@end

@implementation MrzVisionGuardBootstrap
+ (void)load {
  dispatch_async(dispatch_get_main_queue(), ^{
    MrzInstallCrashDiagnostics();
  });
}
@end
