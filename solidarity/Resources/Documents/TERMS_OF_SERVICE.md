# Terms of Service for Solid(ar)ity

**Last Updated:** 2025-01-15

**Effective Date:** 2025-01-15

---

## 1. Acceptance of Terms

By downloading, installing, or using Solid(ar)ity ("the App"), you agree to be bound by these Terms of Service ("Terms"). If you do not agree to these Terms, do not use the App.

These Terms constitute a legally binding agreement between you ("User," "you," or "your") and the developers of Solid(ar)ity ("we," "us," or "our").

---

## 2. Description of Service

Solid(ar)ity is a **privacy-preserving, peer-to-peer business card sharing application** for iOS devices. The App enables users to:

- Create and store digital business cards locally on their device
- Share business cards with nearby users via proximity-based networking (MultipeerConnectivity)
- Exchange business cards using QR codes, AirDrop, and other sharing methods
- Manage group memberships using zero-knowledge cryptographic proofs (Semaphore protocol)
- Export business cards to Apple Wallet (PassKit)

**Key Characteristics:**
- **Offline-First:** The App operates entirely without internet connectivity or remote servers
- **No Account Required:** No registration, login, or user accounts
- **Local Data Storage:** All data is stored exclusively on your iOS device
- **No Cloud Services:** We do not operate servers, databases, or cloud infrastructure

---

## 3. User Responsibilities

As a user of Solid(ar)ity, you agree to:

### 3.1 Accurate Information
- Provide accurate and truthful information in your business card
- Keep your business card information up to date
- Not impersonate any person or entity

### 3.2 Lawful Use
- Use the App only for lawful purposes and in compliance with all applicable laws
- Not use the App to transmit spam, malware, or harmful content
- Not use the App to harass, abuse, or harm others

### 3.3 Respect for Others
- Respect the privacy and intellectual property rights of other users
- Not share other users' information without their consent
- Not use information received through the App for unauthorized commercial purposes (e.g., bulk marketing, unsolicited communications)

### 3.4 Security
- Maintain the security of your iOS device
- Not attempt to circumvent security features of the App
- Not reverse engineer, decompile, or disassemble the App (except as permitted by applicable law)

---

## 4. Prohibited Uses

You may NOT use Solid(ar)ity to:

- Violate any local, state, national, or international law
- Infringe upon the intellectual property rights of others
- Transmit false, misleading, or fraudulent information
- Distribute viruses, malware, or other harmful code
- Engage in any form of harassment, bullying, or abuse
- Collect or harvest information from other users for unauthorized purposes
- Use the App for any commercial purpose without explicit authorization
- Interfere with or disrupt the App's functionality or other users' experience

---

## 5. Intellectual Property Rights

### 5.1 App Ownership
Solid(ar)ity is licensed under the **Apache License 2.0**. The source code is available at:
- https://github.com/kidneyweakx/solidarity

You are granted rights to use, modify, and distribute the App in accordance with the Apache 2.0 license terms.

### 5.2 User Content
- You retain all rights to the business card information you create
- By sharing your business card with other users, you grant them a limited license to view and store that information for personal, non-commercial use
- You are responsible for ensuring you have the right to share any information included in your business card

### 5.3 Trademarks
"Solid(ar)ity" and associated logos are trademarks of the developers. You may not use these trademarks without prior written permission, except as necessary to describe the App.

---

## 6. Privacy and Data

### 6.1 Privacy Policy
Your use of Solid(ar)ity is also governed by our [Privacy Policy](PRIVACY_POLICY.md), which is incorporated into these Terms by reference.

**Key Privacy Points:**
- We do NOT collect, store, or transmit your personal data to servers
- All data is stored locally on your device
- You control what information you share and with whom
- We do not track your usage or behavior

### 6.2 User Responsibility for Data
- You are solely responsible for maintaining backups of your data
- We are not responsible for data loss due to device failure, accidental deletion, or other causes
- The App provides local backup/export features—we encourage you to use them

---

## 7. Third-Party Services

### 7.1 Apple Services
The App integrates with Apple's native iOS frameworks:
- **MultipeerConnectivity** for peer-to-peer networking
- **PassKit** for Apple Wallet integration
- **Keychain** for secure cryptographic key storage

Your use of these Apple services is subject to Apple's terms and conditions.

### 7.2 Open-Source Libraries
The App uses the following open-source libraries for on-device computation:
- **SemaphoreSwift** (https://github.com/zkmopro/SemaphoreSwift) - Zero-knowledge proof generation
- **Mopro** (https://zkmopro.org/) - Mobile ZK proof optimization

These libraries operate entirely on your device and do not transmit data. They are subject to their respective open-source licenses.

### 7.3 No Third-Party Services
The App does NOT integrate with:
- Analytics or tracking services
- Advertising networks
- Cloud databases or authentication providers
- Cryptocurrency wallets or blockchain services (other than ENS name resolution, if enabled)

---

## 8. Disclaimers and Limitations of Liability

### 8.1 "AS IS" Basis
THE APP IS PROVIDED "AS IS" AND "AS AVAILABLE" WITHOUT WARRANTIES OF ANY KIND, EITHER EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO:
- Warranties of merchantability
- Fitness for a particular purpose
- Non-infringement
- Uninterrupted or error-free operation

### 8.2 No Guarantee of Availability
While we strive to maintain the App, we do not guarantee:
- Continuous availability or uptime (though the App works offline)
- Compatibility with all iOS devices or future iOS versions
- Error-free operation

### 8.3 Limitation of Liability
TO THE MAXIMUM EXTENT PERMITTED BY LAW, WE SHALL NOT BE LIABLE FOR:
- Any indirect, incidental, special, consequential, or punitive damages
- Loss of data, profits, revenue, or business opportunities
- Damages resulting from your use or inability to use the App
- Damages caused by third-party actions or content

**Maximum Liability:** Our total liability for any claims arising from your use of the App shall not exceed the amount you paid to download the App (if applicable), or $10 USD, whichever is greater.

### 8.4 Zero-Knowledge Proofs and Cryptography
The App implements advanced cryptographic features:

**Zero-Knowledge Proof Technology:**
- Uses Semaphore protocol for privacy-preserving group verification
- Proofs are generated on-device using Mopro framework
- ZK technology is provided for privacy enhancement, not absolute security

**Important Disclaimers:**
- No cryptographic system is completely impenetrable
- You are responsible for maintaining the security of your iOS device and private keys
- We are not liable for:
  - Loss of ZK identity keys stored in Keychain
  - Security breaches caused by device compromise or jailbreaking
  - Misuse of ZK proofs or group membership claims
  - Unauthorized access due to weak device security

**Cryptography Compliance:**
- All cryptography is used for privacy and security purposes only
- NOT used for financial transactions or cryptocurrency trading
- Compliant with export control regulations and iOS App Store guidelines

---

## 9. Indemnification

You agree to indemnify, defend, and hold harmless the developers of Solid(ar)ity, contributors, and affiliates from any claims, damages, losses, liabilities, and expenses (including legal fees) arising from:
- Your use or misuse of the App
- Your violation of these Terms
- Your violation of any third-party rights
- Information you share through the App

---

## 10. Updates and Changes

### 10.1 App Updates
We may release updates to improve functionality, fix bugs, or add features. Updates may be:
- Automatic (via the App Store)
- Optional or required for continued use

### 10.2 Changes to Terms
We reserve the right to modify these Terms at any time. Changes will be effective:
- Immediately upon posting the updated Terms in the App or on our website
- As indicated by the "Last Updated" date at the top of this document

Continued use of the App after changes constitutes your acceptance of the updated Terms.

---

## 11. Termination

### 11.1 Termination by You
You may stop using the App at any time by deleting it from your device.

### 11.2 Termination by Us
We reserve the right to discontinue the App or remove it from the App Store at any time, with or without notice.

### 11.3 Effect of Termination
Upon termination:
- Your license to use the App ends
- You should delete the App from your device
- Provisions regarding intellectual property, disclaimers, and limitations of liability survive termination

---

## 12. Dispute Resolution

### 12.1 Governing Law
These Terms shall be governed by and construed in accordance with the laws of **[Taiwan]**, without regard to conflict of law principles.

### 12.2 Arbitration (Optional)
Any disputes arising from these Terms or your use of the App shall be resolved through:
- Good-faith negotiation between the parties
- [Optional: Binding arbitration in accordance with [ARBITRATION RULES]]
- Litigation in the courts of [Taiwan] (if arbitration is not specified)

### 12.3 Class Action Waiver
You agree to resolve disputes individually and waive the right to participate in class actions or class-wide arbitration.

---

## 13. Miscellaneous

### 13.1 Entire Agreement
These Terms, together with the Privacy Policy, constitute the entire agreement between you and Solid(ar)ity regarding the use of the App.

### 13.2 Severability
If any provision of these Terms is found to be unenforceable, the remaining provisions shall remain in full force and effect.

### 13.3 No Waiver
Our failure to enforce any provision of these Terms does not constitute a waiver of that provision.

### 13.4 Assignment
You may not assign or transfer these Terms. We may assign these Terms to any successor or affiliate.

### 13.5 Force Majeure
We are not liable for delays or failures caused by events beyond our reasonable control (e.g., natural disasters, government actions, pandemics).

---

## 14. Open Source Licensing

Solid(ar)ity is licensed under the **Apache License 2.0**. The full license text is available at:
- https://www.apache.org/licenses/LICENSE-2.0

You are free to:
- Use, modify, and distribute the App's source code
- Create derivative works
- Use the software for commercial purposes

Subject to the conditions in the Apache 2.0 license, including:
- Providing attribution
- Including a copy of the license
- Stating any significant changes made to the code

---

## 15. Contact Information

If you have questions about these Terms or the App:

- **Email:** support@knyx.dev
- **GitHub Issues:** https://github.com/kidneyweakx/solidarity/issues
- **Source Code:** https://github.com/kidneyweakx/solidarity

---

## 16. Acknowledgment

By using Solid(ar)ity, you acknowledge that:
- You have read and understood these Terms
- You agree to be bound by these Terms
- You understand that the App operates entirely locally on your device
- You are responsible for your own data and device security

---

**Last Updated:** 2025.10.02

**Solid(ar)ity** - Privacy-first networking for the decentralized web.
