/**
 * Guardrail Browser Download Safety & Risk Assessment Engine
 *
 * Implements deterministic, privacy-preserving, standards-compliant detection of
 * download risks, suspicious file extensions, deceptive multi-extensions,
 * filename-MIME mismatches, insecure transport, and unexpected download behavior.
 *
 * ARCHITECTURAL PRINCIPLES:
 * 1. PURE LOCAL HEURISTICS: Evaluations are computed deterministically from structural
 *    metadata (normalized filename, server MIME, destination URL, browser danger flags).
 *    Never claims malware detection based solely on filename or extension.
 * 2. NO ZERO-TRUST ON MIME OR FILENAME: Neither MIME type nor filename is trusted as
 *    proof of file safety. Mismatches and generic binary streams are explicitly surfaced.
 * 3. NO FILE EXECUTION: Downloaded files are NEVER executed or launched by Guardrail.
 * 4. ACCURATE MITIGATION REPORTING: Does NOT claim that an unsafe download was blocked
 *    unless the browser confirms the supported protective action (pause or cancellation).
 * 5. SAFE METADATA NORMALIZATION: Normalizes paths, decodes URL characters, strips Unicode
 *    bidirectional control overrides (RTL), and removes trailing dots/spaces.
 * 6. FAULT TOLERANCE: Exception-isolated; handles missing, incomplete, streaming, or
 *    interrupted downloads gracefully.
 */

import {
  DownloadExtensionCategory,
  DownloadIntelligenceSource,
  DownloadItemMetadata,
  DownloadLifecycleDisplayState,
  DownloadSafetyEvaluation,
  DownloadSafetyIndicator,
  DownloadSafetyIndicatorCode,
  DownloadSecurityContext,
  NormalizedFilenameInfo,
} from '../types/download.js';
import { EvaluationReason, RiskLevel } from '../types/risk.js';
import { sanitizeUrlForDiagnostics } from './privacy.js';
import {
  evaluateSuspiciousUrl,
  extractDomainParts,
  isLocalhostAddress,
} from './url-detector.js';

// =============================================================================
// Extension & MIME Dictionaries
// =============================================================================

/**
 * Windows, macOS, and Linux binary executables and installation packages.
 */
export const EXECUTABLE_EXTENSIONS: ReadonlySet<string> = new Set([
  'exe',
  'msi',
  'msp',
  'dmg',
  'pkg',
  'app',
  'deb',
  'rpm',
  'appimage',
  'bin',
  'scr',
  'pif',
  'cpl',
  'com',
  'gadget',
  'msc',
  'iso',
  'img',
  'vhd',
  'vhdx',
]);

/**
 * Script, shell, and interpretable macro extensions that can execute commands.
 */
export const SCRIPT_EXTENSIONS: ReadonlySet<string> = new Set([
  'bat',
  'cmd',
  'ps1',
  'psm1',
  'psd1',
  'vbs',
  'vbe',
  'js',
  'jse',
  'wsf',
  'wsh',
  'hta',
  'reg',
  'inf',
  'sh',
  'bash',
  'py',
  'pyw',
  'jar',
  'command',
]);

/**
 * Compressed archive extensions capable of packaging executable binaries.
 */
export const ARCHIVE_EXTENSIONS: ReadonlySet<string> = new Set([
  'zip',
  'rar',
  '7z',
  'tar',
  'gz',
  'bz2',
  'xz',
  'cab',
  'tgz',
  'zst',
]);

/**
 * Common benign document and office file extensions.
 */
export const DOCUMENT_EXTENSIONS: ReadonlySet<string> = new Set([
  'pdf',
  'doc',
  'docx',
  'xls',
  'xlsx',
  'ppt',
  'pptx',
  'odt',
  'ods',
  'odp',
  'txt',
  'rtf',
  'csv',
  'tsv',
  'epub',
]);

/**
 * Common media and asset extensions.
 */
export const MEDIA_EXTENSIONS: ReadonlySet<string> = new Set([
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'svg',
  'ico',
  'mp3',
  'wav',
  'flac',
  'ogg',
  'mp4',
  'webm',
  'mov',
  'mkv',
  'avi',
]);

/**
 * Web and markup data formats.
 */
export const WEB_EXTENSIONS: ReadonlySet<string> = new Set([
  'json',
  'xml',
  'css',
  'html',
  'htm',
]);

/**
 * Legitimate compound extensions that represent compound archives, not double extensions.
 */
export const LEGITIMATE_COMPOUND_EXTENSIONS: ReadonlySet<string> = new Set([
  'tar.gz',
  'tar.bz2',
  'tar.xz',
  'tar.zst',
]);

/**
 * Executable and binary MIME types commonly associated with native software.
 */
export const EXECUTABLE_MIME_TYPES: ReadonlySet<string> = new Set([
  'application/x-msdownload',
  'application/x-msdos-program',
  'application/x-executable',
  'application/x-dosexec',
  'application/x-sharedlib',
  'application/x-apple-diskimage',
  'application/vnd.microsoft.portable-executable',
  'application/x-mach-binary',
  'application/x-elf',
]);

/**
 * Script-based and shell MIME types.
 */
export const SCRIPT_MIME_TYPES: ReadonlySet<string> = new Set([
  'application/x-bat',
  'application/x-sh',
  'application/x-csh',
  'application/x-powershell',
  'application/x-vbs',
  'text/vbscript',
  'application/javascript',
  'text/javascript',
  'application/x-mshta',
  'application/x-python',
  'text/x-python',
]);

// Unicode Bidirectional and Invisible Control Characters
const UNICODE_BIDI_AND_CONTROL_REGEX = /[\u202E\u202D\u202C\u200E\u200F\u061C\u2066\u2067\u2068\u2069\u200B\u200C\u200D\uFEFF\0]/g;

// =============================================================================
// Filename Normalization
// =============================================================================

/**
 * Safely strips directory separators (both POSIX and Windows).
 */
export function extractBasename(filePath: string): string {
  if (!filePath || typeof filePath !== 'string') return '';
  const posixNormalized = filePath.replace(/\\/g, '/');
  const segments = posixNormalized.split('/');
  return segments[segments.length - 1] || '';
}

/**
 * Normalizes a raw filename string into structural metadata components.
 *
 * Handles:
 * - POSIX & Windows path stripping
 * - URL percent-decoding
 * - Unicode RTL override and zero-width character stripping
 * - Trailing dots and spaces stripping
 * - Compound archive vs deceptive double extension differentiation
 * - Semantic extension categorization
 */
export function normalizeFilename(rawFilename: string): NormalizedFilenameInfo {
  if (!rawFilename || typeof rawFilename !== 'string') {
    return {
      rawFilename: rawFilename || '',
      sanitizedBasename: '',
      primaryExtension: '',
      isDoubleExtension: false,
      hasRtlOverride: false,
      hasTrailingDotsOrSpaces: false,
      extensionCategory: 'unknown',
    };
  }

  // 1. Isolate basename
  let basename = extractBasename(rawFilename.trim());

  // 2. Decode percent-encoding if present
  try {
    if (basename.includes('%')) {
      basename = decodeURIComponent(basename);
    }
  } catch {
    // If malformed URI sequence, keep raw basename
  }

  // 3. Detect and strip Unicode bidi/control characters
  const hasRtlOverride = UNICODE_BIDI_AND_CONTROL_REGEX.test(basename);
  basename = basename.replace(UNICODE_BIDI_AND_CONTROL_REGEX, '');

  // 4. Detect trailing dots or spaces
  const hasTrailingDotsOrSpaces = /[.\s]+$/.test(basename);
  basename = basename.replace(/[.\s]+$/, '');

  // 5. Parse dot segments
  const dotParts = basename.split('.').filter(Boolean);
  let primaryExtension = '';
  let secondaryExtension: string | undefined;
  let isDoubleExtension = false;

  if (dotParts.length > 1) {
    primaryExtension = (dotParts[dotParts.length - 1] || '').toLowerCase().trim();

    if (dotParts.length > 2) {
      const secondLast = (dotParts[dotParts.length - 2] || '').toLowerCase().trim();
      const compoundCandidate = `${secondLast}.${primaryExtension}`;

      if (LEGITIMATE_COMPOUND_EXTENSIONS.has(compoundCandidate)) {
        secondaryExtension = undefined;
        isDoubleExtension = false;
      } else {
        secondaryExtension = secondLast;
        // Deceptive double extension heuristic:
        // If primary is executable or script, and secondary is a document, media, or text format
        const primaryIsExecutableOrScript =
          EXECUTABLE_EXTENSIONS.has(primaryExtension) ||
          SCRIPT_EXTENSIONS.has(primaryExtension);
        const secondaryIsBenign =
          DOCUMENT_EXTENSIONS.has(secondLast) ||
          MEDIA_EXTENSIONS.has(secondLast) ||
          secondLast === 'pdf' ||
          secondLast === 'doc' ||
          secondLast === 'docx' ||
          secondLast === 'xls' ||
          secondLast === 'xlsx' ||
          secondLast === 'txt' ||
          secondLast === 'jpg' ||
          secondLast === 'png';

        if (primaryIsExecutableOrScript && secondaryIsBenign) {
          isDoubleExtension = true;
        }
      }
    }
  }

  // 6. Determine extension category
  let extensionCategory: DownloadExtensionCategory = 'unknown';
  if (EXECUTABLE_EXTENSIONS.has(primaryExtension)) {
    extensionCategory = 'executable';
  } else if (SCRIPT_EXTENSIONS.has(primaryExtension)) {
    extensionCategory = 'script';
  } else if (ARCHIVE_EXTENSIONS.has(primaryExtension)) {
    extensionCategory = 'archive';
  } else if (DOCUMENT_EXTENSIONS.has(primaryExtension)) {
    extensionCategory = 'document';
  } else if (MEDIA_EXTENSIONS.has(primaryExtension)) {
    extensionCategory = 'media';
  } else if (WEB_EXTENSIONS.has(primaryExtension)) {
    extensionCategory = 'web';
  }

  return {
    rawFilename,
    sanitizedBasename: basename,
    primaryExtension,
    secondaryExtension,
    isDoubleExtension,
    hasRtlOverride,
    hasTrailingDotsOrSpaces,
    extensionCategory,
  };
}

// =============================================================================
// MIME Type Evaluation & Mismatch Detection
// =============================================================================

export interface MimeMismatchResult {
  readonly isMismatch: boolean;
  readonly isSevereMismatch: boolean;
  readonly mismatchDetail?: string;
}

/**
 * Evaluates whether declared MIME type contradicts the file extension.
 *
 * CRITICAL SAFETY INVARIANT:
 * Neither MIME type nor extension proves safety.
 * Generic application/octet-stream is treated as indeterminate, not safe.
 */
export function evaluateMimeMismatch(
  normalizedExt: string,
  declaredMime: string | undefined
): MimeMismatchResult {
  if (!declaredMime || typeof declaredMime !== 'string') {
    return { isMismatch: false, isSevereMismatch: false };
  }

  const cleanMime = declaredMime.toLowerCase().split(';')[0].trim();
  if (!cleanMime) {
    return { isMismatch: false, isSevereMismatch: false };
  }

  const isMimeExecutable = EXECUTABLE_MIME_TYPES.has(cleanMime);
  const isMimeScript = SCRIPT_MIME_TYPES.has(cleanMime);
  const isExtDocumentOrMedia =
    DOCUMENT_EXTENSIONS.has(normalizedExt) || MEDIA_EXTENSIONS.has(normalizedExt);
  const isExtExecutable = EXECUTABLE_EXTENSIONS.has(normalizedExt);
  const isExtScript = SCRIPT_EXTENSIONS.has(normalizedExt);

  // Case 1: Benign document/media extension with executable/script binary MIME type
  // (e.g. invoice.pdf or photo.jpg served with application/x-msdownload)
  if (isExtDocumentOrMedia && (isMimeExecutable || isMimeScript)) {
    return {
      isMismatch: true,
      isSevereMismatch: true,
      mismatchDetail: `Declared MIME type \"${cleanMime}\" indicates binary executable/script data, but filename extension \".${normalizedExt}\" indicates a document or media file.`,
    };
  }

  // Case 2: Executable or script extension with innocent image or plain-text MIME type
  // (e.g. setup.exe served with image/jpeg or text/plain to bypass content filters)
  if ((isExtExecutable || isExtScript) && (cleanMime.startsWith('image/') || cleanMime === 'text/plain')) {
    return {
      isMismatch: true,
      isSevereMismatch: true,
      mismatchDetail: `Declared MIME type \"${cleanMime}\" suggests benign media/text, but filename extension \".${normalizedExt}\" represents an executable program or script.`,
    };
  }

  // Case 3: Image extension with document MIME or vice versa (moderate discrepancy)
  if (MEDIA_EXTENSIONS.has(normalizedExt) && cleanMime.startsWith('application/pdf')) {
    return {
      isMismatch: true,
      isSevereMismatch: false,
      mismatchDetail: `MIME type \"${cleanMime}\" does not match media extension \".${normalizedExt}\".`,
    };
  }

  return { isMismatch: false, isSevereMismatch: false };
}

// =============================================================================
// Core Download Safety Evaluation Engine
// =============================================================================

/**
 * Pure, exception-isolated evaluation engine for browser downloads.
 *
 * Inspects:
 * 1. Normalized filename and high-risk executable/installer extensions.
 * 2. Script-based and macro file formats.
 * 3. Deceptive double extensions and Unicode directional overrides.
 * 4. Mismatches between declared MIME type and file extension.
 * 5. Suspicious origin domains, raw IP addresses, and unusual ports.
 * 6. Insecure cleartext HTTP downloads of binary payloads.
 * 7. Browser-flagged danger states (SafeBrowsing).
 * 8. Missing, incomplete, or interrupted metadata.
 *
 * @param item Download item metadata (compatible with chrome.downloads.DownloadItem).
 * @returns Comprehensive DownloadSafetyEvaluation result.
 */
export function evaluateDownloadSafety(
  item: Partial<DownloadItemMetadata>
): DownloadSafetyEvaluation {
  const evaluatedAt = new Date().toISOString();
  const indicators: DownloadSafetyIndicator[] = [];
  const reasons: string[] = [];

  try {
    const rawUrl = typeof item.url === 'string' ? item.url.trim() : '';
    const finalUrl = typeof item.finalUrl === 'string' ? item.finalUrl.trim() : rawUrl;
    const effectiveUrl = finalUrl || rawUrl;
    const referrer = typeof item.referrer === 'string' ? item.referrer.trim() : undefined;
    const rawFilename = typeof item.filename === 'string' ? item.filename.trim() : '';
    const declaredMime = typeof item.mime === 'string' ? item.mime.trim() : undefined;
    const danger = typeof item.danger === 'string' ? item.danger.toLowerCase().trim() : 'safe';
    const state = item.state || 'in_progress';

    // 1. Resolve effective filename (fallback to URL pathname if filename absent)
    let candidateFilename = rawFilename;
    if (!candidateFilename && effectiveUrl) {
      try {
        const parsed = new URL(effectiveUrl);
        const urlPath = parsed.pathname;
        if (urlPath && urlPath !== '/') {
          candidateFilename = extractBasename(urlPath);
        }
      } catch {
        // Ignore URL parse error
      }
    }

    const normalizedFile = normalizeFilename(candidateFilename);
    const primaryExt = normalizedFile.primaryExtension;

    // 2. Metadata completeness inspection
    if (!candidateFilename || !primaryExt) {
      indicators.push({
        code: DownloadSafetyIndicatorCode.UNAVAILABLE_DOWNLOAD_METADATA,
        severity: RiskLevel.MEDIUM,
        scoreWeight: 25,
        reason: 'Download destination filename or file extension is unavailable or undetermined.',
        detail: 'The browser download API did not provide a resolvable filename or file extension.',
      });
      reasons.push('Download filename or extension is unavailable or undetermined');
    }

    // 3. Interrupted download inspection
    let interruptionDetail: { isInterrupted: boolean; error?: string } | undefined;
    if (state === 'interrupted') {
      const errorCode = item.error || 'INTERRUPTED_UNKNOWN';
      indicators.push({
        code: DownloadSafetyIndicatorCode.INTERRUPTED_DOWNLOAD,
        severity: RiskLevel.LOW,
        scoreWeight: 5,
        reason: `Download was interrupted before completion (${errorCode}).`,
        detail: errorCode,
      });
      reasons.push(`Download interrupted: ${errorCode}`);
      interruptionDetail = { isInterrupted: true, error: errorCode };
    }

    // 4. Native Browser SafeBrowsing danger evaluation
    let browserDangerDetail: { isDangerFlagged: boolean; dangerType?: string } | undefined;
    if (danger && danger !== 'safe') {
      const dangerDescriptions: Record<string, string> = {
        file: 'Browser SafeBrowsing flagged this file as confirmed dangerous.',
        url: 'Browser SafeBrowsing flagged the source URL as dangerous.',
        content: 'Browser SafeBrowsing flagged the downloaded content as malicious.',
        uncommon: 'Browser SafeBrowsing flagged this download as uncommon and potentially risky.',
        unwanted: 'Browser SafeBrowsing flagged this software as potentially unwanted or deceptive.',
        host: 'Browser SafeBrowsing flagged the host domain as dangerous.',
      };
      const dangerDesc = dangerDescriptions[danger] || `Browser SafeBrowsing danger state: \"${danger}\".`;

      indicators.push({
        code: DownloadSafetyIndicatorCode.BROWSER_DANGER_FLAGGED,
        severity: danger === 'uncommon' ? RiskLevel.HIGH : RiskLevel.CRITICAL,
        scoreWeight: danger === 'uncommon' ? 45 : 60,
        reason: dangerDesc,
        detail: danger,
      });
      reasons.push(dangerDesc);
      browserDangerDetail = { isDangerFlagged: true, dangerType: danger };
    }

    // 5. File extension risk evaluation
    if (normalizedFile.extensionCategory === 'executable') {
      indicators.push({
        code: DownloadSafetyIndicatorCode.SUSPICIOUS_EXECUTABLE_EXTENSION,
        severity: RiskLevel.HIGH,
        scoreWeight: 45,
        reason: `File uses executable binary extension (\".${primaryExt}\"), capable of running native code.`,
        detail: primaryExt,
      });
      reasons.push(`Executable binary download (.${primaryExt})`);
    } else if (normalizedFile.extensionCategory === 'script') {
      indicators.push({
        code: DownloadSafetyIndicatorCode.SCRIPT_BASED_DOWNLOAD,
        severity: RiskLevel.HIGH,
        scoreWeight: 40,
        reason: `File uses script/macro extension (\".${primaryExt}\"), which can execute shell or interpreter commands.`,
        detail: primaryExt,
      });
      reasons.push(`Script-based download (.${primaryExt})`);
    } else if (normalizedFile.extensionCategory === 'archive') {
      indicators.push({
        code: DownloadSafetyIndicatorCode.DISK_IMAGE_OR_ARCHIVE,
        severity: RiskLevel.MEDIUM,
        scoreWeight: 20,
        reason: `File is a compressed archive or disk image (\".${primaryExt}\") which may bundle executable contents.`,
        detail: primaryExt,
      });
      reasons.push(`Archive or disk image download (.${primaryExt})`);
    }

    // 6. Deceptive multi-extension & Unicode RTL override inspection
    if (normalizedFile.isDoubleExtension) {
      indicators.push({
        code: DownloadSafetyIndicatorCode.MISLEADING_DOUBLE_EXTENSION,
        severity: RiskLevel.HIGH,
        scoreWeight: 50,
        reason: `Filename uses misleading double extension (\"${normalizedFile.secondaryExtension}.${primaryExt}\") masquerading as a non-executable file.`,
        detail: `${normalizedFile.secondaryExtension}.${primaryExt}`,
      });
      reasons.push(`Misleading double extension (${normalizedFile.secondaryExtension}.${primaryExt})`);
    }

    if (normalizedFile.hasRtlOverride) {
      indicators.push({
        code: DownloadSafetyIndicatorCode.MISLEADING_DOUBLE_EXTENSION,
        severity: RiskLevel.HIGH,
        scoreWeight: 45,
        reason: 'Filename contains hidden Unicode Right-to-Left Override or directional control characters.',
        detail: 'RTL_OVERRIDE_DETECTED',
      });
      reasons.push('Deceptive Unicode Right-to-Left override in filename');
    }

    if (normalizedFile.hasTrailingDotsOrSpaces) {
      indicators.push({
        code: DownloadSafetyIndicatorCode.MISLEADING_DOUBLE_EXTENSION,
        severity: RiskLevel.MEDIUM,
        scoreWeight: 30,
        reason: 'Filename contains trailing dots or spaces commonly used to bypass extension filters.',
        detail: 'TRAILING_DOTS_OR_SPACES',
      });
      reasons.push('Suspicious trailing dots or spaces in filename');
    }

    // 7. MIME-Type mismatch evaluation
    const mimeCheck = evaluateMimeMismatch(primaryExt, declaredMime);
    let mimeAnalysis: DownloadSafetyEvaluation['mimeAnalysis'] | undefined;
    if (declaredMime) {
      mimeAnalysis = {
        declaredMime,
        isMismatch: mimeCheck.isMismatch,
        isSevereMismatch: mimeCheck.isSevereMismatch,
        mismatchDetail: mimeCheck.mismatchDetail,
      };

      if (mimeCheck.isMismatch) {
        indicators.push({
          code: DownloadSafetyIndicatorCode.MIME_TYPE_MISMATCH,
          severity: mimeCheck.isSevereMismatch ? RiskLevel.HIGH : RiskLevel.MEDIUM,
          scoreWeight: mimeCheck.isSevereMismatch ? 50 : 25,
          reason: mimeCheck.mismatchDetail || 'Mismatch detected between declared MIME type and file extension.',
          detail: `${primaryExt} vs ${declaredMime}`,
        });
        reasons.push(mimeCheck.mismatchDetail || 'Filename extension contradicts declared MIME type');
      }
    }

    // 8. Origin & Domain analysis
    let originAnalysis: DownloadSafetyEvaluation['originAnalysis'] | undefined;
    if (effectiveUrl) {
      let isRawIp = false;
      let isSuspiciousDomain = false;
      let isPlainHttp = false;
      let isCrossDomain = false;
      let downloadOrigin: string | undefined;
      let referrerOrigin: string | undefined;

      try {
        const parsed = new URL(effectiveUrl);
        downloadOrigin = parsed.origin;
        isPlainHttp = parsed.protocol === 'http:';

        // Check for pseudo/unexpected schemes
        if (parsed.protocol === 'data:' || parsed.protocol === 'blob:' || parsed.protocol === 'javascript:') {
          indicators.push({
            code: DownloadSafetyIndicatorCode.UNEXPECTED_DOWNLOAD_SCHEME,
            severity: RiskLevel.HIGH,
            scoreWeight: 35,
            reason: `Download originates from unexpected ${parsed.protocol} scheme.`,
            detail: parsed.protocol,
          });
          reasons.push(`Download initiated from unexpected scheme: ${parsed.protocol}`);
        }

        // Check suspicious URL indicators
        const urlEval = evaluateSuspiciousUrl(effectiveUrl);
        if (urlEval.isSuspicious) {
          isSuspiciousDomain = true;
          for (const ind of urlEval.indicators) {
            if (ind.code === 'IP_ADDRESS_HOSTNAME') {
              isRawIp = true;
            }
          }

          indicators.push({
            code: DownloadSafetyIndicatorCode.SUSPICIOUS_DOWNLOAD_ORIGIN,
            severity: isRawIp ? RiskLevel.HIGH : RiskLevel.MEDIUM,
            scoreWeight: isRawIp ? 40 : 30,
            reason: isRawIp
              ? `Download originates from a raw IP address (${parsed.hostname}) rather than a verified domain name.`
              : `Download originates from a suspicious domain structure (${parsed.hostname}).`,
            detail: parsed.hostname,
          });
          reasons.push(isRawIp ? `Raw IP download origin (${parsed.hostname})` : `Suspicious download origin (${parsed.hostname})`);
        }

        // Check cleartext HTTP for executables/scripts
        const isPayloadHighRisk =
          normalizedFile.extensionCategory === 'executable' ||
          normalizedFile.extensionCategory === 'script' ||
          normalizedFile.isDoubleExtension;

        if (isPlainHttp && isPayloadHighRisk && !isLocalhostAddress(parsed.hostname)) {
          indicators.push({
            code: DownloadSafetyIndicatorCode.INSECURE_DOWNLOAD_TRANSPORT,
            severity: RiskLevel.MEDIUM,
            scoreWeight: 30,
            reason: 'High-risk executable/script file is being downloaded over unencrypted cleartext HTTP.',
            detail: 'CLEAR_TEXT_HTTP_TRANSPORT',
          });
          reasons.push('Insecure cleartext HTTP transport for executable download');
        }

        // Cross-domain referrer check
        if (referrer) {
          try {
            const refParsed = new URL(referrer);
            referrerOrigin = refParsed.origin;
            if (
              refParsed.hostname &&
              parsed.hostname &&
              refParsed.hostname !== parsed.hostname &&
              !isLocalhostAddress(refParsed.hostname) &&
              !isLocalhostAddress(parsed.hostname)
            ) {
              const refParts = extractDomainParts(refParsed.hostname);
              const dlParts = extractDomainParts(parsed.hostname);
              if (refParts.registrableDomain !== dlParts.registrableDomain) {
                isCrossDomain = true;
              }
            }
          } catch {
            // Ignore referrer URL parse error
          }
        }
      } catch {
        // Ignore URL parse error
      }

      originAnalysis = {
        isRawIp,
        isSuspiciousDomain,
        isCrossDomain,
        isPlainHttp,
        downloadOrigin,
        referrerOrigin,
      };
    }

    // 9. Compute composite score and risk level
    let cumulativeScore = 0;
    for (const ind of indicators) {
      cumulativeScore += ind.scoreWeight;
    }

    const score = Math.min(100, Math.max(0, Math.round(cumulativeScore)));
    let riskLevel: RiskLevel;
    if (score <= 24) {
      riskLevel = RiskLevel.LOW;
    } else if (score <= 49) {
      riskLevel = RiskLevel.MEDIUM;
    } else if (score <= 74) {
      riskLevel = RiskLevel.HIGH;
    } else {
      riskLevel = RiskLevel.CRITICAL;
    }

    const isSuspicious = indicators.length > 0 && score >= 25;

    // 10. Protective action recommendation
    let protectiveActionRecommended: 'NONE' | 'WARN' | 'PAUSE' | 'CANCEL' = 'NONE';
    if (state !== 'interrupted') {
      if (danger && danger !== 'safe' && danger !== 'uncommon') {
        protectiveActionRecommended = 'CANCEL';
      } else if (score >= 75) {
        protectiveActionRecommended = 'PAUSE';
      } else if (score >= 25) {
        protectiveActionRecommended = 'WARN';
      }
    }

    // 11. Format structured reasons
    const structuredReasons: EvaluationReason[] = indicators.map((ind) => ({
      code: `DOWNLOAD_${ind.code}`,
      message: ind.reason,
      ruleId: 'RISK_RULE_DOWNLOAD',
      signalId: undefined as any,
      severity: ind.severity,
      scoreContribution: ind.scoreWeight,
    }));

    return {
      isSuspicious,
      score,
      riskLevel,
      reasons,
      indicators,
      structuredReasons,
      normalizedFile,
      originAnalysis,
      mimeAnalysis,
      protectiveActionRecommended,
      protectiveActionConfirmed: false,
      interruptionDetail,
      browserDangerDetail,
      evaluatedAt,
    };
  } catch (err) {
    // Fail-safe error fallback
    const fallbackReason = 'Download safety evaluation encountered an internal error; evaluated fail-closed.';
    return {
      isSuspicious: true,
      score: 50,
      riskLevel: RiskLevel.HIGH,
      reasons: [fallbackReason],
      indicators: [
        {
          code: DownloadSafetyIndicatorCode.UNAVAILABLE_DOWNLOAD_METADATA,
          severity: RiskLevel.HIGH,
          scoreWeight: 50,
          reason: fallbackReason,
        },
      ],
      structuredReasons: [
        {
          code: 'DOWNLOAD_EVALUATION_ERROR',
          message: fallbackReason,
          severity: RiskLevel.HIGH,
          scoreContribution: 50,
        },
      ],
      protectiveActionRecommended: 'WARN',
      protectiveActionConfirmed: false,
      evaluatedAt,
    };
  }
}

// =============================================================================
// Download Security Context & Plain-Language UX Generator
// =============================================================================

/**
 * Compiles a comprehensive, non-technical, accessible security context for download warnings.
 *
 * ARCHITECTURAL PRINCIPLES:
 * 1. PLAIN LANGUAGE: Uses clear, non-frightening vocabulary for everyday users.
 * 2. HEURISTIC VS VERIFIED DISTINCTION: Truthfully distinguishes local structural heuristics
 *    from confirmed browser SafeBrowsing malware flags.
 * 3. ACCURATE LIFECYCLE: Accurately reflects whether the download is ongoing, paused, cancelled,
 *    interrupted, or completed.
 * 4. SAFE RECOVERY GUIDANCE: For completed downloads, explains safe inspection (antivirus scan,
 *    no execution) without falsely claiming Guardrail blocked or deleted the file.
 * 5. CONTROLLED ACTIONS: Surfaces whether cancellation or continuation is genuinely supported.
 */
export function extractDownloadSecurityContext(
  evaluation: DownloadSafetyEvaluation,
  item?: Partial<DownloadItemMetadata>
): DownloadSecurityContext {
  const downloadId = item?.id ?? 'unknown';
  const rawCandidateName =
    evaluation.normalizedFile?.sanitizedBasename ||
    item?.filename ||
    (item?.url ? extractBasename(item.url) : '') ||
    'unnamed-download';

  const filename = rawCandidateName || 'unnamed-download';
  const extCategory = evaluation.normalizedFile?.extensionCategory || 'unknown';
  const primaryExt = evaluation.normalizedFile?.primaryExtension || '';
  const extension = primaryExt ? `.${primaryExt}` : 'unknown';

  // Human-friendly file type labels
  let fileTypeLabel = 'Unknown File Type';
  switch (extCategory) {
    case 'executable':
      fileTypeLabel = 'Executable Program';
      break;
    case 'script':
      fileTypeLabel = 'Command Script or Macro';
      break;
    case 'archive':
      fileTypeLabel = 'Compressed Archive or Disk Image';
      break;
    case 'document':
      fileTypeLabel = 'Document File';
      break;
    case 'media':
      fileTypeLabel = 'Media / Graphic File';
      break;
    case 'web':
      fileTypeLabel = 'Web File';
      break;
    default:
      fileTypeLabel = 'Unrecognized File Type';
  }

  // Format file size
  let fileSizeFormatted = 'Unknown size (streaming transfer)';
  if (typeof item?.fileSize === 'number' && item.fileSize > 0) {
    if (item.fileSize < 1024) {
      fileSizeFormatted = `${item.fileSize} B`;
    } else if (item.fileSize < 1024 * 1024) {
      fileSizeFormatted = `${(item.fileSize / 1024).toFixed(1)} KB`;
    } else {
      fileSizeFormatted = `${(item.fileSize / (1024 * 1024)).toFixed(1)} MB`;
    }
  }

  // Origin domain and URL sanitization
  const rawUrl = item?.finalUrl || item?.url || '';
  let originDomain = 'Unknown Origin';
  if (rawUrl) {
    try {
      originDomain = new URL(rawUrl).hostname || 'Unknown Origin';
    } catch {
      originDomain = rawUrl.split('/')[0] || 'Unknown Origin';
    }
  }
  const downloadUrl = sanitizeUrlForDiagnostics(rawUrl) || rawUrl;

  let referrerDomain: string | undefined;
  if (item?.referrer) {
    try {
      referrerDomain = new URL(item.referrer).hostname;
    } catch {
      referrerDomain = undefined;
    }
  }

  const isRawIp = Boolean(evaluation.originAnalysis?.isRawIp);
  const isInsecureTransport = Boolean(evaluation.originAnalysis?.isPlainHttp);

  // Intelligence source classification
  const isDangerFlagged = Boolean(evaluation.browserDangerDetail?.isDangerFlagged);
  const isConfirmedMalicious =
    isDangerFlagged && evaluation.browserDangerDetail?.dangerType !== 'uncommon';
  const intelligenceSource: DownloadIntelligenceSource = isDangerFlagged
    ? 'VERIFIED_THREAT_INTEL'
    : 'LOCAL_HEURISTIC';

  const intelligenceDisclaimer = isDangerFlagged
    ? "Verified Threat Intelligence: This download was flagged directly by your browser's SafeBrowsing security service as dangerous or potentially malicious."
    : "Local Safety Heuristic: Evaluated on your computer by Guardrail based on structural file and address characteristics. No external scanning service was contacted; this is an automated safety precaution, not a certified malware scan.";

  // High-level severity badge label
  let severityLabel = 'Advisory Notice';
  if (isConfirmedMalicious) {
    severityLabel = 'Confirmed Dangerous';
  } else if (evaluation.riskLevel === RiskLevel.CRITICAL) {
    severityLabel = 'High Risk Download';
  } else if (evaluation.riskLevel === RiskLevel.HIGH) {
    severityLabel = 'Suspicious File';
  } else if (evaluation.riskLevel === RiskLevel.MEDIUM) {
    severityLabel = 'Elevated Risk';
  }

  // Observable download lifecycle state
  let lifecycleState: DownloadLifecycleDisplayState = 'in_progress';
  if (item?.state === 'interrupted') {
    lifecycleState = 'interrupted';
  } else if (item?.state === 'complete') {
    lifecycleState = 'complete';
  } else if (item?.paused) {
    lifecycleState = 'paused';
  } else {
    lifecycleState = 'in_progress';
  }

  const interruptionError = item?.error || evaluation.interruptionDetail?.error;

  let lifecycleExplanation = 'Download is currently transferring bytes to your computer.';
  if (lifecycleState === 'paused') {
    lifecycleExplanation = 'Download has been safely paused by Guardrail to allow review before file write.';
  } else if (lifecycleState === 'cancelled') {
    lifecycleExplanation = 'Download was stopped and cancelled. Incomplete file data was discarded.';
  } else if (lifecycleState === 'interrupted') {
    lifecycleExplanation = interruptionError
      ? `Download was halted by the browser (${interruptionError}). No complete file was saved.`
      : 'Download was interrupted before completion. No complete file was saved.';
  } else if (lifecycleState === 'complete') {
    lifecycleExplanation = 'File has finished downloading to your Downloads folder. Note: Completed downloads cannot be blocked retroactively.';
  }

  // Translate detected indicators into non-technical, accessible explanations
  const detectedIndicators: string[] = [];
  if (evaluation.indicators.length > 0) {
    for (const ind of evaluation.indicators) {
      switch (ind.code) {
        case DownloadSafetyIndicatorCode.SUSPICIOUS_EXECUTABLE_EXTENSION:
          detectedIndicators.push(
            `Executable program format (.${primaryExt}): Contains native computer programs that can run directly on your operating system.`
          );
          break;
        case DownloadSafetyIndicatorCode.SCRIPT_BASED_DOWNLOAD:
          detectedIndicators.push(
            `Automated script format (.${primaryExt}): Contains commands or scripts that can execute terminal or shell instructions.`
          );
          break;
        case DownloadSafetyIndicatorCode.DISK_IMAGE_OR_ARCHIVE:
          detectedIndicators.push(
            `Archive or disk package (.${primaryExt}): May bundle executable programs inside compressed storage.`
          );
          break;
        case DownloadSafetyIndicatorCode.MISLEADING_DOUBLE_EXTENSION:
          if (evaluation.normalizedFile?.isDoubleExtension) {
            detectedIndicators.push(
              `Disguised double extension: File ends with ".${evaluation.normalizedFile.secondaryExtension}.${primaryExt}", which may mislead you into thinking it is a document rather than a program.`
            );
          } else {
            detectedIndicators.push(
              'Deceptive filename characteristics: Contains hidden control characters or trailing spaces used to disguise file types.'
            );
          }
          break;
        case DownloadSafetyIndicatorCode.MIME_TYPE_MISMATCH:
          detectedIndicators.push(
            `File type contradiction: The web server declared this file as "${evaluation.mimeAnalysis?.declaredMime || 'unknown'}", but the extension is ".${primaryExt}".`
          );
          break;
        case DownloadSafetyIndicatorCode.SUSPICIOUS_DOWNLOAD_ORIGIN:
          if (isRawIp) {
            detectedIndicators.push(
              `Numerical web address: Originates from a raw IP address (${originDomain}) rather than a registered, verified domain name.`
            );
          } else {
            detectedIndicators.push(
              `Unusual download origin: Originates from an unverified or suspicious domain structure (${originDomain}).`
            );
          }
          break;
        case DownloadSafetyIndicatorCode.INSECURE_DOWNLOAD_TRANSPORT:
          detectedIndicators.push(
            'Unencrypted connection (HTTP): This file is transferring over plain HTTP, which lacks encryption and could allow tampering by network intermediaries.'
          );
          break;
        case DownloadSafetyIndicatorCode.UNEXPECTED_DOWNLOAD_SCHEME:
          detectedIndicators.push(
            'Unexpected download protocol: Initiated from a non-standard protocol scheme (e.g. data: or blob:).'
          );
          break;
        case DownloadSafetyIndicatorCode.UNAVAILABLE_DOWNLOAD_METADATA:
          detectedIndicators.push(
            'Undetermined file details: The destination filename or extension was not verified before transfer.'
          );
          break;
        case DownloadSafetyIndicatorCode.BROWSER_DANGER_FLAGGED:
          detectedIndicators.push(ind.reason);
          break;
        case DownloadSafetyIndicatorCode.INTERRUPTED_DOWNLOAD:
          detectedIndicators.push(ind.reason);
          break;
        default:
          detectedIndicators.push(ind.reason);
      }
    }
  } else if (evaluation.reasons.length > 0) {
    detectedIndicators.push(...evaluation.reasons);
  } else {
    detectedIndicators.push('Routine download: No elevated risk indicators observed.');
  }

  // Plain-language, reassuring risk impact explanation
  const riskExplanation = isConfirmedMalicious
    ? 'Why this is critical: Your browser identified this download as confirmed dangerous or unwanted software. Running or keeping this file could compromise your system security or personal accounts.'
    : 'Why Guardrail flagged this: Files downloaded from the web that can execute programs or scripts carry higher risk if their origin, filename, or file type is unexpected. Guardrail provides this advisory so you can review the file before opening it.';

  // Genuinely supported protective actions
  const canCancel = lifecycleState === 'in_progress' || lifecycleState === 'paused';
  const canResume = lifecycleState === 'paused';
  const canInspectSafely = lifecycleState === 'complete';

  // Safe handling guidance
  let safeHandlingGuidance: readonly string[];
  if (lifecycleState === 'complete') {
    safeHandlingGuidance = Object.freeze([
      '1. Do not double-click or open the file directly from your browser shelf.',
      '2. Open your computer\'s Downloads folder to view the file without executing it.',
      '3. Scan the downloaded file with your computer\'s installed antivirus software before use.',
      '4. If you did not intentionally request this download, delete the file from your Downloads folder.',
    ]);
  } else if (isConfirmedMalicious) {
    safeHandlingGuidance = Object.freeze([
      '1. Click Cancel Download to stop the transfer and discard dangerous data.',
      '2. Do not attempt to bypass browser warnings for confirmed dangerous files.',
      '3. Leave the website that initiated this transfer.',
    ]);
  } else {
    safeHandlingGuidance = Object.freeze([
      '1. If you did not intend to download this file, click Cancel Download to stop the transfer.',
      '2. Check the website domain in your address bar to ensure it is your legitimate provider.',
      '3. If you trust this provider and intended to download this software, you may confirm continuation to resume.',
      '4. Once downloaded, scan the file with your local antivirus before opening.',
    ]);
  }

  const continuationWarning =
    'Continuing will allow this file to download to your computer. Guardrail does not certify or guarantee file safety. Proceed only if you independently trust this source.';

  return {
    downloadId,
    filename,
    extension,
    fileTypeLabel,
    fileSizeFormatted,
    declaredMime: item?.mime || evaluation.mimeAnalysis?.declaredMime,
    originDomain,
    downloadUrl,
    referrerDomain,
    isRawIp,
    isInsecureTransport,
    intelligenceSource,
    intelligenceDisclaimer,
    isConfirmedMalicious,
    severityLabel,
    lifecycleState,
    lifecycleExplanation,
    interruptionError,
    detectedIndicators: Object.freeze(detectedIndicators),
    riskExplanation,
    supportedActions: Object.freeze({
      canCancel,
      canResume,
      canInspectSafely,
    }),
    safeHandlingGuidance,
    continuationWarning,
  };
}
