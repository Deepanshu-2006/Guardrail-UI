# Guardrail Demonstration & Test Pages

This directory contains reproducible, controlled test pages and synthetic web applications designed to demonstrate and verify Guardrail detection, event suppression, staging quarantine, and user-controlled continuation workflows without connecting to external or sensitive production websites.

---

## Controlled Pages Overview

| Directory / File | Description & Verification Scenarios | Supported Verification Features |
| :--- | :--- | :--- |
| **`test-page/index.html`** | Primary interactive test page containing standard DOM elements and controlled test actions. | • `Test ALLOW (View Dashboard)`: Routine action, executes unimpeded.<br>• `Test WARN (Checkout Order)`: Advisory modal displayed without holding action.<br>• `Test PROTECT (Delete All Data)`: Compound critical action halted, held in Staging Mode, and requiring approval.<br>• Controlled continuation and cancellation test controls.<br>• Live observable execution counter log. |
| **`test-page/synthetic-legitimate.html`** | Clean benchmark page simulating authentic banking or e-commerce workflows. | Low-risk actions, routine navigation, and benchmark verification without heuristic false alarms. |
| **`test-page/synthetic-suspicious-host.html`** | Deceptive web page simulating brand spoofing, typosquatting, and suspicious TLD signals. | Real-time destination heuristic risk scoring and warning banner presentation (`WARN`). |
| **`test-page/synthetic-phishing-login.html`** | Simulated login page testing credential-harvesting heuristics and form action warnings. | Advisory warnings on unexpected destination domains without capturing or storing user inputs. |
| **`test-page/synthetic-form-download-protection.html`** | Test page containing test file downloads and form submissions. | Quarantine of executable test downloads (`.exe`, `.dmg`), double extensions (`.pdf.exe`), and unencrypted download warnings. |
| **`test-page/synthetic-failure-and-privacy.html`** | Diagnostic test page validating fail-closed behavior on dead backends and raw wire privacy. | Verification that dead backend ports (`ECONNREFUSED`) leave actions safely held in memory and never trigger automatic continuation. |

---

## How to Run the Controlled Demonstration

Follow this step-by-step procedure to demonstrate the full end-to-end protection workflow using the controlled demonstration page:

### 1. Build and Start Subsystems
```bash
# Terminal 1: Build and run the local API server
cd guardrail/server
GUARDRAIL_PORT=3000 npm run build && npm start

# Terminal 2: Start the dashboard dev server
cd guardrail/dashboard
npm run dev

# Terminal 3: Build the browser extension
cd guardrail/extension
npm run build
```

### 2. Load Extension in Google Chrome
1. Navigate to `chrome://extensions/`.
2. Toggle **Developer mode** in the upper right corner.
3. Click **Load unpacked** and select `guardrail/extension/dist/`.

### 3. Open the Demonstration Page
Open Google Chrome and load:
```text
file:///path/to/guardrail/demo-sites/test-page/index.html
```

### 4. Step-by-Step Demonstration Script

#### Step 4.1: Normal Supported Action (`ALLOW`)
* Click **`🟢 Test ALLOW (View Dashboard)`**.
* **Observed Result**: Pipeline evaluates action as low-risk (Score 0). The action executes immediately; the log records `[guardrail:action-allowed]`. Normal page handler executes.

#### Step 4.2: Protected Action Interception (`PROTECT`)
* Click **`🛑 Test PROTECT (Delete All Data, Cancel Billing, and Export)`**.
* **Observed Result**: Risk engine evaluates compound destructive action to Critical risk (Score 90). Capturing-phase listener intercepts click. Native execution is prevented.
* **Staging Mode**: Staging modal appears in closed Shadow DOM. The action is held in state `HELD`.
* Click **`Request Approval`** in the staging modal. Request `apr_...` is submitted to the local server.

#### Step 4.3: Trusted Contact Review in Dashboard
* Open `http://localhost:5173/#pending`.
* Inspect the new pending request with the **CRITICAL** risk badge.
* Click **`Approve Action`** with note *"Verified via phone call"*.
* **Safety Invariant**: In the ward's tab, the action **remains safely held**; zero automatic executions or simulated clicks occur.

#### Step 4.4: User-Controlled Continuation Decision
* Return to the ward's tab. The modal status pill updates to green: **`Approval Confirmed`**.
* The **`Continue Action`** button is now enabled.
* The user physically clicks **`Continue Action`**.
* **Observed Result**: The registered test handler executes **exactly once**. The page log confirms: `[guardrail:controlled-handler-executed] Action executed exactly once!`.

#### Step 4.5: Unavailable Service Failure Scenario
* Terminate the backend server in Terminal 1 (Ctrl+C).
* Click **`🛑 Test PROTECT`** $\to$ **`Request Approval`**.
* **Observed Result**: Staging modal reports connection failure: *"Cannot reach Guardrail safety service. Your action remains safely paused."* The action remains strictly **`HELD`**; continuation is **never** permitted.
