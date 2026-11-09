# Guardrail Browser Download Monitoring & Safety Architecture Specification

**Document Status:** Complete & Authoritative  
**Milestone:** Day 28 (*Form Protection & Download Safety*)  
**Target Subsystems:** Extension Manifest, Background Service Worker, Chrome Downloads API, Risk Engine, Download Safety Detector  
**System Invariants:** Pure Local Heuristics, Least-Privilege Manifest Permissions, No File Execution, Truthful Protective Mitigation, Bounded Ephemeral Memory (Zero Persistent History Storage)  

---

## 1. Executive Summary

As part of the **Day 28 milestone**, this specification establishes the architecture, event lifecycle, risk heuristics, mitigation boundaries, and testing contracts for **Browser Download Monitoring and Risk Assessment** in Guardrail.

Prior to Day 28, download detection was limited to superficial DOM keyword matching on button/link text (e.g. `download`, `export`) with an inert +10 risk score contribution. The extension possessed zero visibility into native browser downloads, direct URL downloads, `Content-Disposition: attachment` responses, final filenames, or MIME types.

Under the Day 28 architecture:
1. **Supported Browser API Monitoring:** The extension background service worker registers capturing listeners on supported Chrome Extensions API events (`chrome.downloads.onCreated`, `chrome.downloads.onDeterminingFilename`, `chrome.downloads.onChanged`) under the least-privilege `"downloads"` permission.
2. **Deterministic Metadata Normalization:** Normalizes filenames safely, stripping directory paths (POSIX and Windows), decoding percent-encodings, neutralising deceptive Unicode Bidirectional overrides (RTL `\u202E`), and stripping trailing evasion dots/spaces.
3. **Deep Structural Risk Inspection:**
   - Evaluates high-risk executable binaries (`.exe`, `.msi`, `.dmg`, `.pkg`, `.scr`, `.pif`, `.cpl`, `.com`).
   - Identifies interpretable scripts and macro formats (`.bat`, `.cmd`, `.ps1`, `.vbs`, `.js`, `.hta`, `.reg`, `.jar`).
   - Detects misleading double extensions (e.g., `invoice.pdf.exe`, `receipt.docx.vbs`).
   - Flags severe mismatches between declared HTTP MIME types and file extensions (e.g., `application/x-msdownload` masquerading with a `.pdf` or `.jpg` extension).
   - Identifies downloads originating from raw IP addresses, suspicious lookalike domains, or cleartext HTTP transport.
4. **Integration with Guardrail Risk Engine:** Dynamically scales score contributions and emits machine-readable structured evaluation reasons (`DOWNLOAD_SUSPICIOUS_EXECUTABLE_EXTENSION`, `DOWNLOAD_MIME_TYPE_MISMATCH`, etc.).
5. **Truthful Mitigation Reporting:** Downloads are never reported as paused or blocked unless the browser API confirms the state transition via an `onChanged` event delta (`paused.current === true` or `state.current === 'interrupted'`).
6. **Bounded Ephemeral Cache:** Assessments are stored strictly in an in-memory LRU cache capped at 50 items with automated TTL eviction. Zero persistent download history is retained.
7. **Strict Safety Invariants:** Downloaded files are **never opened or executed**, and no external scanning service is invoked.

---

## 2. Browser Extension Manifest & Least Privilege

### 2.1 Manifest Permissions Review
Inspection of `guardrail/extension/public/manifest.json` confirms that prior to Day 28, the manifest declared only:
```json
{
  "permissions": [
    "storage"
  ]
}
```

### 2.2 Verified Permission Addition
To monitor download creation, inspect definitive filenames before disk write, and apply protective pauses/cancellations, the Manifest V3 `downloads` permission is required.

No other permissions (such as `webRequest`, `declarativeNetRequest`, `cookies`, or `nativeMessaging`) are needed or requested.

```json
{
  "manifest_version": 3,
  "name": "Guardrail",
  "permissions": [
    "storage",
    "downloads"
  ]
}
```

---

## 3. Supported Browser Download Lifecycle Architecture

The browser download monitoring pipeline operates across three deterministic lifecycle phases in the background service worker:

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│                   BROWSER DOWNLOAD MONITORING LIFECYCLE                          │
├──────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  Phase 1: chrome.downloads.onCreated                                             │
│  ├─ Download item created (preliminary metadata: url, mime, state)               │
│  ├─ Filename may be empty string (pending browser resolution)                    │
│  ├─ Fallback to URL pathname normalization if available                          │
│  └─ Initial preliminary evaluation recorded in bounded memory cache              │
│                                                                                  │
│  Phase 2: chrome.downloads.onDeterminingFilename (Pre-Write Gate)                │
│  ├─ Browser has determined candidate local filename before disk write            │
│  ├─ Runs evaluateDownloadSafety() on definitive filename + MIME + URL            │
│  ├─ Evaluates executable extensions, double extensions, MIME mismatches          │
│  ├─ If PROTECT recommended: invokes chrome.downloads.pause(id) or cancel(id)    │
│  └─ Invokes suggest() callback to keep browser download shelf uninhibited        │
│                                                                                  │
│  Phase 3: chrome.downloads.onChanged (Truthful Confirmation)                     │
│  ├─ Receives state deltas (paused, state: 'complete' | 'interrupted', error)     │
│  ├─ Verifies browser-acknowledged state transition                               │
│  ├─ Marks protectiveActionConfirmed: true ONLY upon verified delta confirmation │
│  └─ Prunes completed/interrupted records upon TTL expiry                         │
│                                                                                  │
└──────────────────────────────────────────────────────────────────────────────────┘
```

### 3.1 Two-Phase Metadata Resolution
In Chromium browsers, `onCreated` fires immediately when a transfer begins, but `downloadItem.filename` is frequently an empty string while the browser inspects HTTP `Content-Disposition` headers or queries the operating system shell.

Guardrail accommodates this two-phase sequence:
- If `filename` is empty at `onCreated`, the detector attempts safe pathname extraction from `downloadItem.finalUrl || downloadItem.url`. If still absent, it emits `UNAVAILABLE_DOWNLOAD_METADATA` as a preliminary assessment.
- When `onDeterminingFilename` fires with the definitive filename, Guardrail runs full structural inspection before bytes are committed to disk.

---

## 4. Metadata Normalization & Structural Heuristics

### 4.1 Filename Normalization Invariants
Malicious download distribution routinely attempts extension evasion through path traversal, URL encoding, trailing dots/spaces, or Unicode directional tricks.

`normalizeFilename(rawFilename: string): NormalizedFilenameInfo` enforces:
1. **Path Stripping:** Strips POSIX (`/`) and Windows (`\`) directory components using `extractBasename()`.
2. **URL Decoding:** Safely decodes percent-encoded characters (e.g. `report%2Epdf%2Eexe` $\rightarrow$ `report.pdf.exe`).
3. **Unicode RTL & Control Character Neutralisation:** Detects and strips Bidirectional override codes (Right-to-Left Override `\u202E`, `\u202D`, `\u202C`, `\u200E`, `\u200F`), zero-width spaces (`\u200B`, `\u200C`, `\u200D`), and null bytes (`\0`). Flags `hasRtlOverride: true`.
4. **Trailing Dots/Spaces Stripping:** Strips trailing dots and whitespace that Windows operating systems trim during file creation (e.g., `payload.exe. . .` $\rightarrow$ `payload.exe`). Flags `hasTrailingDotsOrSpaces: true`.
5. **Compound vs Double Extension Analysis:**
   - Compound archives (e.g., `.tar.gz`, `.tar.bz2`, `.tar.xz`) are recognized as single compound archive types.
   - Files with primary executable/script extension and secondary document/media extension (e.g., `.pdf.exe`, `.docx.vbs`, `.xlsx.scr`, `.jpg.bat`) are flagged as `isDoubleExtension: true`.

### 4.2 Extension Categorization
| Category | Extensions | Default Risk Impact |
|:---|:---|:---:|
| **Executable Binaries** | `.exe`, `.msi`, `.msp`, `.dmg`, `.pkg`, `.app`, `.deb`, `.rpm`, `.appimage`, `.bin`, `.scr`, `.pif`, `.cpl`, `.com`, `.gadget`, `.msc` | **HIGH** (+45) |
| **Scripts & Macros** | `.bat`, `.cmd`, `.ps1`, `.psm1`, `.vbs`, `.vbe`, `.js`, `.jse`, `.wsf`, `.wsh`, `.hta`, `.reg`, `.inf`, `.sh`, `.py`, `.jar` | **HIGH** (+40) |
| **Archives & Disk Images** | `.iso`, `.img`, `.vhd`, `.vhdx`, `.zip`, `.rar`, `.7z`, `.tar`, `.gz`, `.bz2`, `.cab` | **MEDIUM** (+20) |
| **Documents (Benign)** | `.pdf`, `.doc`, `.docx`, `.xls`, `.xlsx`, `.ppt`, `.pptx`, `.odt`, `.ods`, `.txt`, `.csv` | **LOW** (0) |
| **Media & Assets (Benign)**| `.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`, `.svg`, `.mp3`, `.wav`, `.mp4`, `.webm` | **LOW** (0) |
| **Web & Markup (Benign)** | `.json`, `.xml`, `.css`, `.html`, `.htm` | **LOW** (0) |

---

## 5. Filename and MIME-Type Mismatch Evaluation

Neither MIME types nor filenames can be trusted in isolation:
- Attackers configure web servers to serve executables with innocent MIME headers (`image/jpeg`, `text/plain`, `application/pdf`) to evade network gateways.
- Conversely, attackers name executable payloads with `.pdf` or `.png` extensions while the server delivers native binary MIME types (`application/x-msdownload`).

### Mismatch Decision Matrix:
| Extension Category | Server Declared MIME Type | Evaluation Result | Indicator Emitted |
|:---|:---|:---:|:---|
| Benign Document / Media (`.pdf`, `.png`, `.jpg`) | Executable (`application/x-msdownload`, `application/x-executable`) | **Severe Mismatch** (+50) | `MIME_TYPE_MISMATCH` |
| Executable / Script (`.exe`, `.vbs`, `.bat`) | Image / Text (`image/jpeg`, `text/plain`, `image/png`) | **Severe Mismatch** (+40) | `MIME_TYPE_MISMATCH` |
| Executable / Script (`.exe`, `.dmg`) | Binary Stream (`application/octet-stream`) | Consistent Binary | None (extension evaluated) |
| Any Extension | Missing / Empty / Undetermined | Metadata Incomplete | `UNAVAILABLE_DOWNLOAD_METADATA` |
| Benign Document (`.pdf`) | Matching Document (`application/pdf`) | Valid Matching | None |

> [!IMPORTANT]
> **Heuristic Disclaimer:** An `application/octet-stream` MIME header does not prove or disprove safety; it is the HTTP standard fallback for arbitrary binary data. Guardrail surfaces mismatches as heuristic risk signals, not proof of malice.

---

## 6. Origin & Transport Risk Assessment

1. **Raw IP Address Origins:** Downloads originating from public IPv4/IPv6 addresses (e.g. `http://198.51.100.24/setup.exe`) trigger `SUSPICIOUS_DOWNLOAD_ORIGIN` (+40).
2. **Insecure Cleartext HTTP Transport:** Executable, script, or double-extension downloads conducted over unencrypted plain `http:` connections trigger `INSECURE_DOWNLOAD_TRANSPORT` (+30), warning users of potential in-flight tampering or interception. Localhost/loopback addresses are exempted.
3. **Unexpected Protocols:** Downloads initiated via `data:`, `blob:`, or `javascript:` URIs containing executable payloads trigger `UNEXPECTED_DOWNLOAD_SCHEME` (+35).
4. **Browser SafeBrowsing Signals:** If the browser's built-in SafeBrowsing engine flags a danger state (`file`, `url`, `content`, `uncommon`, `unwanted`), Guardrail records `BROWSER_DANGER_FLAGGED` (+45 to +60) and escalates protective recommendations to `CANCEL`.

---

## 7. Truthful Mitigation & Protective Action Semantics

Guardrail adheres strictly to **reporting integrity**:

1. **No False Claims of Blocking:**
   - Requesting `chrome.downloads.pause()` or `chrome.downloads.cancel()` does not guarantee that the download has been stopped; the browser might reject the call if the download already completed or failed.
   - `DownloadSafetyEvaluation.protectiveActionConfirmed` remains `false` until an `onChanged` event confirms:
     - For `PAUSE`: `delta.paused.current === true`.
     - For `CANCEL`: `delta.state.current === 'interrupted'`.
2. **Interrupted Download Handling:**
   - If a download is already in `interrupted` state (`NETWORK_FAILED`, `FILE_ACCESS_DENIED`, `FILE_BLOCKED`), Guardrail records the failure error code in `interruptionDetail` and sets `protectiveActionRecommended: 'NONE'`. It never attempts redundant pauses on halted transfers.

---

## 8. Ephemeral Retention & Privacy Boundaries

To prevent unnecessary tracking or persistent recording of user browsing habits:
- **No Disk Storage of Downloads:** Guardrail does **not** persist download URLs, filenames, or metadata to `chrome.storage.local`, SQLite, or IndexedDB.
- **Bounded LRU Memory Cache:** `BrowserDownloadManager` maintains an in-memory `Map` capped at `MAX_ACTIVE_DOWNLOADS = 50`. When capacity is reached, the oldest entries are evicted.
- **Time-to-Live Pruning:** Completed or interrupted download records are automatically pruned after `ttlMs = 60,000 ms`.
- **Zero File Execution:** `chrome.downloads.open` is never imported, called, or exposed.
- **Pure Local Assessment:** No download URLs, file hashes, or metadata are ever transmitted to third-party reputation or cloud scanning endpoints.

---

## 9. Verification & Test Suite Summary

The Day 28 download protection subsystem is verified through two multi-tier test suites comprising **221 automated assertions**:

1. **Unit Test Suite (`test-download-safety-unit.ts` - 186 assertions):**
   - Filename sanitization, path stripping, URL decoding, Unicode RTL overrides (`\u202E`), trailing dots/spaces.
   - Common benign documents (`.pdf`, `.docx`, `.csv`) and media (`.png`, `.jpg`, `.mp4`).
   - High-risk executables (`.exe`, `.msi`, `.dmg`, `.pkg`, `.scr`, `.pif`, `.cpl`, `.com`).
   - Scripts and macros (`.bat`, `.cmd`, `.ps1`, `.vbs`, `.js`, `.hta`, `.reg`, `.jar`).
   - Deceptive double extensions (`.pdf.exe`, `.docx.vbs`, `.xlsx.scr`, `.jpg.bat`).
   - Severe MIME mismatches (document extension + executable MIME, executable extension + image MIME).
   - Suspicious origins (raw IP addresses, insecure HTTP transport, data URIs).
   - Missing and unavailable metadata fallback to URL pathname.
   - Interrupted downloads with error code preservation.
   - Native SafeBrowsing danger flags (`file`, `url`, `uncommon`).
   - Integration with `RiskEngine`, `evaluateAllRiskRules`, and `RISK_RULE_DOWNLOAD`.

2. **Workflow Test Suite (`test-download-monitoring-workflow.ts` - 35 assertions):**
   - Lifecycle event observation (`onCreated`, `onDeterminingFilename`, `onChanged`).
   - Two-phase metadata resolution (empty filename at creation $\rightarrow$ definitive filename at determining).
   - Pre-write protective pause and cancellation execution.
   - Truthful browser confirmation invariant via `onChanged` delta verification.
   - SafeBrowsing danger state cancellation.
   - Bounded in-memory cache capacity (3-item max test with oldest eviction) and `clearHistory()`.
   - Manual mitigation controls (`pauseDownload`, `cancelDownload`).
   - Zero reference to file execution APIs.
