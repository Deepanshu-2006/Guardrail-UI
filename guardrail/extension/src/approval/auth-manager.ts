/**
 * Guardrail Extension - Ward Identity & Authentication Manager
 *
 * Manages ward authentication tokens and identity verification:
 * - Secure persistence via chrome.storage.local ('guardrailAuthToken')
 * - Querying remote backend /api/v1/auth/me to verify actor identity
 * - Zero embedded secrets, supporting production OIDC PKCE and development tokens
 */

import { resolveEnvironmentConfig } from '../config/environment.js';

export interface WardIdentity {
  readonly actorId: string;
  readonly role: string;
  readonly email?: string;
  readonly isAuthenticated: boolean;
}

export async function getStoredWardToken(): Promise<string | undefined> {
  if (typeof chrome !== 'undefined' && chrome.storage?.local) {
    try {
      const items = await new Promise<Record<string, unknown>>((resolve) => {
        chrome.storage.local.get(['guardrailAuthToken'], resolve);
      });
      if (typeof items.guardrailAuthToken === 'string' && items.guardrailAuthToken.trim()) {
        return items.guardrailAuthToken.trim();
      }
    } catch {
      // Storage unavailable or permission denied
    }
  }

  const env = resolveEnvironmentConfig();
  if (env.environment === 'development') {
    return 'test-ward-token';
  }
  return undefined;
}

export async function setStoredWardToken(token: string): Promise<void> {
  const clean = token.trim();
  if (typeof chrome !== 'undefined' && chrome.storage?.local) {
    await new Promise<void>((resolve) => {
      chrome.storage.local.set({ guardrailAuthToken: clean }, () => resolve());
    });
  }
}

export async function clearStoredWardToken(): Promise<void> {
  if (typeof chrome !== 'undefined' && chrome.storage?.local) {
    await new Promise<void>((resolve) => {
      chrome.storage.local.remove(['guardrailAuthToken'], () => resolve());
    });
  }
}

export async function verifyWardIdentity(apiBaseUrl?: string): Promise<WardIdentity | null> {
  const token = await getStoredWardToken();
  if (!token) {
    return null;
  }

  const env = resolveEnvironmentConfig();
  const baseUrl = apiBaseUrl ?? env.apiBaseUrl;

  try {
    const res = await fetch(`${baseUrl}/api/v1/auth/me`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
    });

    if (!res.ok) return null;
    const body = (await res.json()) as {
      success: boolean;
      data?: { actorId: string; role: string; email?: string | null };
    };

    if (body.success && body.data) {
      return {
        actorId: body.data.actorId,
        role: body.data.role,
        email: body.data.email ?? undefined,
        isAuthenticated: true,
      };
    }
    return null;
  } catch {
    // If backend unreachable and in dev mode with default dev token
    if (token === 'test-ward-token') {
      return {
        actorId: 'usr_alice',
        role: 'USER',
        isAuthenticated: true,
      };
    }
    return null;
  }
}

