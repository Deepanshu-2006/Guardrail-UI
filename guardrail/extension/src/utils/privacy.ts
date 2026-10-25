/**
 * Guardrail Privacy & Diagnostics Sanitization Utilities
 *
 * Enforces strict zero-leakage privacy guarantees across Guardrail:
 * 1. ZERO CREDENTIAL LEAKAGE: Passwords, OTPs, CVVs, card numbers, and tokens are never logged.
 * 2. URL REDACTION: Query parameters and fragments are stripped from logged and displayed URLs.
 * 3. NO FORM VALUE EXPOSURE: Raw form inputs, session IDs, and cookies are systematically redacted.
 * 4. DETERMINISTIC AUDIT: Utilities provide verifiable safety assertions for test suites.
 */

/**
 * List of forbidden sensitive key patterns that must be redacted from diagnostic payloads.
 */
export const FORBIDDEN_SENSITIVE_KEY_PATTERNS: readonly RegExp[] = Object.freeze([
  /^pass(word|wd|phrase)?$/i,
  /^pwd$/i,
  /^otp$/i,
  /^totp$/i,
  /^pin$/i,
  /^mfa$/i,
  /^cvv$/i,
  /^cvc$/i,
  /^card$/i,
  /^card_?number$/i,
  /^cardNumber$/i,
  /^pan$/i,
  /^credit_?card$/i,
  /^debit_?card$/i,
  /^.*token.*$/i,
  /^bearer$/i,
  /^secret$/i,
  /^api_?key$/i,
  /^private_?key$/i,
  /^cookies?$/i,
  /^session$/i,
  /^session_?id$/i,
  /^ssn$/i,
  /^raw_?form(_?data|_?value)?$/i,
  /^input_?value$/i,
  /^form_?value$/i,
]);

/**
 * Strips query parameters and URL fragments/hashes that may contain sensitive tokens,
 * passwords, session identifiers, or PII.
 *
 * @param url Candidate URL string
 * @returns Sanitized URL string containing strictly origin and pathname (e.g. "https://example.com/checkout")
 */
export function sanitizeUrlForDiagnostics(url: string | undefined | null): string {
  if (!url || typeof url !== 'string' || !url.trim()) {
    return '';
  }

  const trimmed = url.trim();

  // Handle standard absolute URLs
  try {
    const parsed = new URL(trimmed);
    // Return protocol + host + pathname, strictly discarding search (?...) and hash (#...)
    return `${parsed.protocol}//${parsed.host}${parsed.pathname}`;
  } catch {
    // Handle relative or root-relative paths (e.g. "/account/settings?token=secret#top")
    if (trimmed.startsWith('/') || trimmed.startsWith('./') || trimmed.startsWith('../')) {
      const queryIdx = trimmed.indexOf('?');
      const hashIdx = trimmed.indexOf('#');
      let cutIdx = -1;

      if (queryIdx !== -1 && hashIdx !== -1) {
        cutIdx = Math.min(queryIdx, hashIdx);
      } else if (queryIdx !== -1) {
        cutIdx = queryIdx;
      } else if (hashIdx !== -1) {
        cutIdx = hashIdx;
      }

      return cutIdx !== -1 ? trimmed.substring(0, cutIdx) : trimmed;
    }

    // Fallback: Strip anything after '?' or '#' manually
    const queryIdx = trimmed.indexOf('?');
    const hashIdx = trimmed.indexOf('#');
    let cutIdx = -1;
    if (queryIdx !== -1 && hashIdx !== -1) {
      cutIdx = Math.min(queryIdx, hashIdx);
    } else if (queryIdx !== -1) {
      cutIdx = queryIdx;
    } else if (hashIdx !== -1) {
      cutIdx = hashIdx;
    }

    return cutIdx !== -1 ? trimmed.substring(0, cutIdx) : trimmed;
  }
}

/**
 * Recursively scrubs forbidden sensitive keys, values, and query parameters from an object or value.
 *
 * @param data Arbitrary payload or object to sanitize
 * @returns Sanitized deep copy with sensitive data redacted
 */
export function sanitizeForDiagnostics<T>(data: T): T {
  if (data === null || data === undefined) {
    return data;
  }

  // Handle primitive string values: check for embedded query params or credentials
  if (typeof data === 'string') {
    // If string is an absolute URL with query string, sanitize it
    if (/^https?:\/\//i.test(data) && (data.includes('?') || data.includes('#'))) {
      return sanitizeUrlForDiagnostics(data) as unknown as T;
    }
    return data;
  }

  if (typeof data !== 'object') {
    return data;
  }

  // Handle Arrays
  if (Array.isArray(data)) {
    return data.map((item) => sanitizeForDiagnostics(item)) as unknown as T;
  }

  // Handle standard Objects
  const sanitized: Record<string, any> = {};
  const entries = Object.entries(data as Record<string, any>);

  for (const [key, val] of entries) {
    const isContainer = typeof val === 'object' && val !== null;
    const isRawFormKey = /^(form_?data|form_?values?|form)$/i.test(key);

    const isForbidden =
      FORBIDDEN_SENSITIVE_KEY_PATTERNS.some((pattern) => pattern.test(key)) ||
      (!isContainer && isRawFormKey);

    if (isForbidden && (!isContainer || !isRawFormKey)) {
      sanitized[key] = '[REDACTED]';
    } else if (key.toLowerCase().includes('url') && typeof val === 'string') {
      sanitized[key] = sanitizeUrlForDiagnostics(val);
    } else if (isContainer) {
      sanitized[key] = sanitizeForDiagnostics(val);
    } else if (typeof val === 'string' && /^https?:\/\//i.test(val) && (val.includes('?') || val.includes('#'))) {
      sanitized[key] = sanitizeUrlForDiagnostics(val);
    } else {
      sanitized[key] = val;
    }
  }

  return sanitized as T;
}

/**
 * Validates that an arbitrary payload or serialized string is completely free
 * of forbidden credential keys, unredacted query parameters, or sensitive payment values.
 *
 * @param value Candidate object or payload
 * @returns Safety verification result
 */
export function isPrivacySafe(value: unknown): {
  readonly safe: boolean;
  readonly violations: readonly string[];
} {
  const violations: string[] = [];

  if (value === null || value === undefined) {
    return { safe: true, violations: [] };
  }

  const serialized = typeof value === 'string' ? value : JSON.stringify(value);

  // 1. Check for unredacted sensitive key-value pairs
  const sensitiveRegexes = [
    { pattern: /"(password|passwd|pwd|passphrase)"\s*:\s*"(?!\[REDACTED\])[^"]+"/i, name: 'password' },
    { pattern: /"(otp|totp|pin|mfa)"\s*:\s*"(?!\[REDACTED\])[^"]+"/i, name: 'otp' },
    { pattern: /"(cvv|cvc)"\s*:\s*"(?!\[REDACTED\])[^"]+"/i, name: 'cvv' },
    { pattern: /"(card_?number|cardNumber|pan)"\s*:\s*"(?!\[REDACTED\])[^"]+"/i, name: 'cardNumber' },
    { pattern: /"(auth_?token|session_?token|sessionToken|access_?token|refresh_?token|token|bearer)"\s*:\s*"(?!\[REDACTED\])[^"]+"/i, name: 'token' },
    { pattern: /"(cookies?)"\s*:\s*"(?!\[REDACTED\])[^"]+"/i, name: 'cookie' },
  ];

  for (const { pattern, name } of sensitiveRegexes) {
    if (pattern.test(serialized)) {
      violations.push(`Unredacted sensitive key found: "${name}"`);
    }
  }

  // 2. Check for URL query parameter leakage in URL fields
  const urlQueryRegex = /"(url|pageUrl|previousUrl|href)"\s*:\s*"https?:\/\/[^"]+\?[^"]+"/i;
  if (urlQueryRegex.test(serialized)) {
    violations.push('URL query parameters detected in diagnostics payload');
  }

  // 3. Check for URL fragments/hashes in URL fields
  const urlHashRegex = /"(url|pageUrl|previousUrl|href)"\s*:\s*"https?:\/\/[^"]+#[^"]+"/i;
  if (urlHashRegex.test(serialized)) {
    violations.push('URL hash/fragment detected in diagnostics payload');
  }

  return {
    safe: violations.length === 0,
    violations: Object.freeze(violations),
  };
}

/**
 * Diagnostic logger interface adhering to Guardrail's privacy-safe conventions.
 */
export interface DiagnosticLogger {
  info(message: string, metadata?: Record<string, unknown>): void;
  warn(message: string, metadata?: Record<string, unknown>): void;
  error(message: string, metadata?: Record<string, unknown>): void;
  debug?(message: string, metadata?: Record<string, unknown>): void;
}

/**
 * Creates an isolated, privacy-safe logger that automatically scrubs
 * credentials and query parameters before emitting to console or downstream sinks.
 *
 * @param prefix Logging scope namespace
 */
export function createDiagnosticLogger(prefix: string): DiagnosticLogger {
  return {
    info(message: string, metadata?: Record<string, unknown>): void {
      const sanitizedMeta = metadata ? sanitizeForDiagnostics(metadata) : undefined;
      if (sanitizedMeta) {
        console.log(`[${prefix}] ${message}`, sanitizedMeta);
      } else {
        console.log(`[${prefix}] ${message}`);
      }
    },
    warn(message: string, metadata?: Record<string, unknown>): void {
      const sanitizedMeta = metadata ? sanitizeForDiagnostics(metadata) : undefined;
      if (sanitizedMeta) {
        console.warn(`[${prefix}] ⚠️ ${message}`, sanitizedMeta);
      } else {
        console.warn(`[${prefix}] ⚠️ ${message}`);
      }
    },
    error(message: string, metadata?: Record<string, unknown>): void {
      const sanitizedMeta = metadata ? sanitizeForDiagnostics(metadata) : undefined;
      if (sanitizedMeta) {
        console.error(`[${prefix}] ❌ ${message}`, sanitizedMeta);
      } else {
        console.error(`[${prefix}] ❌ ${message}`);
      }
    },
    debug(message: string, metadata?: Record<string, unknown>): void {
      const sanitizedMeta = metadata ? sanitizeForDiagnostics(metadata) : undefined;
      if (sanitizedMeta) {
        console.debug(`[${prefix}] 🔍 ${message}`, sanitizedMeta);
      } else {
        console.debug(`[${prefix}] 🔍 ${message}`);
      }
    },
  };
}
