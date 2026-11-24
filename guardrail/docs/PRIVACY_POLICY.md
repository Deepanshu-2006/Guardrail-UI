# Guardrail — Privacy Policy

**Effective Date:** November 2026  
**Version:** 1.0.0  
**Application:** Guardrail Browser Extension & Trusted Contact Oversight Portal  

---

## 1. Overview & Core Philosophy

Guardrail is built on the principle of **Separation of Duties** and **Zero Sensitive Data Exposure**. Our mission is to protect individuals (wards) from deceptive online actions, phishing lookalikes, and accidental high-risk operations while strictly preserving personal autonomy, digital dignity, and complete communications privacy.

Guardrail is fundamentally designed so that:
1. **Your trusted contact never sees your browsing history or passwords.**
2. **Your trusted contact never gains remote control over your computer, browser, or screen.**
3. **No financial credentials, passwords, or personal messages are ever collected, logged, or sold.**

---

## 2. Invariant Safety & Privacy Guarantees

### Invariant 1: Separation of Duties
* **The Ward** retains sole physical execution authority. An action staged for review can only be physically confirmed or cancelled by the user at their browser.
* **The Trusted Contact (Caretaker)** serves strictly as an out-of-band second pair of eyes. They receive only high-level threat rationale (e.g., *"High risk: Domain lookalike detected on example-bank.in"*), not the page contents or form values.
* The Caretaker cannot initiate actions, navigate tabs, or modify the ward's settings remotely.

### Invariant 2: Zero Sensitive Data Transmission
* **Zero Credentials Collected:** Passwords, PINs, CVVs, credit card numbers, OTPs, session cookies, and personal email contents are **never** captured, transmitted, or saved.
* Form evaluation occurs locally within the browser's DOM memory sandbox during document idle.
* If a high-risk form or navigation is evaluated, only the target domain and the rule trigger category are sent for approval routing.

### Invariant 3: Zero Data Monetization
* User data is **never** sold, rented, monetized, or shared with data brokers, ad networks, or third-party marketing platforms.
* No analytics trackers, behavioral profiling scripts, or advertising SDKs exist in Guardrail extension or portal code.

---

## 3. Chrome Web Store Permissions & Usage

To provide real-time browser safety, Guardrail requires the following Chrome Manifest V3 permissions:

| Permission | Usage Scope | Why It Is Essential |
| :--- | :--- | :--- |
| `<all_urls>` *(Content Script)* | Injected at `document_idle` across visited origins | **Deceptive Domain & Phishing Defense:** Phishing, spoofed bank portals, and malicious forms appear on arbitrary top-level domains. Guardrail must evaluate the current origin to detect deceptive lookalikes and hold high-risk actions in Staging Mode before data leaves the browser. |
| `storage` | `chrome.storage.local` | **Local Policy & State:** Persists active rule configurations, policy version counters, and encrypted authentication tokens locally across browser restarts. |
| `downloads` | `chrome.downloads` listener | **Malicious Download Interception:** Inspects initiated file downloads to alert the user before dangerous executables (.exe, .scr, .bat) from untrusted origins are saved. |
| `identity` | `chrome.identity.launchWebAuthFlow` | **Caretaker Pairing & Authentication:** Enables secure sign-in via Google OAuth to establish cryptographic pairing codes between the ward and their family guardian. |

---

## 4. Data Storage & Retention

* **Extension Client:** All local state (including pairing status and cached rules) is stored within Chrome's isolated `chrome.storage.local` sandbox.
* **Backend Storage:** If using the companion Guardrail server, pairing records, approval request metadata (action ID, timestamp, domain, decision state), and notification subscriptions are stored in an encrypted SQLite database.
* **Revocation & Deletion:**
  - Clicking **Sign Out** or **Disconnect Ward** immediately purges all pairing tokens from local storage and deletes the relationship from the backend database.
  - Revoking an invitation permanently invalidates its pairing code.

---

## 5. Contact & Inquiries

For privacy inquiries, audit questions, or technical verification of our open security invariants, please contact:
* **Project Repository:** Guardrail Browser Security
* **Support Email:** `privacy@guardrail.local`
