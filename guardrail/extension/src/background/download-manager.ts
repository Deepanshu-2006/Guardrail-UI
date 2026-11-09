/**
 * Guardrail Browser Download Monitoring Manager
 *
 * Implements centralized service worker monitoring of browser download events
 * using supported Chrome Extensions APIs (chrome.downloads).
 *
 * SECURITY & PRIVACY INVARIANTS:
 * 1. STRICT HEURISTIC BASIS: Risk evaluation is purely local and based on observable metadata.
 *    Never claims malware detection based solely on filename or extension.
 * 2. ZERO EXTERNAL SCANNING: No file contents, URLs, or metadata are transmitted to external services.
 * 3. NO FILE EXECUTION: Downloaded files are NEVER opened or executed.
 * 4. TRUTHFUL MITIGATION: A download is NEVER reported as blocked or paused unless the browser
 *    API confirms the state transition via onChanged event delta.
 * 5. BOUNDED MEMORY RETENTION: Assessments are stored strictly in an in-memory bounded LRU cache (max 50).
 *    No persistent storage of user download history is maintained.
 * 6. TESTABLE INTERFACE: Accepts an injectable chrome.downloads-compatible API for deterministic testing.
 */

import {
  DownloadItemMetadata,
  DownloadSafetyEvaluation,
} from '../types/download.js';
import { evaluateDownloadSafety } from '../utils/download-detector.js';
import { sanitizeUrlForDiagnostics } from '../utils/privacy.js';

/**
 * Minimal Chrome Downloads API interface for dependency injection.
 */
export interface ChromeDownloadsApi {
  onCreated?: {
    addListener: (callback: (item: any) => void) => void;
    removeListener?: (callback: (item: any) => void) => void;
  };
  onDeterminingFilename?: {
    addListener: (
      callback: (item: any, suggest: (suggestion?: { filename: string; conflictAction?: string }) => void) => boolean | void
    ) => void;
    removeListener?: (callback: (item: any) => void) => void;
  };
  onChanged?: {
    addListener: (callback: (delta: any) => void) => void;
    removeListener?: (callback: (delta: any) => void) => void;
  };
  pause?: (downloadId: number, callback?: () => void) => void | Promise<void>;
  resume?: (downloadId: number, callback?: () => void) => void | Promise<void>;
  cancel?: (downloadId: number, callback?: () => void) => void | Promise<void>;
  erase?: (query: { id?: number }, callback?: () => void) => void | Promise<void>;
  search?: (query: any, callback: (results: any[]) => void) => void | Promise<any[]>;
}

/**
 * Options for configuring the BrowserDownloadManager.
 */
export interface DownloadManagerOptions {
  /** Maximum number of download assessment records to retain in memory (default: 50) */
  readonly maxCacheSize?: number;

  /** Time-to-live in milliseconds for completed/interrupted download records (default: 60,000 ms) */
  readonly ttlMs?: number;

  /** Explicit downloads API instance (defaults to global chrome.downloads if present) */
  readonly downloadsApi?: ChromeDownloadsApi;

  /** Optional callback fired when an elevated risk download is detected */
  readonly onRiskDetected?: (evaluation: DownloadSafetyEvaluation, item: DownloadItemMetadata) => void;

  /** Optional callback fired when protective action (pause/cancel) is executed */
  readonly onProtectiveAction?: (action: 'PAUSE' | 'CANCEL', downloadId: number, confirmed: boolean) => void;
}

/**
 * Cached download evaluation entry.
 */
export interface CachedDownloadAssessment {
  readonly id: number;
  readonly item: DownloadItemMetadata;
  evaluation: DownloadSafetyEvaluation;
  readonly recordedAt: number;
  lastUpdatedAt: number;
}

/**
 * Centralized manager coordinating browser download monitoring, safety evaluation,
 * and protective mitigation via chrome.downloads events.
 */
export class BrowserDownloadManager {
  private readonly maxCacheSize: number;
  private readonly ttlMs: number;
  private readonly api?: ChromeDownloadsApi;
  private readonly assessments = new Map<number, CachedDownloadAssessment>();
  private readonly onRiskDetected?: (evaluation: DownloadSafetyEvaluation, item: DownloadItemMetadata) => void;
  private readonly onProtectiveAction?: (action: 'PAUSE' | 'CANCEL', downloadId: number, confirmed: boolean) => void;
  private isInitialized = false;

  constructor(options?: DownloadManagerOptions) {
    this.maxCacheSize = options?.maxCacheSize ?? 50;
    this.ttlMs = options?.ttlMs ?? 60_000;
    this.onRiskDetected = options?.onRiskDetected;
    this.onProtectiveAction = options?.onProtectiveAction;

    if (options?.downloadsApi) {
      this.api = options.downloadsApi;
    } else if (typeof chrome !== 'undefined' && chrome.downloads) {
      this.api = chrome.downloads as unknown as ChromeDownloadsApi;
    }
  }

  /**
   * Initializes listeners on browser download lifecycle events.
   * Safe to call multiple times (idempotent).
   */
  public initialize(): boolean {
    if (this.isInitialized) return true;
    if (!this.api) return false;

    // 1. chrome.downloads.onCreated: Initial observation and metadata inspection
    if (this.api.onCreated?.addListener) {
      this.api.onCreated.addListener((rawItem: any) => {
        this.handleDownloadCreated(rawItem);
      });
    }

    // 2. chrome.downloads.onDeterminingFilename: Final filename inspection & pre-write pause
    if (this.api.onDeterminingFilename?.addListener) {
      this.api.onDeterminingFilename.addListener((rawItem: any, suggest: any) => {
        return this.handleDeterminingFilename(rawItem, suggest);
      });
    }

    // 3. chrome.downloads.onChanged: Confirmation of pause, cancel, error, or completion
    if (this.api.onChanged?.addListener) {
      this.api.onChanged.addListener((delta: any) => {
        this.handleDownloadChanged(delta);
      });
    }

    this.isInitialized = true;
    return true;
  }

  /**
   * Handles download creation event.
   */
  public handleDownloadCreated(rawItem: any): DownloadSafetyEvaluation {
    const item = this.normalizeDownloadItem(rawItem);
    const evaluation = evaluateDownloadSafety(item);

    this.recordAssessment(item, evaluation);

    if (evaluation.isSuspicious && this.onRiskDetected) {
      this.onRiskDetected(evaluation, item);
    }

    return evaluation;
  }

  /**
   * Handles filename determination event.
   * Crucial phase: the filename is finalized before the browser writes bytes to disk.
   */
  public handleDeterminingFilename(
    rawItem: any,
    suggest?: (suggestion?: { filename: string; conflictAction?: string }) => void
  ): boolean | void {
    const item = this.normalizeDownloadItem(rawItem);
    const evaluation = evaluateDownloadSafety(item);

    this.recordAssessment(item, evaluation);

    if (evaluation.isSuspicious && this.onRiskDetected) {
      this.onRiskDetected(evaluation, item);
    }

    // If protective action is recommended, apply browser-supported controls
    if (evaluation.protectiveActionRecommended === 'CANCEL' && typeof this.api?.cancel === 'function') {
      try {
        this.api.cancel(item.id, () => {
          this.confirmProtectiveAction(item.id, 'CANCEL');
        });
      } catch {
        // Safe bypass on cancellation error
      }
    } else if (evaluation.protectiveActionRecommended === 'PAUSE' && typeof this.api?.pause === 'function') {
      try {
        this.api.pause(item.id, () => {
          this.confirmProtectiveAction(item.id, 'PAUSE');
        });
      } catch {
        // Safe bypass on pause error
      }
    }

    // Call suggest if provided to avoid hanging the download pipeline
    if (typeof suggest === 'function') {
      try {
        suggest();
      } catch {
        // Ignore suggest callback errors
      }
    }
  }

  /**
   * Handles download delta changes to truthfully record browser confirmations.
   */
  public handleDownloadChanged(delta: any): void {
    if (!delta || typeof delta.id !== 'number') return;
    const downloadId = delta.id;
    const cached = this.assessments.get(downloadId);
    if (!cached) return;

    let updatedItem = { ...cached.item };
    let needsReevaluation = false;

    // Check state change
    if (delta.state && delta.state.current) {
      updatedItem.state = delta.state.current;
      needsReevaluation = true;
    }

    // Check error change
    if (delta.error && delta.error.current) {
      updatedItem.error = delta.error.current;
      needsReevaluation = true;
    }

    // Check danger change
    if (delta.danger && delta.danger.current) {
      updatedItem.danger = delta.danger.current;
      needsReevaluation = true;
    }

    // Check paused state confirmation
    if (delta.paused) {
      updatedItem.paused = Boolean(delta.paused.current);
      if (delta.paused.current === true) {
        this.confirmProtectiveAction(downloadId, 'PAUSE');
      }
    }

    // Check filename change
    if (delta.filename && delta.filename.current) {
      updatedItem.filename = delta.filename.current;
      needsReevaluation = true;
    }

    if (needsReevaluation) {
      const newEvaluation = evaluateDownloadSafety(updatedItem);
      // Preserve confirmed status if previously confirmed
      const wasConfirmed = cached.evaluation.protectiveActionConfirmed;
      cached.evaluation = {
        ...newEvaluation,
        protectiveActionConfirmed: wasConfirmed || (updatedItem.state === 'interrupted' && cached.evaluation.protectiveActionRecommended === 'CANCEL'),
      };
      (cached as any).item = updatedItem;
      cached.lastUpdatedAt = Date.now();
    }
  }

  /**
   * Confirms that a protective action was acknowledged or completed by the browser.
   */
  public confirmProtectiveAction(downloadId: number, action: 'PAUSE' | 'CANCEL'): void {
    const cached = this.assessments.get(downloadId);
    if (cached) {
      cached.evaluation = {
        ...cached.evaluation,
        protectiveActionConfirmed: true,
      };
      cached.lastUpdatedAt = Date.now();
      if (this.onProtectiveAction) {
        this.onProtectiveAction(action, downloadId, true);
      }
    }
  }

  /**
   * Retrieves the latest safety assessment for a download ID.
   */
  public getAssessment(downloadId: number): DownloadSafetyEvaluation | undefined {
    this.pruneExpiredEntries();
    return this.assessments.get(downloadId)?.evaluation;
  }

  /**
   * Retrieves all currently active download assessments.
   */
  public getActiveAssessments(): readonly CachedDownloadAssessment[] {
    this.pruneExpiredEntries();
    return Array.from(this.assessments.values());
  }

  /**
   * Manually triggers pause on an active download.
   */
  public async pauseDownload(downloadId: number): Promise<boolean> {
    if (!this.api?.pause) return false;
    return new Promise((resolve) => {
      try {
        this.api!.pause!(downloadId, () => {
          this.confirmProtectiveAction(downloadId, 'PAUSE');
          resolve(true);
        });
      } catch {
        resolve(false);
      }
    });
  }

  /**
   * Manually triggers cancellation of a download.
   */
  public async cancelDownload(downloadId: number): Promise<boolean> {
    if (!this.api?.cancel) return false;
    return new Promise((resolve) => {
      try {
        this.api!.cancel!(downloadId, () => {
          this.confirmProtectiveAction(downloadId, 'CANCEL');
          resolve(true);
        });
      } catch {
        resolve(false);
      }
    });
  }

  /**
   * Manually resumes a paused download.
   */
  public async resumeDownload(downloadId: number): Promise<boolean> {
    if (!this.api?.resume) return false;
    return new Promise((resolve) => {
      try {
        this.api!.resume!(downloadId, () => {
          const cached = this.assessments.get(downloadId);
          if (cached) {
            (cached as any).item.paused = false;
            cached.lastUpdatedAt = Date.now();
          }
          resolve(true);
        });
      } catch {
        resolve(false);
      }
    });
  }

  /**
   * Cleans up in-memory history cache.
   */
  public clearHistory(): void {
    this.assessments.clear();
  }

  /**
   * Normalizes raw API objects into safe DownloadItemMetadata models, stripping
   * any sensitive URL query parameters (e.g. download tokens, signed S3 parameters).
   */
  private normalizeDownloadItem(raw: any): DownloadItemMetadata {
    if (!raw || typeof raw !== 'object') {
      return {
        id: -1,
        url: '',
      };
    }

    const rawUrl = typeof raw.url === 'string' ? raw.url : '';
    const rawFinalUrl = typeof raw.finalUrl === 'string' ? raw.finalUrl : undefined;
    const rawReferrer = typeof raw.referrer === 'string' ? raw.referrer : undefined;

    return {
      id: typeof raw.id === 'number' ? raw.id : -1,
      url: sanitizeUrlForDiagnostics(rawUrl) || rawUrl,
      finalUrl: rawFinalUrl ? (sanitizeUrlForDiagnostics(rawFinalUrl) || rawFinalUrl) : undefined,
      filename: typeof raw.filename === 'string' ? raw.filename : undefined,
      mime: typeof raw.mime === 'string' ? raw.mime : undefined,
      fileSize: typeof raw.fileSize === 'number' ? raw.fileSize : undefined,
      state: raw.state || 'in_progress',
      danger: typeof raw.danger === 'string' ? raw.danger : 'safe',
      paused: Boolean(raw.paused),
      referrer: rawReferrer ? (sanitizeUrlForDiagnostics(rawReferrer) || rawReferrer) : undefined,
      startTime: typeof raw.startTime === 'string' ? raw.startTime : undefined,
      error: typeof raw.error === 'string' ? raw.error : undefined,
      byExtensionId: typeof raw.byExtensionId === 'string' ? raw.byExtensionId : undefined,
    };
  }

  /**
   * Records an evaluation in the bounded in-memory cache, enforcing LRU bounds and pruning expired records.
   */
  private recordAssessment(item: DownloadItemMetadata, evaluation: DownloadSafetyEvaluation): void {
    const now = Date.now();

    // Actively purge any expired entries before capacity check
    this.pruneExpiredEntries();

    // If cache is at maximum capacity, evict oldest entry
    if (this.assessments.size >= this.maxCacheSize && !this.assessments.has(item.id)) {
      const oldestKey = this.assessments.keys().next().value;
      if (oldestKey !== undefined) {
        this.assessments.delete(oldestKey);
      }
    }

    this.assessments.set(item.id, {
      id: item.id,
      item,
      evaluation,
      recordedAt: now,
      lastUpdatedAt: now,
    });
  }

  /**
   * Prunes entries that have exceeded the time-to-live threshold.
   */
  private pruneExpiredEntries(): void {
    const now = Date.now();
    for (const [id, entry] of this.assessments.entries()) {
      // Completed or interrupted items are pruned after TTL
      if (
        (entry.item.state === 'complete' || entry.item.state === 'interrupted') &&
        now - entry.lastUpdatedAt > this.ttlMs
      ) {
        this.assessments.delete(id);
      }
    }
  }
}

/**
 * Singleton BrowserDownloadManager instance for background service worker.
 */
export const backgroundDownloadManager = new BrowserDownloadManager();
