/** Shared build-time backend URL contract for extension and dashboard bundles. */
export function resolveBackendUrl(env = process.env, environment = env.GUARDRAIL_ENV ?? (env.NODE_ENV === 'production' ? 'production' : 'development')) {
  if (!['development', 'test', 'pilot', 'production'].includes(environment)) {
    throw new Error('GUARDRAIL_ENV must be development, test, pilot, or production.');
  }
  if (env.NODE_ENV === 'production' && environment !== 'pilot' && environment !== 'production') {
    throw new Error('A production NODE_ENV cannot be paired with a non-deployment GUARDRAIL_ENV.');
  }
  const configured = env.GUARDRAIL_API_BASE_URL?.trim();
  const urlValue = configured || (environment === 'development' || environment === 'test' ? 'http://localhost:3000' : '');
  if (!urlValue) {
    throw new Error('GUARDRAIL_API_BASE_URL is required for pilot and production builds.');
  }
  let url;
  try { url = new URL(urlValue); } catch { throw new Error('GUARDRAIL_API_BASE_URL must be an absolute HTTP(S) URL.'); }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('GUARDRAIL_API_BASE_URL must be an origin with no credentials, path, query, or fragment.');
  }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (environment === 'pilot' || environment === 'production') {
    if (url.protocol !== 'https:' && !(environment === 'pilot' && local)) {
      throw new Error('Pilot and production backend URLs must use HTTPS (localhost HTTP is allowed for pilot only).');
    }
  }
  return url.origin;
}

export function hostPermissionForBackend(urlValue) {
  const url = new URL(urlValue);
  return `${url.origin}/*`;
}
