/**
 * Guardrail Browser Download Monitoring & Safety Models
 *
 * Formal contracts and data models for observing browser download events,
 * normalizing download metadata, evaluating suspicious file extensions,
 * detecting MIME-type mismatches, and assessing executable/script risks.
 *
 * ARCHITECTURAL PRINCIPLES:
 * 1. STRICT HEURISTIC BASIS: Assessment identifies observable structural and contextual
 *    risk indicators (executable extensions, script types, MIME mismatches, raw IP origins).
 *    It does NOT prove malware presence, nor does a clean score certify file safety.
 * 2. ZERO EXTERNAL TRANSMISSION: Metadata evaluation is purely local. No file contents
 *    or hashes are transmitted to external scanning services without explicit architectural review.
 * 3. NO FILE EXECUTION: Downloaded files are NEVER executed or launched by Guardrail.
 * 4. TRUTHFUL INTERCEPTION: Downloads are never claimed to be blocked unless the browser API
 *    confirms pause or cancellation state.
 * 5. EPHEMERAL STATE: Download assessments are retained in a bounded in-memory cache only.
 *    No permanent history of user downloads is stored.
 */

import { EvaluationReason, RiskLevel } from './risk.js';

/**
 * Canonical indicator codes for download safety evaluation.
 */
export enum DownloadSafetyIndicatorCode {
  /** Target file uses a high-risk binary executable or installer extension (.exe, .msi, .dmg, .pkg, .scr, etc.) */
  SUSPICIOUS_EXECUTABLE_EXTENSION = 'SUSPICIOUS_EXECUTABLE_EXTENSION',

  /** Target file uses an interpretable script or macro extension (.bat, .cmd, .ps1, .vbs, .js, .hta, etc.) */
  SCRIPT_BASED_DOWNLOAD = 'SCRIPT_BASED_DOWNLOAD',

  /** Target file is a compressed archive or disk image (.iso, .img, .vhd, .zip, .rar, .7z) */
  DISK_IMAGE_OR_ARCHIVE = 'DISK_IMAGE_OR_ARCHIVE',

  /** Target file utilizes a misleading double extension (e.g. invoice.pdf.exe) or hidden Unicode RTL override */
  MISLEADING_DOUBLE_EXTENSION = 'MISLEADING_DOUBLE_EXTENSION',

  /** Mismatch between declared HTTP MIME type and normalized filename extension */
  MIME_TYPE_MISMATCH = 'MIME_TYPE_MISMATCH',

  /** Download originates from a raw IP address, deceptive subdomain, or suspicious domain */
  SUSPICIOUS_DOWNLOAD_ORIGIN = 'SUSPICIOUS_DOWNLOAD_ORIGIN',

  /** Executable or script binary is downloaded over unencrypted cleartext HTTP */
  INSECURE_DOWNLOAD_TRANSPORT = 'INSECURE_DOWNLOAD_TRANSPORT',

  /** Download utilizes unexpected or high-risk URI schemes (data:, blob:, javascript:) */
  UNEXPECTED_DOWNLOAD_SCHEME = 'UNEXPECTED_DOWNLOAD_SCHEME',

  /** Download metadata (filename, destination, or MIME) is missing or unavailable */
  UNAVAILABLE_DOWNLOAD_METADATA = 'UNAVAILABLE_DOWNLOAD_METADATA',

  /** Download was interrupted or halted due to network, server, or file error */
  INTERRUPTED_DOWNLOAD = 'INTERRUPTED_DOWNLOAD',

  /** Browser's native SafeBrowsing assessment flagged the download item (danger state) */
  BROWSER_DANGER_FLAGGED = 'BROWSER_DANGER_FLAGGED',
}

/**
 * Individual detected download safety indicator.
 */
export interface DownloadSafetyIndicator {
  /** Unique indicator identifier */
  readonly code: DownloadSafetyIndicatorCode;

  /** Indicator severity tier */
  readonly severity: RiskLevel;

  /** Heuristic score weight contribution (0-100) */
  readonly scoreWeight: number;

  /** Human-readable explanation of why this indicator was triggered */
  readonly reason: string;

  /** Non-sensitive contextual detail (e.g. detected extension or mismatched MIME) */
  readonly detail?: string;
}

/**
 * Categorical extension classifications for downloads.
 */
export type DownloadExtensionCategory =
  | 'executable'
  | 'script'
  | 'archive'
  | 'document'
  | 'media'
  | 'web'
  | 'unknown';

/**
 * Normalized structural information safely extracted from a download filename.
 */
export interface NormalizedFilenameInfo {
  /** Original raw filename string provided by browser API */
  readonly rawFilename: string;

  /** Sanitized basename with directory path stripped, control chars removed */
  readonly sanitizedBasename: string;

  /** Primary normalized extension in lowercase without leading dot (e.g. 'exe') */
  readonly primaryExtension: string;

  /** Secondary extension if multiple dots are present (e.g. 'pdf' in 'document.pdf.exe') */
  readonly secondaryExtension?: string;

  /** Indicates whether the filename uses deceptive multi-extension patterning */
  readonly isDoubleExtension: boolean;

  /** Indicates whether filename contained Unicode Right-to-Left Override (\u202E) or directional control characters */
  readonly hasRtlOverride: boolean;

  /** Indicates whether filename contained trailing dots or spaces commonly stripped by operating systems */
  readonly hasTrailingDotsOrSpaces: boolean;

  /** Semantic category for the primary file extension */
  readonly extensionCategory: DownloadExtensionCategory;
}

/**
 * Normalized browser download item representation compatible with chrome.downloads.DownloadItem.
 */
export interface DownloadItemMetadata {
  /** Stable browser download item ID */
  readonly id: number;

  /** Initial download URL */
  readonly url: string;

  /** Final URL after HTTP redirects, if available */
  readonly finalUrl?: string;

  /** Local filename or suggested destination path */
  readonly filename?: string;

  /** Server-declared or browser-inferred MIME type */
  readonly mime?: string;

  /** Total file size in bytes (-1 or 0 if unknown/streaming) */
  readonly fileSize?: number;

  /** Current state of the download */
  readonly state?: 'in_progress' | 'interrupted' | 'complete';

  /** Native browser danger assessment string (e.g. 'safe', 'file', 'url', 'content', 'uncommon', 'unwanted') */
  readonly danger?: string;

  /** Indicates whether the download is actively paused */
  readonly paused?: boolean;

  /** Referrer URL that initiated the download */
  readonly referrer?: string;

  /** ISO 8601 timestamp when download started */
  readonly startTime?: string;

  /** Interruption error code if state is 'interrupted' (e.g. 'NETWORK_FAILED', 'FILE_BLOCKED') */
  readonly error?: string;

  /** ID of extension that initiated download if triggered programmatically */
  readonly byExtensionId?: string;
}

/**
 * Comprehensive download safety evaluation result produced by the download detector.
 */
export interface DownloadSafetyEvaluation {
  /** Indicates whether heuristic rules determined the download to be elevated risk */
  readonly isSuspicious: boolean;

  /** Cumulative clamped risk score (0 to 100) */
  readonly score: number;

  /** Categorical RiskLevel mapped from score */
  readonly riskLevel: RiskLevel;

  /** Discrete human-readable explanations of triggered signals */
  readonly reasons: readonly string[];

  /** Fine-grained detected indicators */
  readonly indicators: readonly DownloadSafetyIndicator[];

  /** Structured reasons matching the Guardrail risk evaluation contract */
  readonly structuredReasons: readonly EvaluationReason[];

  /** Safely normalized filename metadata */
  readonly normalizedFile?: NormalizedFilenameInfo;

  /** Origin and domain analysis */
  readonly originAnalysis?: {
    readonly isRawIp: boolean;
    readonly isSuspiciousDomain: boolean;
    readonly isCrossDomain: boolean;
    readonly isPlainHttp: boolean;
    readonly downloadOrigin?: string;
    readonly referrerOrigin?: string;
  };

  /** MIME type consistency analysis */
  readonly mimeAnalysis?: {
    readonly declaredMime?: string;
    readonly isMismatch: boolean;
    readonly isSevereMismatch: boolean;
    readonly mismatchDetail?: string;
  };

  /** Protective action recommendation based on policy thresholds */
  readonly protectiveActionRecommended: 'NONE' | 'WARN' | 'PAUSE' | 'CANCEL';

  /** Indicates whether the browser confirmed successful pause or cancellation */
  readonly protectiveActionConfirmed?: boolean;

  /** Interruption details if download was interrupted */
  readonly interruptionDetail?: {
    readonly isInterrupted: boolean;
    readonly error?: string;
  };

  /** Browser SafeBrowsing danger details */
  readonly browserDangerDetail?: {
    readonly isDangerFlagged: boolean;
    readonly dangerType?: string;
  };

  /** Timestamp when evaluation completed */
  readonly evaluatedAt: string;
}

/**
 * Observable lifecycle display state for browser downloads in the UI.
 */
export type DownloadLifecycleDisplayState =
  | 'in_progress'
  | 'paused'
  | 'cancelled'
  | 'interrupted'
  | 'complete';

/**
 * Intelligence source classification for download risk assessments.
 */
export type DownloadIntelligenceSource =
  | 'LOCAL_HEURISTIC'
  | 'VERIFIED_THREAT_INTEL';

/**
 * Structured security and user-facing presentation context for download warnings.
 */
export interface DownloadSecurityContext {
  /** Download ID or identifier */
  readonly downloadId: number | string;

  /** Sanitized basename of the target file */
  readonly filename: string;

  /** Primary normalized extension (e.g. 'exe', 'vbs', 'pdf') */
  readonly extension: string;

  /** Human-readable categorical label for the file type (e.g. 'Executable Program', 'Script File') */
  readonly fileTypeLabel: string;

  /** Human-formatted file size (e.g. '14.2 MB', 'Unknown size / streaming') */
  readonly fileSizeFormatted: string;

  /** Declared or inferred MIME type */
  readonly declaredMime?: string;

  /** Origin domain or IP hostname where the download originated */
  readonly originDomain: string;

  /** Full sanitized download URL */
  readonly downloadUrl: string;

  /** Referrer domain where available */
  readonly referrerDomain?: string;

  /** Whether origin is a raw IP address */
  readonly isRawIp: boolean;

  /** Whether download transport is unencrypted HTTP */
  readonly isInsecureTransport: boolean;

  /** Assessment source: local safety heuristics vs verified browser SafeBrowsing */
  readonly intelligenceSource: DownloadIntelligenceSource;

  /** Plain-language explanation of assessment source (clarifying scope and limitations) */
  readonly intelligenceDisclaimer: string;

  /** Indicates whether the file was confirmed dangerous by browser SafeBrowsing (vs heuristic suspicion) */
  readonly isConfirmedMalicious: boolean;

  /** High-level severity badge label (e.g. 'Confirmed Dangerous', 'Suspicious File', 'Advisory Notice') */
  readonly severityLabel: string;

  /** Current observable download lifecycle status */
  readonly lifecycleState: DownloadLifecycleDisplayState;

  /** Plain-language explanation of current lifecycle state */
  readonly lifecycleExplanation: string;

  /** Interruption error if lifecycleState is 'interrupted' */
  readonly interruptionError?: string;

  /** List of detected risk indicators formulated in understandable non-technical language */
  readonly detectedIndicators: readonly string[];

  /** Non-frightening explanation of why Guardrail considers this download risky */
  readonly riskExplanation: string;

  /** Which protective actions are genuinely supported by the browser API */
  readonly supportedActions: {
    readonly canCancel: boolean;
    readonly canResume: boolean;
    readonly canInspectSafely: boolean;
  };

  /** Practical, actionable steps for safely handling or inspecting the file */
  readonly safeHandlingGuidance: readonly string[];

  /** Explicit disclaimer warning shown before supported continuation */
  readonly continuationWarning: string;
}

/**
 * Message requesting browser download cancellation.
 */
export interface GuardrailCancelDownloadMessage {
  readonly type: 'GUARDRAIL_CANCEL_DOWNLOAD';
  readonly downloadId: number;
}

/**
 * Message requesting browser download pause.
 */
export interface GuardrailPauseDownloadMessage {
  readonly type: 'GUARDRAIL_PAUSE_DOWNLOAD';
  readonly downloadId: number;
}

/**
 * Message requesting browser download resumption.
 */
export interface GuardrailResumeDownloadMessage {
  readonly type: 'GUARDRAIL_RESUME_DOWNLOAD';
  readonly downloadId: number;
}
