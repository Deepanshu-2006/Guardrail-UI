import { Clerk } from '@clerk/clerk-js';

declare const __CLERK_PUBLISHABLE_KEY__: string | undefined;

let clerkInstance: Clerk | null = null;
let clerkInitPromise: Promise<Clerk | null> | null = null;

/**
 * Returns the singleton Clerk client instance, loading it once on demand.
 * Reads the Publishable Key from esbuild definition, global window object, or an optional argument.
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
      '';

    if (!key || !key.startsWith('pk_')) {
      return null;
    }

    try {
      const clerk = new Clerk(key);
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
