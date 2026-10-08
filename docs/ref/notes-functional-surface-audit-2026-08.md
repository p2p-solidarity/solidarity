# App functional-surface audit (2026-08)

## Goal

Every enabled control reachable in the Expo app must have a real, observable outcome.
An `onPress` prop alone does not count: navigation must resolve, mutations must persist,
failures must be visible, and an unfinished capability must never report fake success.

## Grilled acceptance rules

1. Production controls either work end to end or are removed from the production surface.
2. Developer-only unfinished work may remain visible only when it is disabled and names the
   missing dependency. It may not synthesize data or show a success result.
3. Destructive operations require confirmation, await persistence, report failure, and only
   then navigate away.
4. Native/external actions distinguish cancellation from failure and expose a recovery path
   when permission or platform support is missing.
5. Route and interaction coverage is automated: literal navigation targets must exist, and
   button-like primitives must carry an action or an explicit disabled state.
6. Verification includes focused behavior tests, the complete Expo test command, and simulator
   walks of People, Me, Verify, Settings, and unlocked Developer Options.

## Initial findings

### P0 — enabled actions that can appear to do nothing

- `PersonDetailMoreSheet` calls the root `confirmDialog` while an iOS native `Modal` is already
  presented. The root confirmation is itself a second native `Modal`, so its presentation is not
  reliable above the current sheet. This matches the reported Contact deletion failure.
- The same nested-modal pattern exists in `BusinessCardActionsSheet` and the duplicate-update
  path in `VerifiedPageResultSheet`.
- `AppAlertOverlay`, `PearConsentOverlay`, and `PearPresentConsentOverlay` use the same root native
  modal architecture, so errors or inbound consent can also become invisible while a sheet is
  open. The root fix is a window-level iOS overlay, not three call-site delays.
- Contact detail deletion fires persistence without awaiting it and navigates immediately; edit
  and manual-create sheets also do not surface persistence rejection.

### P1 — fake or explicitly unfinished actions found by static scan

- Group credential issuance fabricates successful recipients after a timer.
- Developer credential issuance writes `unsigned.placeholder.jwt`.
- Identity and group refresh controls only show "next iteration" / "up to date" toasts.
- Group Privacy Policy and Terms rows show "next iteration" despite real legal routes existing.
- OCR exposes a recognizer action whose implementation is still a stub.
- The existing UX backlog already records broken OID4VP request/response wiring and legacy QR
  duplication; these must not remain enabled as if they were complete.

These are classified before editing as: implement now when the real local mechanism already
exists; otherwise remove from production reachability or render disabled with honest dependency
copy. Building new CloudKit/group-delivery/OID4VP infrastructure is a separate product task.

## Execution order

1. Replace root iOS native-modal overlays with one reusable window-level overlay and regression
   coverage; retest Contact deletion and the other nested-sheet callers.
2. Make contact create/edit/delete persistence transactional from the screen's perspective and
   surface errors.
3. Add static route/action inventory checks and produce the reachable screen matrix.
4. Eliminate fake-success and TODO-only controls by wiring existing mechanisms or making their
   unavailable state explicit.
5. Walk all reachable flows in the simulator, run full verification, then review the complete
   diff against this document and the product spec.

## Implemented surface matrix

| Surface | Enabled outcome after audit | Failure / unavailable behavior |
| --- | --- | --- |
| People list and contact detail | Import, add, edit, share a complete vCard, and delete through awaited repository mutations | Mutation and external-link failures remain on the current screen and show an alert |
| Contact detail header | The navigation-bar icon shares; the card-level pencil edits the contact | The duplicate floating edit/share affordance was removed |
| Business cards | Create, edit, export a complete vCard, and delete through awaited card-manager mutations | Delete/share failures are visible and never dismiss the sheet or screen as success |
| Shoutouts | Persist incoming/outgoing items and delete them through the encrypted store | Delete failure is visible; manifest removal is covered in the complete test order |
| Groups | Create a persisted owner group, edit membership, prove membership, and delete with dependent local records | Cloud delivery, fabricated issuance, fake invitations, and no-op refresh controls are not exposed as working features |
| Credentials | View, add again, remove with confirmation, and present a proof after sensitive-action authorization | Removal/presentation failure stays visible; locally fabricated unsigned credentials are retired |
| Scan / OIDC | Scan externally supplied supported payloads and continue valid consent flows | Local request generation routes redirect to Scan until end-to-end OID4VP request transport exists |
| Share and privacy | One canonical persisted Share Settings page controls the fields placed in the generated QR | Old local-only privacy/disclosure switches redirect to the canonical page |
| Notifications | Remote registration/unregistration completes before the preference changes | Permission, native registration, and system-settings launch failures are visible; the switch cannot double-submit |
| Legal and external links | Legal rows navigate to real routes; profile links open through the platform | Platform link-open rejection produces a localized alert |
| Legacy prototypes | Stable deep links redirect to the nearest real maintained feature | OCR, identity dashboards, group delivery, and other placeholder-only screens cannot report fake success |

## Cross-cutting guarantees added

- Root confirmations, alerts, and Pear consent use a window-level iOS overlay, so an action
  opened from an existing native sheet can still present its confirmation reliably.
- Contact, card, group, and shoutout hydration are mutation-aware: a decrypt already in flight
  cannot resurrect a record deleted before hydration completes.
- Destructive screens await persistence before navigating away.
- Literal Expo Router targets are checked against route files, and enabled button-like JSX is
  checked for an action handler or an explicit disabled state.
- Interactive native/external calls no longer discard promise rejection at the call site.

## Verification evidence

- Focused nested-overlay, contact mutation, card action, group-store, unfinished-surface, and
  route/action integrity tests cover the reported failure and the audited regressions.
- The full unit + parity suite passes: 1,923 tests, 0 failures (1,809 unit + 114 parity).
- TypeScript typecheck passes. ESLint completes with zero errors; the repository still reports
  existing warnings, which are outside this functional-surface acceptance gate.
- Simulator walk and final standards/spec review are recorded after the remaining steps complete.
