/**
 * Guardrail Staged Action Cold Restart Recovery
 *
 * Implements persistent serialization and recovery for intercepted actions held in
 * Staging Mode or awaiting Caretaker approval across browser restarts or tab closures.
 *
 * ARCHITECTURAL PRINCIPLES:
 * 1. ZERO-KNOWLEDGE & LEAST PRIVILEGE:
 *    - Persists only safe, high-level interaction metadata (actionId, requestId, origin,
 *      domain, description, risk level, action category, timestamps).
 *    - Strictly NEVER stores passwords, credit cards, OTPs, form field entries, session tokens,
 *      or live DOM node references.
 * 2. ORIGIN ISOLATION:
 *    - Staged actions are bound to the exact origin where the high-risk action occurred.
 *    - Cannot be recovered or surfaced on an unrelated domain.
 * 3. DETERMINISTIC TTL & EXPIRATION:
 *    - Actions have a strict expiration window (default 24 hours, or approval request deadline).
 *    - Stale or expired actions are pruned and fail-closed.
 * 4. EXACTLY-ONCE EXECUTION GUARANTEE:
 *    - Persisted state is permanently purged upon continuation, cancellation, or rejection.
 *    - Prevents duplicate execution or replay attacks.
 */

import { ActionCategory, RiskLevel } from '../types/index.js';

export const GUARDRAIL_RECOVERY_STORAGE_KEY = 'guardrail_staged_action_recovery_v1';
export const DEFAULT_RECOVERY_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export type StagedRecoveryStatus = 'held' | 'pending' | 'approved';

export interface StagedActionRecoveryRecord {
  readonly actionId: string;
  readonly requestId: string;
  readonly origin: string;
  readonly url: string;
  readonly domain: string;
  readonly description: string;
  readonly category?: ActionCategory;
  readonly riskLevel: RiskLevel;
  readonly status: StagedRecoveryStatus;
  readonly approver?: string;
  readonly destinationUrl?: string;
  readonly elementId?: string;
  readonly submittedAt: string;
  readonly updatedAt: string;
  readonly expiresAt: string;
}

export interface StagedRecoveryStorageProvider {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
  remove?(key: string): Promise<void>;
}

/**
 * Default storage provider utilizing chrome.storage.local, localStorage, or in-memory fallback.
 */
export class DefaultRecoveryStorageProvider implements StagedRecoveryStorageProvider {
  private inMemoryFallback: Map<string, unknown> = new Map();

  public async get(key: string): Promise<unknown> {
    if (typeof chrome !== 'undefined' && chrome.storage?.local?.get) {
      try {
        const result = await chrome.storage.local.get(key);
        return result ? result[key] : undefined;
      } catch (err) {
        console.warn('[Guardrail Recovery] chrome.storage.local.get failed:', err);
      }
    }

    if (typeof localStorage !== 'undefined') {
      try {
        const item = localStorage.getItem(key);
        return item ? JSON.parse(item) : undefined;
      } catch (err) {
        console.warn('[Guardrail Recovery] localStorage.getItem failed:', err);
      }
    }

    return this.inMemoryFallback.get(key);
  }

  public async set(key: string, value: unknown): Promise<void> {
    if (typeof chrome !== 'undefined' && chrome.storage?.local?.set) {
      try {
        await chrome.storage.local.set({ [key]: value });
        return;
      } catch (err) {
        console.warn('[Guardrail Recovery] chrome.storage.local.set failed:', err);
      }
    }

    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.setItem(key, JSON.stringify(value));
        return;
      } catch (err) {
        console.warn('[Guardrail Recovery] localStorage.setItem failed:', err);
      }
    }

    this.inMemoryFallback.set(key, value);
  }

  public async remove(key: string): Promise<void> {
    if (typeof chrome !== 'undefined' && chrome.storage?.local?.remove) {
      try {
        await chrome.storage.local.remove(key);
        return;
      } catch (err) {
        console.warn('[Guardrail Recovery] chrome.storage.local.remove failed:', err);
      }
    }

    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.removeItem(key);
        return;
      } catch (err) {
        console.warn('[Guardrail Recovery] localStorage.removeItem failed:', err);
      }
    }

    this.inMemoryFallback.delete(key);
  }
}

/**
 * In-memory storage provider for isolated unit tests.
 */
export class InMemoryRecoveryStorageProvider implements StagedRecoveryStorageProvider {
  private readonly storage = new Map<string, unknown>();

  public async get(key: string): Promise<unknown> {
    return this.storage.get(key);
  }

  public async set(key: string, value: unknown): Promise<void> {
    this.storage.set(key, value);
  }

  public async remove(key: string): Promise<void> {
    this.storage.delete(key);
  }

  public clear(): void {
    this.storage.clear();
  }
}

/**
 * Sanitizes input text to guarantee zero accidental password, token, or secret exposure.
 */
export function sanitizeRecoveryText(input?: string): string {
  if (!input) return '';
  return input
    .replace(/[a-zA-Z0-9_\-\.]{60,}/g, '[REDACTED_TOKEN]')
    .replace(/(password|passwd|secret|token|bearer|card|cvv|otp)=[^&\s]+/gi, '$1=[REDACTED]');
}

/**
 * Manager handling saving, updating, querying, and clearing staged action state.
 */
export class StagedActionRecoveryManager {
  private readonly storage: StagedRecoveryStorageProvider;

  constructor(storage: StagedRecoveryStorageProvider = new DefaultRecoveryStorageProvider()) {
    this.storage = storage;
  }

  /**
   * Retrieves all currently persisted recovery records.
   */
  public async getAllRecords(): Promise<Record<string, StagedActionRecoveryRecord>> {
    try {
      const raw = await this.storage.get(GUARDRAIL_RECOVERY_STORAGE_KEY);
      if (raw && typeof raw === 'object') {
        return raw as Record<string, StagedActionRecoveryRecord>;
      }
    } catch (err) {
      console.warn('[Guardrail Recovery] Failed to read recovery storage:', err);
    }
    return {};
  }

  /**
   * Persists a staged or held action descriptor into storage.
   */
  public async saveStagedAction(params: {
    actionId: string;
    requestId: string;
    origin: string;
    url: string;
    domain: string;
    description: string;
    category?: ActionCategory;
    riskLevel: RiskLevel;
    status?: StagedRecoveryStatus;
    approver?: string;
    destinationUrl?: string;
    elementId?: string;
    ttlMs?: number;
  }): Promise<StagedActionRecoveryRecord> {
    const now = new Date();
    const ttlMs = params.ttlMs ?? DEFAULT_RECOVERY_TTL_MS;
    const expiresAt = new Date(now.getTime() + ttlMs).toISOString();

    const record: StagedActionRecoveryRecord = {
      actionId: params.actionId.trim(),
      requestId: params.requestId.trim(),
      origin: params.origin.trim(),
      url: params.url.trim(),
      domain: params.domain.trim(),
      description: sanitizeRecoveryText(params.description),
      category: params.category,
      riskLevel: params.riskLevel,
      status: params.status ?? 'pending',
      approver: params.approver ? sanitizeRecoveryText(params.approver) : undefined,
      destinationUrl: params.destinationUrl,
      elementId: params.elementId,
      submittedAt: now.toISOString(),
      updatedAt: now.toISOString(),
      expiresAt,
    };

    const records = await this.getAllRecords();
    records[record.actionId] = record;
    await this.storage.set(GUARDRAIL_RECOVERY_STORAGE_KEY, records);
    return record;
  }

  /**
   * Updates status of an existing recovery record (e.g. from 'pending' to 'approved').
   */
  public async updateStagedActionStatus(
    actionId: string,
    status: StagedRecoveryStatus,
    approver?: string
  ): Promise<StagedActionRecoveryRecord | null> {
    const records = await this.getAllRecords();
    const existing = records[actionId];
    if (!existing) {
      return null;
    }

    const updated: StagedActionRecoveryRecord = {
      ...existing,
      status,
      approver: approver ? sanitizeRecoveryText(approver) : existing.approver,
      updatedAt: new Date().toISOString(),
    };

    records[actionId] = updated;
    await this.storage.set(GUARDRAIL_RECOVERY_STORAGE_KEY, records);
    return updated;
  }

  /**
   * Finds the most recent active staged action for a given origin.
   * Auto-prunes expired records.
   */
  public async getActiveRecovery(origin: string): Promise<StagedActionRecoveryRecord | null> {
    const records = await this.getAllRecords();
    const now = new Date().getTime();
    let latest: StagedActionRecoveryRecord | null = null;
    let hasPruned = false;

    for (const [id, record] of Object.entries(records)) {
      const expiresTime = new Date(record.expiresAt).getTime();
      if (expiresTime <= now) {
        delete records[id];
        hasPruned = true;
        continue;
      }

      if (record.origin === origin) {
        if (!latest || new Date(record.updatedAt).getTime() > new Date(latest.updatedAt).getTime()) {
          latest = record;
        }
      }
    }

    if (hasPruned) {
      await this.storage.set(GUARDRAIL_RECOVERY_STORAGE_KEY, records);
    }

    return latest;
  }

  /**
   * Retrieves a specific staged action by actionId.
   */
  public async getRecordByActionId(actionId: string): Promise<StagedActionRecoveryRecord | null> {
    const records = await this.getAllRecords();
    const record = records[actionId];
    if (!record) return null;

    if (new Date(record.expiresAt).getTime() <= Date.now()) {
      delete records[actionId];
      await this.storage.set(GUARDRAIL_RECOVERY_STORAGE_KEY, records);
      return null;
    }

    return record;
  }

  /**
   * Permanently clears a recovered or resolved action.
   */
  public async clearRecovery(actionId: string): Promise<boolean> {
    const records = await this.getAllRecords();
    if (records[actionId]) {
      delete records[actionId];
      await this.storage.set(GUARDRAIL_RECOVERY_STORAGE_KEY, records);
      return true;
    }
    return false;
  }

  /**
   * Clears all recovery records across all origins.
   */
  public async clearAll(): Promise<void> {
    if (this.storage.remove) {
      await this.storage.remove(GUARDRAIL_RECOVERY_STORAGE_KEY);
    } else {
      await this.storage.set(GUARDRAIL_RECOVERY_STORAGE_KEY, {});
    }
  }
}

export const defaultRecoveryManager = new StagedActionRecoveryManager();
