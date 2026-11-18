import { Clerk } from '@clerk/clerk-js';

declare const __CLERK_PUBLISHABLE_KEY__: string | undefined;

export const DEFAULT_CLERK_PUBLISHABLE_KEY = 'pk_test_aGFybWxlc3Mtc25pcGUtOTA0NC5jbGVyay5hY2NvdW50cy5kZXYk';

let clerkInstance: Clerk | null = null;
let clerkInitPromise: Promise<Clerk | null> | null = null;

/**
 * Returns the singleton Clerk client instance, loading it once on demand.
 * Reads the Publishable Key from esbuild definition, global window object, or the production default.
 */
export async function getClerk(publishableKeyOverride?: string): Promise<Clerk | null> {
  if (clerkInstance) {
    return clerkInstance;
  }
  if (clerkInitPromise) {
    return clerkInitPromise;
  }

  clerkInitPromise = (async () => {
    const key =
      publishableKeyOverride ||
      (typeof __CLERK_PUBLISHABLE_KEY__ === 'string' && __CLERK_PUBLISHABLE_KEY__ ? __CLERK_PUBLISHABLE_KEY__ : '') ||
      (typeof window !== 'undefined' && (window as unknown as { __CLERK_PUBLISHABLE_KEY__?: string }).__CLERK_PUBLISHABLE_KEY__) ||
      DEFAULT_CLERK_PUBLISHABLE_KEY;

    // 1. If window.Clerk is already loaded, reuse it directly
    if (typeof window !== 'undefined') {
      const winClerk = (window as any).Clerk;
      if (winClerk && typeof winClerk === 'object') {
        if (!winClerk.loaded && typeof winClerk.load === 'function') {
          try {
            await winClerk.load();
          } catch (loadErr) {
            console.warn('[Guardrail Auth] window.Clerk.load error:', loadErr);
          }
        }
        clerkInstance = winClerk;
        return winClerk;
      }
    }

    if (!key || !key.startsWith('pk_')) {
      return null;
    }

    try {
      const clerk = new Clerk(key);
      if (typeof window !== 'undefined') {
        (window as any).Clerk = clerk;
      }
      await clerk.load();
      clerkInstance = clerk;
      return clerk;
    } catch (err) {
      console.warn('[Guardrail Auth] Failed to initialize Clerk client:', err);
      return null;
    }
  })();

  return clerkInitPromise;
}
