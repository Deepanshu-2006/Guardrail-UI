/**
 * Guardrail Download Safety & Risk Assessment Unit Test Suite
 *
 * Verifies the download detection engine across:
 * 1. Common file types (benign documents, media, archives, web assets).
 * 2. Suspicious executable extensions (.exe, .msi, .dmg, .pkg, .scr, etc.).
 * 3. Script-based and interpretable downloads (.bat, .cmd, .ps1, .vbs, .js, .hta).
 * 4. Misleading double extensions (invoice.pdf.exe, document.docx.vbs).
 * 5. Unicode directional overrides (RTL \u202E) and trailing dots/spaces.
 * 6. Mismatches between declared MIME type and filename extension.
 * 7. Incomplete, streaming, or unavailable metadata.
 * 8. Interrupted downloads and error state handling.
 * 9. Suspicious download origins (raw IP addresses, insecure HTTP transport).
 * 10. Native browser danger flags (SafeBrowsing).
 * 11. Risk Engine integration, dynamic scoring, and structured reasons.
 * 12. Strict safety invariants (zero execution, heuristic disclaimers).
 */

import {
  evaluateDownloadSafety,
  evaluateMimeMismatch,
  extractBasename,
  normalizeFilename,
} from '../utils/download-detector.js';
import { DownloadSafetyIndicatorCode } from '../types/download.js';
import { ActionCategory, ActionType, GuardrailAction } from '../types/actions.js';
import { RiskEngine } from './engine.js';
import { RiskLevel, RiskSignalId } from '../types/risk.js';
import { evaluateAllRiskRules } from './rules.js';

let passed = 0;
let failed = 0;

function assert(condition: boolean, testName: string, detail?: string): void {
  if (condition) {
    console.log(`  ✓ PASS: ${testName}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${testName}${detail ? ` - ${detail}` : ''}`);
    failed++;
  }
}

function assertEquals<T>(actual: T, expected: T, testName: string): void {
  const isMatch = actual === expected || JSON.stringify(actual) === JSON.stringify(expected);
  if (isMatch) {
    console.log(`  ✓ PASS: ${testName} === ${String(expected)}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${testName} (Expected ${String(expected)}, Got ${String(actual)})`);
    failed++;
  }
}

console.log('======================================================');
console.log('Guardrail Download Safety & Risk Assessment Unit Tests');
console.log('======================================================\n');

// -----------------------------------------------------------------------------
// Test 1: Filename Normalization & Sanitization
// -----------------------------------------------------------------------------
console.log('--- Test 1: Filename Normalization & Sanitization ---');
{
  assertEquals(extractBasename('/usr/local/downloads/document.pdf'), 'document.pdf', 'Extracts POSIX path basename');
  assertEquals(extractBasename('C:\\Users\\User\\Downloads\\setup.exe'), 'setup.exe', 'Extracts Windows path basename');
  assertEquals(extractBasename('file_without_path.txt'), 'file_without_path.txt', 'Preserves basename without path');

  // URL percent-decoding
  const urlEncoded = normalizeFilename('my%20financial%20report%2Epdf');
  assertEquals(urlEncoded.sanitizedBasename, 'my financial report.pdf', 'Decodes percent-encoded filename');
  assertEquals(urlEncoded.primaryExtension, 'pdf', 'Extracts primary extension from percent-encoded filename');

  // Trailing dots and spaces (Windows evasion tactic)
  const trailingDots = normalizeFilename('payload.exe. . .');
  assert(trailingDots.hasTrailingDotsOrSpaces, 'Flags hasTrailingDotsOrSpaces for trailing dots/spaces');
  assertEquals(trailingDots.primaryExtension, 'exe', 'Normalizes primary extension despite trailing dots');
  assertEquals(trailingDots.sanitizedBasename, 'payload.exe', 'Strips trailing dots and spaces');

  // Unicode Right-to-Left Override (\u202E) evasion tactic
  // e.g. document\u202Ecod.exe renders as documentexe.doc
  const rtlFilename = 'document\u202Ecod.exe';
  const rtlNorm = normalizeFilename(rtlFilename);
  assert(rtlNorm.hasRtlOverride, 'Detects Unicode RTL override in filename');
  assertEquals(rtlNorm.primaryExtension, 'exe', 'Primary extension resolved as exe');
  assert(!rtlNorm.sanitizedBasename.includes('\u202E'), 'Strips RTL override character from sanitizedBasename');
}

// -----------------------------------------------------------------------------
// Test 2: Common Benign File Types
// -----------------------------------------------------------------------------
console.log('\n--- Test 2: Common Benign File Types ---');
{
  const testCases = [
    { filename: 'quarterly_report.pdf', mime: 'application/pdf', category: 'document' },
    { filename: 'user_guide.docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', category: 'document' },
    { filename: 'sales_data.csv', mime: 'text/csv', category: 'document' },
    { filename: 'profile_picture.png', mime: 'image/png', category: 'media' },
    { filename: 'banner.jpg', mime: 'image/jpeg', category: 'media' },
    { filename: 'presentation.mp4', mime: 'video/mp4', category: 'media' },
    { filename: 'dataset.json', mime: 'application/json', category: 'web' },
  ];

  for (const tc of testCases) {
    const norm = normalizeFilename(tc.filename);
    assertEquals(norm.extensionCategory, tc.category, `Categorizes ${tc.filename} as ${tc.category}`);

    const evaluation = evaluateDownloadSafety({
      id: 101,
      filename: tc.filename,
      mime: tc.mime,
      url: `https://example.com/assets/${tc.filename}`,
    });

    assert(!evaluation.isSuspicious, `Benign ${tc.filename} is not suspicious`);
    assertEquals(evaluation.riskLevel, RiskLevel.LOW, `Benign ${tc.filename} has LOW risk level`);
    assert(evaluation.score <= 24, `Score for ${tc.filename} is <= 24 (got ${evaluation.score})`);
    assertEquals(evaluation.protectiveActionRecommended, 'NONE', `Recommends NONE for benign ${tc.filename}`);
  }
}

// -----------------------------------------------------------------------------
// Test 3: Suspicious Executable Extensions
// -----------------------------------------------------------------------------
console.log('\n--- Test 3: Suspicious Executable Extensions ---');
{
  const execCases = [
    { filename: 'installer.exe', ext: 'exe' },
    { filename: 'setup_wizard.msi', ext: 'msi' },
    { filename: 'SoftwarePackage.dmg', ext: 'dmg' },
    { filename: 'driver_update.pkg', ext: 'pkg' },
    { filename: 'screensaver.scr', ext: 'scr' },
    { filename: 'shortcut.pif', ext: 'pif' },
    { filename: 'control_panel.cpl', ext: 'cpl' },
    { filename: 'legacy_app.com', ext: 'com' },
  ];

  for (const tc of execCases) {
    const evaluation = evaluateDownloadSafety({
      id: 201,
      filename: tc.filename,
      mime: 'application/octet-stream',
      url: `https://trusted-vendor.com/download/${tc.filename}`,
    });

    assert(evaluation.isSuspicious, `Executable ${tc.filename} is flagged as suspicious`);
    assert(
      evaluation.indicators.some((i) => i.code === DownloadSafetyIndicatorCode.SUSPICIOUS_EXECUTABLE_EXTENSION),
      `Emits SUSPICIOUS_EXECUTABLE_EXTENSION for ${tc.filename}`
    );
    assert(evaluation.score >= 45, `Executable score is >= 45 (got ${evaluation.score})`);
    assert(
      evaluation.riskLevel === RiskLevel.MEDIUM || evaluation.riskLevel === RiskLevel.HIGH,
      `Risk level is elevated for ${tc.filename}`
    );
    assert(
      evaluation.reasons.some((r) => r.includes(`.${tc.ext}`)),
      `Reasons cite executable extension .${tc.ext}`
    );
  }
}

// -----------------------------------------------------------------------------
// Test 4: Potentially Executable Script-Based Downloads
// -----------------------------------------------------------------------------
console.log('\n--- Test 4: Potentially Executable Script-Based Downloads ---');
{
  const scriptCases = [
    { filename: 'run_task.bat', ext: 'bat' },
    { filename: 'configure.cmd', ext: 'cmd' },
    { filename: 'deploy_script.ps1', ext: 'ps1' },
    { filename: 'macro_updater.vbs', ext: 'vbs' },
    { filename: 'downloader.js', ext: 'js' },
    { filename: 'application.hta', ext: 'hta' },
    { filename: 'registry_patch.reg', ext: 'reg' },
    { filename: 'tool.jar', ext: 'jar' },
  ];

  for (const tc of scriptCases) {
    const evaluation = evaluateDownloadSafety({
      id: 301,
      filename: tc.filename,
      url: `https://example.com/scripts/${tc.filename}`,
    });

    assert(evaluation.isSuspicious, `Script ${tc.filename} is flagged as suspicious`);
    assert(
      evaluation.indicators.some((i) => i.code === DownloadSafetyIndicatorCode.SCRIPT_BASED_DOWNLOAD),
      `Emits SCRIPT_BASED_DOWNLOAD for ${tc.filename}`
    );
    assert(evaluation.score >= 40, `Script score is >= 40 (got ${evaluation.score})`);
  }
}

// -----------------------------------------------------------------------------
// Test 5: Misleading Double Extensions
// -----------------------------------------------------------------------------
console.log('\n--- Test 5: Misleading Double Extensions ---');
{
  const doubleExtCases = [
    { filename: 'Annual_Tax_Invoice.pdf.exe', primary: 'exe', secondary: 'pdf' },
    { filename: 'Urgent_Receipt.docx.vbs', primary: 'vbs', secondary: 'docx' },
    { filename: 'Financial_Spreadsheet.xlsx.scr', primary: 'scr', secondary: 'xlsx' },
    { filename: 'employee_photo.jpg.bat', primary: 'bat', secondary: 'jpg' },
  ];

  for (const tc of doubleExtCases) {
    const norm = normalizeFilename(tc.filename);
    assert(norm.isDoubleExtension, `Identifies ${tc.filename} as double extension`);
    assertEquals(norm.primaryExtension, tc.primary, `Primary extension is ${tc.primary}`);
    assertEquals(norm.secondaryExtension, tc.secondary, `Secondary extension is ${tc.secondary}`);

    const evaluation = evaluateDownloadSafety({
      id: 401,
      filename: tc.filename,
      url: `https://downloads-portal.test/${tc.filename}`,
    });

    assert(evaluation.isSuspicious, `Double extension ${tc.filename} is flagged as suspicious`);
    assert(
      evaluation.indicators.some((i) => i.code === DownloadSafetyIndicatorCode.MISLEADING_DOUBLE_EXTENSION),
      `Emits MISLEADING_DOUBLE_EXTENSION indicator for ${tc.filename}`
    );
    // Compounding: double extension (+50) + executable (+45) => score >= 75 (CRITICAL)
    assert(evaluation.score >= 75, `Score for double extension is >= 75 (got ${evaluation.score})`);
    assertEquals(evaluation.riskLevel, RiskLevel.CRITICAL, `Risk level is CRITICAL for ${tc.filename}`);
    assertEquals(evaluation.protectiveActionRecommended, 'PAUSE', 'Recommends PAUSE on critical double extension');
  }

  // Legitimate compound extensions must NOT be flagged as double extensions
  const legitimateCompound = normalizeFilename('archive_source.tar.gz');
  assert(!legitimateCompound.isDoubleExtension, 'tar.gz is recognized as legitimate compound archive, not double extension');
  assertEquals(legitimateCompound.extensionCategory, 'archive', 'Categorized as archive');
}

// -----------------------------------------------------------------------------
// Test 6: Filename and MIME-Type Mismatches
// -----------------------------------------------------------------------------
console.log('\n--- Test 6: Filename and MIME-Type Mismatches ---');
{
  // Severe Mismatch 1: Benign document extension with executable binary MIME
  const docWithExeMime = evaluateDownloadSafety({
    id: 501,
    filename: 'statement.pdf',
    mime: 'application/x-msdownload',
    url: 'https://bank.example.test/statement.pdf',
  });

  assert(docWithExeMime.isSuspicious, 'Document with executable MIME is suspicious');
  assert(
    docWithExeMime.indicators.some((i) => i.code === DownloadSafetyIndicatorCode.MIME_TYPE_MISMATCH),
    'Emits MIME_TYPE_MISMATCH indicator'
  );
  assert(docWithExeMime.mimeAnalysis?.isSevereMismatch === true, 'Flagged as severe mismatch');
  assert(docWithExeMime.score >= 50, `Score reflects severe MIME mismatch (got ${docWithExeMime.score})`);

  // Severe Mismatch 2: Executable extension disguised with image MIME
  const exeWithImageMime = evaluateDownloadSafety({
    id: 502,
    filename: 'game_update.exe',
    mime: 'image/jpeg',
    url: 'https://games.test/update.exe',
  });

  assert(exeWithImageMime.isSuspicious, 'Executable disguised with image MIME is suspicious');
  assert(exeWithImageMime.mimeAnalysis?.isSevereMismatch === true, 'Flagged as severe disguise mismatch');
  assert(
    exeWithImageMime.indicators.some((i) => i.code === DownloadSafetyIndicatorCode.MIME_TYPE_MISMATCH),
    'Emits MIME_TYPE_MISMATCH indicator'
  );

  // Generic binary stream: application/octet-stream on document is not severe mismatch
  const docWithOctetStream = evaluateMimeMismatch('pdf', 'application/octet-stream');
  assert(!docWithOctetStream.isSevereMismatch, 'application/octet-stream is not flagged as severe mismatch');

  // Matching MIME: no mismatch
  const matchingPdf = evaluateMimeMismatch('pdf', 'application/pdf');
  assert(!matchingPdf.isMismatch, 'Matching application/pdf produces no mismatch');
}

// -----------------------------------------------------------------------------
// Test 7: Suspicious Download Origins & Insecure Transport
// -----------------------------------------------------------------------------
console.log('\n--- Test 7: Suspicious Download Origins & Insecure Transport ---');
{
  // Raw IP origin
  const rawIpDownload = evaluateDownloadSafety({
    id: 601,
    filename: 'patch.exe',
    url: 'http://198.51.100.42/bin/patch.exe',
  });

  assert(rawIpDownload.isSuspicious, 'Raw IP download is suspicious');
  assert(
    rawIpDownload.indicators.some((i) => i.code === DownloadSafetyIndicatorCode.SUSPICIOUS_DOWNLOAD_ORIGIN),
    'Emits SUSPICIOUS_DOWNLOAD_ORIGIN for raw IP'
  );
  assert(rawIpDownload.originAnalysis?.isRawIp === true, 'Identifies isRawIp === true');

  // Insecure cleartext HTTP for executable
  assert(
    rawIpDownload.indicators.some((i) => i.code === DownloadSafetyIndicatorCode.INSECURE_DOWNLOAD_TRANSPORT),
    'Emits INSECURE_DOWNLOAD_TRANSPORT for cleartext HTTP executable download'
  );

  // Localhost is exempt from insecure transport flags
  const localhostDownload = evaluateDownloadSafety({
    id: 602,
    filename: 'local_tool.exe',
    url: 'http://localhost:8080/local_tool.exe',
  });
  assert(
    !localhostDownload.indicators.some((i) => i.code === DownloadSafetyIndicatorCode.INSECURE_DOWNLOAD_TRANSPORT),
    'Localhost is exempt from insecure transport warning'
  );

  // Unexpected scheme: data: URI
  const dataUriDownload = evaluateDownloadSafety({
    id: 603,
    filename: 'script.ps1',
    url: 'data:application/octet-stream;base64,V3JpdGUtSG9zdCAiSGVsbG8i',
  });
  assert(
    dataUriDownload.indicators.some((i) => i.code === DownloadSafetyIndicatorCode.UNEXPECTED_DOWNLOAD_SCHEME),
    'Emits UNEXPECTED_DOWNLOAD_SCHEME for data: URI'
  );
}

// -----------------------------------------------------------------------------
// Test 8: Incomplete, Interrupted, and Unavailable Metadata
// -----------------------------------------------------------------------------
console.log('\n--- Test 8: Incomplete, Interrupted, and Unavailable Metadata ---');
{
  // Fallback to URL pathname when filename is empty
  const urlFallback = evaluateDownloadSafety({
    id: 701,
    filename: '',
    url: 'https://cdn.example.test/files/document.pdf',
  });
  assertEquals(urlFallback.normalizedFile?.sanitizedBasename, 'document.pdf', 'Falls back to URL pathname for filename');
  assertEquals(urlFallback.normalizedFile?.primaryExtension, 'pdf', 'Extracts extension from URL pathname');

  // Completely unavailable metadata (no filename, no URL path)
  const unavailableMeta = evaluateDownloadSafety({
    id: 702,
    filename: '',
    url: 'https://example.test/',
    mime: undefined,
  });
  assert(
    unavailableMeta.indicators.some((i) => i.code === DownloadSafetyIndicatorCode.UNAVAILABLE_DOWNLOAD_METADATA),
    'Emits UNAVAILABLE_DOWNLOAD_METADATA when filename cannot be resolved'
  );

  // Interrupted download handling
  const interruptedDownload = evaluateDownloadSafety({
    id: 703,
    filename: 'partial_data.zip',
    state: 'interrupted',
    error: 'NETWORK_FAILED',
    url: 'https://example.test/partial_data.zip',
  });
  assert(
    interruptedDownload.indicators.some((i) => i.code === DownloadSafetyIndicatorCode.INTERRUPTED_DOWNLOAD),
    'Emits INTERRUPTED_DOWNLOAD indicator'
  );
  assertEquals(interruptedDownload.interruptionDetail?.error, 'NETWORK_FAILED', 'Preserves error code in interruptionDetail');
  // Does NOT recommend pause or cancel on already interrupted download
  assertEquals(interruptedDownload.protectiveActionRecommended, 'NONE', 'Does not recommend pause/cancel on interrupted download');
}

// -----------------------------------------------------------------------------
// Test 9: Native Browser SafeBrowsing Danger Flags
// -----------------------------------------------------------------------------
console.log('\n--- Test 9: Native Browser SafeBrowsing Danger Flags ---');
{
  const dangerFile = evaluateDownloadSafety({
    id: 801,
    filename: 'compromised.exe',
    danger: 'file',
    url: 'https://malware-dist.test/compromised.exe',
  });

  assert(
    dangerFile.indicators.some((i) => i.code === DownloadSafetyIndicatorCode.BROWSER_DANGER_FLAGGED),
    'Emits BROWSER_DANGER_FLAGGED for danger: "file"'
  );
  assertEquals(dangerFile.riskLevel, RiskLevel.CRITICAL, 'Danger flagged download is CRITICAL risk');
  assertEquals(dangerFile.protectiveActionRecommended, 'CANCEL', 'Recommends CANCEL for browser danger state');
  assert(dangerFile.browserDangerDetail?.isDangerFlagged === true, 'isDangerFlagged is true');
}

// -----------------------------------------------------------------------------
// Test 10: Risk Engine Integration & Dynamic Scoring
// -----------------------------------------------------------------------------
console.log('\n--- Test 10: Risk Engine Integration & Dynamic Scoring ---');
{
  const engine = new RiskEngine();

  // Case A: Benign routine download action
  const benignAction: GuardrailAction = {
    id: 'act_dl_benign_1',
    type: ActionType.CLICK,
    category: ActionCategory.DOWNLOAD,
    timestamp: new Date().toISOString(),
    page: { url: 'https://docs.example.com', title: 'User Guides' },
    element: {
      tagName: 'A',
      visibleText: 'Download PDF Guide',
      targetUrl: 'https://docs.example.com/manual.pdf',
    },
  };

  const benignRules = evaluateAllRiskRules({ action: benignAction });
  const matchedDl = benignRules.find((r) => r.ruleId === 'RISK_RULE_DOWNLOAD');
  assert(Boolean(matchedDl), 'RISK_RULE_DOWNLOAD matched benign download action');
  assertEquals(matchedDl?.scoreContribution, 10, 'Baseline score contribution is 10 for routine download');

  const benignAssessment = engine.assess(benignAction);
  assertEquals(benignAssessment.riskLevel, RiskLevel.LOW, 'Benign download evaluates to LOW risk level');
  assertEquals(benignAssessment.score, 10, 'Benign download composite score is 10');

  // Case B: Executable download action with metadata
  const exeAction: GuardrailAction = {
    id: 'act_dl_exe_1',
    type: ActionType.CLICK,
    category: ActionCategory.DOWNLOAD,
    timestamp: new Date().toISOString(),
    page: { url: 'https://software-dist.test', title: 'Downloads' },
    element: {
      tagName: 'A',
      visibleText: 'Download Application',
      targetUrl: 'https://software-dist.test/setup.exe',
      downloadAttribute: 'setup.exe',
    },
    download: {
      id: 901,
      filename: 'setup.exe',
      url: 'https://software-dist.test/setup.exe',
      mime: 'application/x-msdownload',
    },
  };

  const exeRules = evaluateAllRiskRules({ action: exeAction });
  const matchedExeDl = exeRules.find((r) => r.ruleId === 'RISK_RULE_DOWNLOAD');
  assert(Boolean(matchedExeDl), 'RISK_RULE_DOWNLOAD matched executable download action');
  assert((matchedExeDl?.scoreContribution ?? 0) >= 45, `Dynamic score for executable download is >= 45 (got ${matchedExeDl?.scoreContribution})`);
  assert(
    matchedExeDl?.structuredReasons?.some((sr) => sr.code.includes('SUSPICIOUS_EXECUTABLE_EXTENSION')),
    'Emits structured reason for SUSPICIOUS_EXECUTABLE_EXTENSION'
  );

  const exeAssessment = engine.assess(exeAction);
  assert(exeAssessment.score >= 45, `Total risk score for executable is >= 45 (got ${exeAssessment.score})`);
  assert(
    exeAssessment.riskLevel === RiskLevel.MEDIUM || exeAssessment.riskLevel === RiskLevel.HIGH,
    'Risk level is elevated for executable download'
  );

  // Case C: Double extension disguised download action
  const disguisedAction: GuardrailAction = {
    id: 'act_dl_disguised_1',
    type: ActionType.CLICK,
    category: ActionCategory.DOWNLOAD,
    timestamp: new Date().toISOString(),
    page: { url: 'https://phishing-portal.test', title: 'Invoice' },
    download: {
      id: 902,
      filename: 'Invoice_2026.pdf.exe',
      url: 'https://phishing-portal.test/Invoice_2026.pdf.exe',
      mime: 'application/x-msdownload',
    },
  };

  const disguisedAssessment = engine.assess(disguisedAction);
  assert(disguisedAssessment.score >= 75, `Score for disguised double extension is >= 75 (got ${disguisedAssessment.score})`);
  assertEquals(disguisedAssessment.riskLevel, RiskLevel.CRITICAL, 'Disguised double extension evaluates to CRITICAL');
}

// -----------------------------------------------------------------------------
// Test 11: Architectural Limitations & Safety Disclaimers
// -----------------------------------------------------------------------------
console.log('\n--- Test 11: Architectural Limitations & Safety Disclaimers ---');
{
  const evaluation = evaluateDownloadSafety({
    id: 999,
    filename: 'test.exe',
    url: 'https://example.com/test.exe',
  });

  // Verify that structured reasons follow Guardrail contracts
  assert(Array.isArray(evaluation.structuredReasons), 'structuredReasons is an array');
  assert(evaluation.structuredReasons.length > 0, 'structuredReasons has items');
  for (const sr of evaluation.structuredReasons) {
    assert(typeof sr.code === 'string', 'structuredReason code is string');
    assert(typeof sr.message === 'string', 'structuredReason message is string');
    assert(typeof sr.severity === 'string', 'structuredReason severity is string');
  }

  // Verify that protective action is not claimed as confirmed initially
  assertEquals(evaluation.protectiveActionConfirmed, false, 'protectiveActionConfirmed is false initially');
}

console.log('\n======================================================');
console.log(`Download Safety Unit Test Suite Complete: ${passed}/${passed + failed} assertions passed`);
console.log('======================================================\n');

if (failed > 0) {
  throw new Error(`Download safety unit test suite failed with ${failed} failure(s).`);
}
