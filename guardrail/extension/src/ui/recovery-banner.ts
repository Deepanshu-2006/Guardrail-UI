/**
 * Guardrail Staged Action Recovery Notification Banner
 *
 * Renders an unobtrusive, accessible notification banner when a user reopens a tab
 * or cold-restarts the browser and has an approved action waiting on that origin.
 *
 * NOTIFICATION COPY SPECIFICATION:
 * "You have an approved action waiting: Continue on [Domain]"
 */

import { StagedActionRecoveryRecord } from '../interception/recovery.js';

export interface RecoveryBannerOptions {
  record: StagedActionRecoveryRecord;
  onReviewAndContinue: (record: StagedActionRecoveryRecord) => void;
  onDismiss: (record: StagedActionRecoveryRecord) => void;
}

export const RECOVERY_BANNER_ID = 'guardrail-recovery-banner-host';

/**
 * Creates and mounts the recovery banner in the document DOM.
 */
export function mountRecoveryBanner(options: RecoveryBannerOptions): HTMLElement | null {
  if (typeof document === 'undefined') return null;

  // Prevent duplicate banners
  const existing = document.getElementById(RECOVERY_BANNER_ID);
  if (existing) {
    existing.remove();
  }

  const host = document.createElement('div');
  host.id = RECOVERY_BANNER_ID;
  host.setAttribute('role', 'alert');
  host.setAttribute('aria-live', 'polite');
  host.style.cssText = `
    position: fixed;
    top: 16px;
    right: 20px;
    z-index: 2147483645;
    font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    animation: gd-banner-slide-down 0.4s cubic-bezier(0.16, 1, 0.3, 1) both;
  `;

  // Attach shadow root to completely isolate styling from host page
  const shadow = host.attachShadow({ mode: 'open' });

  const style = document.createElement('style');
  style.textContent = `
    @keyframes gd-banner-slide-down {
      from {
        opacity: 0;
        transform: translateY(-16px) scale(0.96);
      }
      to {
        opacity: 1;
        transform: translateY(0) scale(1);
      }
    }

    @keyframes gd-banner-tick-draw {
      0% { stroke-dashoffset: 24; }
      100% { stroke-dashoffset: 0; }
    }

    .gd-banner-container {
      font-family: 'DM Sans', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: #FAF6ED;
      border: 1px solid rgba(39, 49, 33, 0.14);
      border-radius: 16px;
      padding: 16px 18px 14px;
      box-shadow: 0 16px 38px rgba(22, 34, 18, 0.2), 0 3px 10px rgba(22, 34, 18, 0.08);
      display: flex;
      flex-direction: column;
      gap: 13px;
      width: 396px;
      max-width: calc(100vw - 32px);
      color: #192215;
      box-sizing: border-box;
    }

    .gd-banner-header {
      display: flex;
      align-items: center;
      gap: 13px;
    }

    .gd-banner-icon {
      width: 38px;
      height: 38px;
      border-radius: 50%;
      background: linear-gradient(180deg, #243D22 0%, #172716 100%);
      color: #FAF7F0;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      box-shadow: 0 0 0 3px #E2ECD5, 0 3px 8px rgba(23, 39, 22, 0.22);
    }

    .gd-banner-tick-path {
      stroke-dasharray: 24;
      stroke-dashoffset: 24;
      animation: gd-banner-tick-draw 0.38s cubic-bezier(0.16, 1, 0.3, 1) 0.1s forwards;
    }

    .gd-banner-text-block {
      display: flex;
      flex-direction: column;
      gap: 3px;
      flex: 1;
      min-width: 0;
    }

    .gd-banner-eyebrow {
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 0.09em;
      text-transform: uppercase;
      color: #4A6331;
      margin: 0;
    }

    .gd-banner-title {
      font-size: 14.5px;
      font-weight: 700;
      line-height: 1.3;
      color: #192215;
      margin: 0;
    }

    .gd-banner-desc {
      font-size: 12.5px;
      color: #555E50;
      line-height: 1.4;
      margin: 2px 0 0 0;
    }

    .gd-banner-footer {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      padding-top: 11px;
      border-top: 1px solid rgba(39, 49, 33, 0.09);
    }

    .gd-banner-approver {
      font-size: 11.5px;
      font-weight: 500;
      color: #6B7465;
      margin: 0;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .gd-banner-actions {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 8px;
      flex-shrink: 0;
    }

    .gd-btn-review {
      background: #24381E;
      color: #FAF7F0;
      border: 1px solid #24381E;
      border-radius: 9px;
      padding: 7px 15px;
      font-size: 12.5px;
      font-weight: 600;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      box-shadow: 0 2px 6px rgba(22, 43, 20, 0.2);
      transition: all 0.16s cubic-bezier(0.16, 1, 0.3, 1);
    }

    .gd-btn-review:hover {
      background: #1B2B16;
      border-color: #1B2B16;
      transform: translateY(-1px);
      box-shadow: 0 4px 10px rgba(22, 43, 20, 0.28);
    }

    .gd-btn-dismiss {
      background: transparent;
      color: #555E50;
      border: 1px solid rgba(39, 49, 33, 0.18);
      border-radius: 9px;
      padding: 7px 13px;
      font-size: 12.5px;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.16s cubic-bezier(0.16, 1, 0.3, 1);
    }

    .gd-btn-dismiss:hover {
      color: #192215;
      background: rgba(39, 49, 33, 0.06);
      border-color: rgba(39, 49, 33, 0.28);
    }
  `;

  shadow.appendChild(style);

  const container = document.createElement('div');
  container.className = 'gd-banner-container';

  const header = document.createElement('div');
  header.className = 'gd-banner-header';

  const icon = document.createElement('div');
  icon.className = 'gd-banner-icon';
  icon.innerHTML = `
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path class="gd-banner-tick-path" d="M5 13l4 4L19 7"></path>
    </svg>
  `;

  const textBlock = document.createElement('div');
  textBlock.className = 'gd-banner-text-block';

  const eyebrow = document.createElement('div');
  eyebrow.className = 'gd-banner-eyebrow';
  eyebrow.textContent = 'Guardrail · Approved';

  const title = document.createElement('h3');
  title.className = 'gd-banner-title';
  title.textContent = `Ready to continue on ${options.record.domain}`;

  const desc = document.createElement('p');
  desc.className = 'gd-banner-desc';
  desc.textContent = options.record.description;

  const approverEl = document.createElement('p');
  approverEl.className = 'gd-banner-approver';
  approverEl.textContent = options.record.approver
    ? `By ${options.record.approver}`
    : 'Trusted Contact';

  textBlock.appendChild(eyebrow);
  textBlock.appendChild(title);
  textBlock.appendChild(desc);

  header.appendChild(icon);
  header.appendChild(textBlock);

  const footer = document.createElement('div');
  footer.className = 'gd-banner-footer';

  const actions = document.createElement('div');
  actions.className = 'gd-banner-actions';

  const dismissBtn = document.createElement('button');
  dismissBtn.className = 'gd-btn-dismiss';
  dismissBtn.type = 'button';
  dismissBtn.textContent = 'Dismiss';
  dismissBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    host.remove();
    options.onDismiss(options.record);
  });

  const reviewBtn = document.createElement('button');
  reviewBtn.className = 'gd-btn-review';
  reviewBtn.type = 'button';
  reviewBtn.innerHTML = `
    <span>Review & Continue</span>
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <polyline points="9 18 15 12 9 6"></polyline>
    </svg>
  `;
  reviewBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    host.remove();
    options.onReviewAndContinue(options.record);
  });

  actions.appendChild(dismissBtn);
  actions.appendChild(reviewBtn);

  footer.appendChild(approverEl);
  footer.appendChild(actions);

  container.appendChild(header);
  container.appendChild(footer);
  shadow.appendChild(container);

  document.body.appendChild(host);
  return host;
}

/**
 * Dismisses the recovery banner if mounted.
 */
export function dismissRecoveryBanner(): void {
  if (typeof document === 'undefined') return;
  const existing = document.getElementById(RECOVERY_BANNER_ID);
  if (existing) {
    existing.remove();
  }
}
