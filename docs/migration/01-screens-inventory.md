# 01 — SwiftUI Screens Inventory (Views/)

Generated 2026-05-24 by Explore agent (132 files).

Complexity: XS (≤50 lines) / S (50-150) / M (150-300) / L (300+ or heavy gestures) / XL (uses iOS-only frameworks requiring Nitro/Expo bridge).

| Path | Screen / Component | Kind | Navigation entry | iOS-only APIs | Heavy animations / gestures | Notes for Expo port | Complexity |
|---|---|---|---|---|---|---|---|
| **ContentView.swift** | ContentView | Screen | AppStorage onboarding gate | None | None | Root routing conditional | XS |
| **Common/MainTabView.swift** | MainTabView | Screen | TabView (people/share/me) + deep links | None | Toast, notification publishers | Core tab navigation, observer pattern | M |
| **Common/ThemedButtonStyles.swift** | ThemedPrimary/Inverted/Secondary/DottedOutline/DestructiveButtonStyle | ViewModifier | N/A | None | scaleEffect 0.15s spring | 5 button styles + haptic | S |
| **Common/SharedComponents.swift** | ContactInfoRow, MetadataRow, SkillChip, TagChip, KeyboardAccessoryHider | Subview | N/A | UITextField.appearance() | None | UIKit override for keyboard | S |
| **Common/RippleButton.swift** | RippleButton | Component | N/A | UIImpactFeedbackGenerator | LongPressGesture + ring timer + 360° rotation | Complex state machine + GeometryReader | L |
| **Common/TabBarComponents.swift** | CustomFloatingTabBar | Subview | N/A | None | withAnimation transitions | Custom tab bar | M |
| **Common/DecorativeBlobs.swift** | DecorativeBlobs, DecorativeGradientBackground | Style | N/A | None | None | Radial gradients | S |
| **Common/MauvePetalMotif.swift** | MauvePetalMotif | Component | N/A | None | Path math + GeometryReader | Custom SVG petal | M |
| **Common/PaperStackIllustration.swift** | PaperStackIllustration | Component | N/A | None | None | Figma SVG→Path | S |
| **Common/CryptoCompilingOverlay.swift** | CryptoCompilingOverlay | Overlay | isPresented binding | None | Timer-driven hash scroll | ZK proof compile UX | M |
| **Common/LanguageSelectionView.swift** | LanguageSelectionView | Sheet | .sheet | None | None | i18n picker | S |
| **Common/RedactionSwitcherView.swift** | RedactionSwitcherView | Component | N/A | None | withAnimation | Privacy redaction toggle | S |
| **Common/ContactPickerView.swift** | ContactPickerView | Sheet | .sheet | Contacts | None | Native contact picker | M |
| **Common/VCFDocumentPicker.swift** | VCFDocumentPicker | Sheet | .sheet | DocumentPickerViewController | None | VCF import dialog | S |
| **Common/CloudSharingView.swift** | CloudSharingView | UIViewControllerRepresentable | .sheet | CloudKit, UICloudSharingController | None | CloudKit group share wrapper | XL |
| **Common/IncomingInvitationOverlay.swift** | IncomingInvitationOverlay | Overlay | .incomingInvitationOverlay() | None | Pop/slide | Group invite toast | M |
| **Common/ReceivedCardView.swift** | ReceivedCardView | Sheet | .sheet from MainTabView/deep link | None | Card flip | Contact display after match | M |
| **Common/SakuraIconView.swift** | SakuraIconView | Component | N/A | None | Rotation + scale loop | Cherry blossom badge | S |
| **Common/AdaptiveLayout.swift** | AdaptiveLayout | ViewModifier | N/A | None | None | iPad/iPhone helpers | S |
| **Common/SettingsBlockComponents.swift** | SettingsBlockSection/Row | Subview | N/A | None | None | Settings building blocks | S |
| **Common/SolidarityScreenPlaceholders.swift** | SolidarityPlaceholderCard | Component | N/A | None | None | Loading placeholder | XS |
| **Common/MarkdownDocumentView.swift** | MarkdownDocumentView | View | N/A | None | None | Markdown rendering | M |
| **Common/WinSystemErrorDialog.swift** | WinSystemErrorDialog | Dialog | .alert or .confirmationDialog | None | None | Win95-style error | S |
| **Common/Toast/ToastView.swift** | ToastView | Overlay | .toastOverlay() | None | Slide + fade | In-app toast | S |
| **Common/Toast/ToastManager.swift** | ToastManager | EnvironmentObject | Singleton notifications | None | Timer-based fade | Notification state | S |
| **CardViews/AnimalSelectorView.swift** | AnimalSelectorView | Sheet | .sheet | None | None | Avatar selection grid | S |
| **CardViews/BusinessCardFormView.swift** | BusinessCardFormView | Sheet | .sheet in MeTabView | None | None | Create/edit identity card | M |
| **CardViews/BusinessCardListView.swift** | BusinessCardListView | Screen | Tab or navigation | PassKit | withAnimation sheet transitions | Card dashboard + PassKit | L |
| **CardViews/BusinessCardActionsView.swift** | WalletCardView | Subview | N/A | PassKit | rotation3DEffect 0.5s flip | 3D flip + PassKit button | M |
| **CardViews/ZKVerifyButton.swift** | ZKVerifyButton | Component | Button in card detail | None | None | ZK proof verification UI | S |
| **CardViews/OCRScanner/OCRScannerView.swift** | OCRScannerView | Screen | Modal nav | AVFoundation | None | Passport/ID OCR | L |
| **CardViews/OCRScanner/OCRScannerComponents.swift** | OCRScannerComponents | Subview | N/A | AVFoundation | None | OCR UI helpers | S |
| **CardViews/OCRScanner/OCRScannerView+Sections.swift** | OCRScannerView+Sections | Subview | N/A | None | None | OCR step sections | S |
| **CardViews/WalletPassGeneration/WalletPassGenerationView.swift** | WalletPassGenerationView | Screen | .sheet | PassKit, PKPass | None | Apple Wallet pass gen | XL |
| **CardViews/WalletPassGeneration/WalletPassGenerationComponents.swift** | WalletPassGenerationComponents | Subview | N/A | PassKit | None | Pass UI builders | M |
| **CardViews/WalletPassGeneration/FocusedCardView.swift** | FocusedCardView | Component | N/A | None | withAnimation + DragGesture + pinch | Card detail pan/zoom | M |
| **MeViews/MeTabView.swift** | MeTabView | Screen | Main tab | CloudKit | None | Identity credential dashboard | L |
| **MeViews/MeTabView+Sections.swift** | MeTabView+Sections | Subview | N/A | None | None | Me tab content sections | M |
| **MeViews/MeTabComponents.swift** | MeTabComponents | Subview | N/A | None | None | Me tab UI components | S |
| **MeViews/CredentialDetailView.swift** | CredentialDetailView | Sheet | .sheet | None | None | VC credential detail | M |
| **MeViews/PresentationChunkPlaybackControls.swift** | PresentationChunkPlaybackControls | Component | N/A | None | Animation controls | VP presentation playback | S |
| **MeViews/PresentationQRPageBuilder.swift** | PresentationQRPageBuilder | Component | N/A | None | None | QR page assembly | S |
| **PeopleViews/PeopleListView.swift** | PeopleListView | Screen | Main tab | Contacts | None | Contact list + search | M |
| **PeopleViews/PersonDetailView.swift** | PersonDetailView | Modal/Sheet | NavigationLink/Modal | None | MauvePetalMotif + hero animations | Peer detail w/ decorative shape | M |
| **PeopleViews/PersonDetailViewSupport.swift** | PersonDetailViewSupport | Subview | N/A | None | None | Detail view helpers | S |
| **PeopleViews/PersonDetailMoreSheet.swift** | PersonDetailMoreSheet | Sheet | .sheet | None | None | Notes/contact mgmt | S |
| **PeopleViews/ManualContactEntrySheet.swift** | ManualContactEntrySheet | Sheet | .sheet | None | None | Manual contact form | S |
| **PeopleViews/TrustGraphContactRow.swift** | TrustGraphContactRow | Subview | N/A | None | withAnimation state transitions | Contact row + trust indicators | S |
| **ScanViews/ScanTabView.swift** | ScanTabView | Screen | Main tab | AVFoundation | None | QR scanner + route handler | M |
| **ScanViews/SimpleQRScannerView.swift** | SimpleQRScannerView | Component | N/A | AVFoundation | None | Basic QR scanner | S |
| **ScanViews/ScanComponents.swift** | ScanComponents, ScanningFrameView | Subview | N/A | AVFoundation | None | Camera UI overlays | S |
| **ScanViews/ProofPresentationFlowSheet.swift** | ProofPresentationFlowSheet | Sheet | .sheet | None | None | VP presentation flow | M |
| **ScanViews/CredentialImportFlowSheet.swift** | CredentialImportFlowSheet | Sheet | .sheet | None | None | OID4VCI flow | M |
| **ScanViews/VerifierResultSheet.swift** | VerifierResultSheet | Sheet | .sheet | None | None | Verification result | S |
| **SettingsViews/SettingsView.swift** | SettingsView | Screen | .sheet | None | None | Settings dashboard | M |
| **SettingsViews/VCSettingsView.swift** | VCSettingsView | Screen | NavigationLink or .sheet | None | None | VC settings | M |
| **SettingsViews/SecuritySettingsView.swift** | SecuritySettingsView | Screen | NavigationLink | None | None | Key management | M |
| **SettingsViews/PrivacySettingsView.swift** | PrivacySettingsView | Screen | NavigationLink | None | None | Privacy & data prefs | S |
| **SettingsViews/AppearanceSettingsView.swift** | AppearanceSettingsView | Screen | NavigationLink | None | None | Theme selection | S |
| **SettingsViews/DataSyncSettingsView.swift** | DataSyncSettingsView | Screen | NavigationLink | None | None | iCloud sync settings | S |
| **SettingsViews/AdvancedSettingsView.swift** | AdvancedSettingsView | Screen | NavigationLink | None | None | Advanced options | S |
| **SettingsViews/BackupSettingsView.swift** | BackupSettingsView | Screen | NavigationLink | None | None | iCloud backup controls | S |
| **SettingsViews/NotificationSettingsView.swift** | NotificationSettingsView | Screen | NavigationLink | None | None | Push notification prefs | S |
| **SettingsViews/SolidarityQRView.swift** | SolidarityQRView | Sheet | Button action | None | None | Personal QR | S |
| **SettingsViews/GroupManagementView.swift** | GroupManagementView | Screen | .sheet | CloudKit | None | Group dashboard | M |
| **SettingsViews/GroupManagementView+Components.swift** | GroupManagementView+Components | Subview | N/A | CloudKit | None | Group UI | S |
| **SettingsViews/GroupManagementCardView.swift** | GroupManagementCardView | Subview | N/A | None | None | Group card | S |
| **SettingsViews/YourGroupsSectionView.swift** | YourGroupsSectionView | Subview | N/A | CloudKit | None | Your groups list | S |
| **SettingsViews/SelectiveDisclosureSettingsView.swift** | SelectiveDisclosureSettingsView | Screen | NavigationLink or .sheet | None | None | Field disclosure controls | M |
| **SettingsViews/OIDCRequestView.swift** | OIDCRequestView | Sheet | .sheet | AppIntents (import only) | None | OpenID Connect flow | M |
| **IDViews/IdentityDashboardView.swift** | IdentityDashboardView | Screen | Modal/Sheet | None | TabView page animation 0.2s | Identity credential browser | M |
| **IDViews/IDView.swift** | IDView | Screen | NavigationLink | None | None | Identity overview | S |
| **IDViews/PersonalIdentityView.swift** | PersonalIdentityView | Screen | TabView pane | None | None | Personal credential | S |
| **IDViews/GroupIdentityView.swift** | GroupIdentityView | Screen | TabView pane | CloudKit | None | Group credential | M |
| **IDViews/GroupDetailView.swift** | GroupDetailView | Screen | NavigationLink | CloudKit | None | Group admin panel | L |
| **IDViews/GroupDetailView+Subviews.swift** | GroupInfo/MerkleTree/Invite sections | Subview | N/A | CloudKit | None | Group detail subsections | M |
| **IDViews/GroupDetailView+MemberViews.swift** | MembersSection, MemberRow | Subview | N/A | CloudKit | withAnimation | Member management | S |
| **IDViews/GroupDetailView/CredentialIssuersSection.swift** | CredentialIssuersSection | Subview | N/A | None | None | Issuer list | S |
| **IDViews/GroupDetailView/GroupVCIssuanceSection.swift** | GroupVCIssuanceSection | Subview | N/A | None | None | VC issuance controls | S |
| **IDViews/GroupDetailView/DeliverySettingsSection.swift** | DeliverySettingsSection | Subview | N/A | None | None | Delivery prefs | S |
| **IDViews/GroupDetailView/AddIssuerView.swift** | AddIssuerView | Screen | NavigationLink | None | None | Add issuer form | S |
| **IDViews/GroupCardView.swift** | GroupCardView | Component | N/A | None | withAnimation rotation on tap | Clickable group card | S |
| **IDViews/GroupJoinSheet.swift** | GroupJoinSheet | Sheet | .sheet | CloudKit | None | Group join request | S |
| **IDViews/GroupVCIssuanceView.swift** | GroupVCIssuanceView | Screen | NavigationLink | None | None | VC issuance form | M |
| **IDViews/GroupCredentialDeliverySettingsView.swift** | GroupCredentialDeliverySettingsView | Screen | NavigationLink | None | None | Delivery method | S |
| **IDViews/ZKSettingsView.swift** | ZKSettingsView | Screen | NavigationLink | None | None | ZK settings | M |
| **IDViews/IDViewHelpers.swift** | IDViewHelpers | Utility | N/A | None | None | ID utilities | S |
| **IDViews/GroupViews/CreateGroupView.swift** | CreateGroupView | Screen | NavigationLink | CloudKit | None | Create new group | M |
| **MatchViews/MatchingView.swift** | MatchingView, PeerDetailSheet | Screen | Component or modal | None | withAnimation on peer connect | Matching UI root | S |
| **MatchViews/MatchingOrbitView.swift** | MatchingOrbitView | Component | N/A | None | Orbit rotation 7-14s repeating | Animated orbit visualization | M |
| **MatchViews/QRSharingView.swift** | QRSharingView | Sheet | .sheet | None | None | QR sharing modal | S |
| **MatchViews/ShareLinkOptionsView.swift** | ShareLinkOptionsView | Sheet | .sheet | None | None | Link sharing options | S |
| **MatchViews/ShareLinkOptionsComponents.swift** | ShareLinkOptionsComponents | Subview | N/A | None | None | Sharing UI | S |
| **MatchViews/Matching/MatchingRootView.swift** | MatchingRootView | Screen | Component | NearbyInteraction | Orbit rotations 7-14s + withAnimation | Main matching orbit + NI | M |
| **MatchViews/Matching/MatchingBarView.swift** | MatchingBarView | Component | N/A | None | None | Matching status bar | S |
| **MatchViews/Matching/NearbyPeersSheet.swift** | NearbyPeersSheet | Sheet | .sheet | NearbyInteraction | None | Nearby peers list | S |
| **MatchViews/Matching/ConnectPeerPopupView.swift** | ConnectPeerPopupView | Popup | .sheet | None | Animation transitions | Peer connection popup | S |
| **MatchViews/Matching/IncomingInvitationPopupView.swift** | IncomingInvitationPopupView | Popup | Modal overlay | None | Pop/scale | Incoming invite popup | S |
| **MatchViews/Matching/ConnectGroupInvitePopupView.swift** | ConnectGroupInvitePopupView | Popup | Modal overlay | None | withAnimation | Group invite popup | S |
| **MatchViews/Matching/LightningPeerCard.swift** | LightningPeerCard | Component | N/A | None | withAnimation on state | Peer info card | S |
| **MatchViews/Matching/ShareCardPickerSheet.swift** | ShareCardPickerSheet | Sheet | .sheet | None | None | Card selection | S |
| **SharingViews/SharingTabView.swift** | SharingTabView | Screen | Main tab | NearbyInteraction, PassKit | None | Sharing hub | L |
| **SharingViews/SharingTabView+Sections.swift** | SharingTabView+Sections | Subview | N/A | None | None | Sharing subsections | M |
| **SharingViews/RadarMatchingView.swift** | RadarMatchingView | Component | N/A | NearbyInteraction | 3× pulse ring + exponential scales | Radar with peer dots | M |
| **SharingViews/ProximitySharingView.swift** | ProximitySharingView | Screen | Modal/Sheet | NearbyInteraction, MultipeerConnectivity | None | Proximity matching | L |
| **SharingViews/ProximitySharingView+Sections.swift** | ProximitySharingView+Sections | Subview | N/A | NearbyInteraction | None | Proximity UI subsections | M |
| **SharingViews/ProximitySharingComponents.swift** | ProximitySharingComponents | Subview | N/A | NearbyInteraction | None | Proximity UI | S |
| **SharingViews/ShareSettingsView.swift** | ShareSettingsView | Screen | NavigationLink | None | None | Sharing privacy & defaults | M |
| **ShoutoutViews/ShoutoutView.swift** | ShoutoutView | Screen | Component or modal | None | withAnimation + SakuraIconView | Sakura card gallery | M |
| **ShoutoutViews/ShoutoutDetailView.swift** | ShoutoutDetailView | Sheet | .sheet | None | None | Sakura detail | S |
| **ShoutoutViews/ShoutoutDetailView+Sections.swift** | ShoutoutDetailView+Sections | Subview | N/A | None | None | Detail subsections | M |
| **ShoutoutViews/CreateShoutoutView.swift** | CreateShoutoutView | Sheet | .sheet | None | None | Create new Sakura | M |
| **ShoutoutViews/ShoutoutCardViews.swift** | ShoutoutCardViews | Subview | N/A | None | withAnimation on selection | Sakura card items | M |
| **ShoutoutViews/ShoutoutUserPicker.swift** | ShoutoutUserPicker | Sheet | .sheet | None | None | Recipient picker | S |
| **ShoutoutViews/ShoutoutFiltersView.swift** | ShoutoutFiltersView | Sheet | .sheet | None | None | Sakura filtering | S |
| **Onboarding/OnboardingFlowView.swift** | OnboardingFlowView | Screen | Root conditional | None | withAnimation step transitions | 7-step state machine | M |
| **Onboarding/OnboardingFlowView+Steps.swift** | OnboardingFlowView+Steps | Subview | N/A | None | None | Step implementations | M |
| **Onboarding/TerminalWelcomeScreen.swift** | TerminalWelcomeScreen | Screen | Onboarding step | None | Typewriter + blinking cursor | Terminal-themed welcome | M |
| **Onboarding/DarkProfileSetupForm.swift** | DarkProfileSetupForm | Screen | Onboarding step | None | None | Profile setup form | M |
| **Onboarding/AvatarSelectionGrid.swift** | AvatarSelectionGrid | Screen | Onboarding step | None | withAnimation on selection | Avatar grid picker | M |
| **Onboarding/PassportOnboardingFlowView.swift** | PassportOnboardingFlowView | Sheet | .sheet in MeTabView | None | None | Passport MRZ+NFC flow | L |
| **Onboarding/PassportOnboardingFlowView+Steps.swift** | PassportOnboardingFlowView+Steps | Subview | N/A | None | None | Passport flow steps | M |
| **Onboarding/MRZCameraView.swift** | MRZCameraView | Screen | Modal nav | AVFoundation, Vision | None | MRZ zone scanning | L |
| **Onboarding/PassportPipelineViewModel.swift** | PassportPipelineViewModel | ViewModel | N/A | Vision, AVFoundation | None | MRZ+NFC pipeline state machine | L |

---

## Cross-cutting reusables

### ButtonStyles
- `ThemedPrimaryButtonStyle` — solid bg + haptic + scale animation
- `ThemedInvertedButtonStyle` — white bg / black text
- `ThemedSecondaryButtonStyle` — translucent border
- `ThemedDottedOutlineButtonStyle` — dashed border, cyan text
- `ThemedDestructiveButtonStyle` — red outlined

### ViewModifiers / extensions
- `.hideKeyboardAccessory()` — UITextField/UITextView appearance override (UIKit bridge)
- `.toastOverlay()` — global toast layer
- `.incomingInvitationOverlay()` — group invite notification overlay
- `.cardGlow()` — dynamic card shadow glow (ColorScheme-aware)
- `.adaptivePadding()` / `.adaptiveMaxWidth()` — iPad/iPhone helpers

### Theme tokens (Color.Theme)
`pageBg`, `textPrimary`, `textSecondary`, `textTertiary`, `primaryBlue`, `accentRose`, `featureAccent`, `destructive`, `cardSurface()`, `cardBorder()` (ColorScheme-aware), `divider`, `radarRing`, `radarGlow`, `dustyMauve`, `blobCenter`, `gradientPeach`, `gradientLavender`, `backgroundRadialGradient()`

### Shared chip / row components
`ContactInfoRow`, `MetadataRow`, `SkillChip`, `TagChip`

### Animation / gesture reusables
`RippleButton`, `DecorativeBlobs`, `MauvePetalMotif`, `PaperStackIllustration`, `CryptoCompilingOverlay`

### Singletons wired into SwiftUI environment
`CardManager.shared`, `ContactRepository.shared`, `ProximityManager.shared`, `NearbyInteractionManager`, `QRCodeManager`, `IdentityCoordinator.shared`, `IdentityDataStore.shared`, `CloudKitGroupSyncManager`, `SemaphoreGroupManager`, `ProofGenerationManager`, `ToastManager`, `PassKitManager`, `HapticFeedbackManager`, `DeveloperModeManager`, `NotificationSettingsManager`, `BackupManager`, `ThemeManager`

### High-risk integrations (Expo port = XL)
- **PassKit** — `WalletPassGenerationView`, `BusinessCardListView`, `BusinessCardActionsView` → Nitro bridge
- **CloudKit** — `CloudSharingView`, `GroupDetailView`, `MeTabView`, `CloudKitGroupSyncManager` → keep iOS, Nitro bridge
- **NearbyInteraction (UWB)** — `RadarMatchingView`, `SharingTabView`, `MatchingRootView` → Nitro module (iOS + Android)
- **AVFoundation + Vision** — `ScanTabView`, `MRZCameraView`, `OCRScannerView` → `react-native-vision-camera` v5 + frame processor
- **Contacts** — `PeopleListView`, `OnboardingFlowView` → `expo-contacts`
- **AppIntents** — imported but no active usage → drop

---

## Summary

| Bucket | Count |
|---|---|
| Total files | 132 |
| Screens | ~50 |
| Sheets/Modals | ~40 |
| Subviews/Components | ~42 |
| XL (Expo bridge required) | 7 |
| L (heavy gestures or framework) | ~10 |
| M | ~50 |
| S/XS | ~65 |

**Port order**: XS/S reusables + pure-layout M screens first (settings, forms). PassKit + CloudKit bridges in parallel. RippleButton / RadarMatchingView / MatchingRootView animations rewritten last via Reanimated 4 worklets.
