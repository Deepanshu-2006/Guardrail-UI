# Chrome Web Store Review Disclosures & Justifications

> **Extension Name:** Guardrail  
> **Version:** 1.0.0  
> **Manifest Version:** 3  
> **Category:** Productivity / Privacy & Security  

---

## 1. Single Purpose Description

Guardrail provides client-side browser safety observability, deceptive action detection, synchronous staging of high-risk operations (such as bank lookalikes or sensitive credential submissions), and out-of-band approval routing to designated trusted contacts (family guardians).

---

## 2. Permissions Justification

| Permission | Technical Requirement | Justification for Google Review |
| :--- | :--- | :--- |
| `<all_urls>` | Content Script injection across visited origins (`document_idle`) | **Deceptive domain & phishing protection:** Malicious sites and spoofed banking portals can appear on any arbitrary top-level domain. Guardrail must evaluate the active origin to detect deceptive lookalikes (e.g. `axis.bank.in`, `icici.bank.in`) and synchronously pause sensitive form submissions before credentials or funds leave the browser. |
| `storage` | `chrome.storage.local` API | **Safety policy & session state:** Securely persists the active protection rules, cached policy versioning, and the user's authentication token across browser restarts without sending browsing history to external servers. |
| `downloads` | `chrome.downloads.onCreated` / `onDeterminingFilename` | **Deceptive download safety:** Monitors initiated file downloads to warn users before potentially harmful executables or scripts are downloaded from untrusted origins. |
| `identity` | `chrome.identity.launchWebAuthFlow` | **Authenticated Caretaker Pairing:** Allows the user to authenticate with their Google account to securely establish a cryptographic pairing code with their designated family guardian or trusted contact. |

---

## 3. Data Usage & Privacy Declaration

### Invariant 1: Separation of Duties Guarantee
* The trusted contact (caretaker) **never** gains remote control over the user's screen, browser history, or passwords.
* Caretakers only receive plain-English threat rationale for held, high-risk actions (e.g., *"Alice is requesting approval to proceed on [Domain]"*) and can only grant or deny consent.
* The user retains physical execution authority to confirm or cancel the action.

### Invariant 2: Zero Sensitive Data Transmission
* Passwords, CVVs, credit card numbers, OTPs, session cookies, and personal communication histories are **never** logged, collected, or transmitted to Guardrail servers or trusted contacts.
* Form interception operates locally inside the browser's DOM sandbox.

### Invariant 3: Zero Data Monetization
* User data is never sold, leased, or transferred to third-party data brokers or advertising networks.

---

## 4. Web Store Listing Copy

* **Short Description (up to 132 characters):**
  > Real-time browser safety guard, action staging, and trusted contact approval network for family protection.

* **Detailed Description:**
  > Guardrail protects you and your loved ones from deceptive online actions, phishing lookalikes, and accidental high-risk operations.
  >
  > When an anomalous or critical action occurs (such as an unexpected checkout, banking lookalike, or deceptive form), Guardrail safely pauses the action in Staging Mode and notifies your designated trusted contact (such as a family guardian) to review and approve the request.
  >
  > **Key Features:**
  > • Real-time deceptive URL and phishing lookalike detection
  > • Synchronous Staging Mode: blocks dangerous actions before funds or credentials are lost
  > • One-click pairing with your trusted contact using encrypted QR codes and invite keys
  > • Absolute privacy guarantee: your caretaker never sees your browsing history or passwords
