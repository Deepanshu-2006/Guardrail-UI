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

    .gd-banner-container {
      background: #FAF6ED;
      border: 1px solid #273121;
      border-radius: 12px;
      padding: 14px 18px;
      box-shadow: 0 8px 24px rgba(39, 49, 33, 0.16), 0 2px 6px rgba(39, 49, 33, 0.08);
      display: flex;
      flex-direction: column;
      gap: 10px;
      max-width: 440px;
      min-width: 320px;
      color: #273121;
      box-sizing: border-box;
    }

    .gd-banner-header {
      display: flex;
      align-items: flex-start;
      gap: 12px;
    }

    .gd-banner-icon {
      width: 28px;
      height: 28px;
      border-radius: 50%;
      background: rgba(74, 107, 66, 0.12);
      border: 1px solid rgba(74, 107, 66, 0.3);
      color: #385332;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      margin-top: 2px;
    }

    .gd-banner-text-block {
      display: flex;
      flex-direction: column;
      gap: 3px;
      flex: 1;
    }

    .gd-banner-title {
      font-size: 13.5px;
      font-weight: 700;
      line-height: 1.35;
      color: #273121;
      margin: 0;
    }

    .gd-banner-desc {
      font-size: 12.5px;
      color: #555E50;
      line-height: 1.4;
      margin: 0;
    }

    .gd-banner-actions {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 10px;
      margin-top: 4px;
    }

    .gd-btn-review {
      background: linear-gradient(180deg, #2D3927 0%, #1F281B 100%);
      color: #FAF6ED;
      border: 1px solid #1A2216;
      border-radius: 6px;
      padding: 7px 14px;
      font-size: 12.5px;
      font-weight: 600;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.15), 0 2px 4px rgba(23, 31, 19, 0.15);
      transition: all 0.18s cubic-bezier(0.16, 1, 0.3, 1);
    }

    .gd-btn-review:hover {
      background: linear-gradient(180deg, #374630 0%, #253221 100%);
      transform: translateY(-1px);
      box-shadow: 0 4px 10px rgba(23, 31, 19, 0.22);
    }

    .gd-btn-dismiss {
      background: transparent;
      color: #6E7569;
      border: 1px solid rgba(39, 49, 33, 0.18);
      border-radius: 6px;
      padding: 6px 12px;
      font-size: 12px;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.18s cubic-bezier(0.16, 1, 0.3, 1);
    }

    .gd-btn-dismiss:hover {
      color: #273121;
      background: rgba(39, 49, 33, 0.05);
      border-color: rgba(39, 49, 33, 0.3);
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
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
      <polyline points="22 4 12 14.01 9 11.01"></polyline>
    </svg>
  `;

  const textBlock = document.createElement('div');
  textBlock.className = 'gd-banner-text-block';

  const title = document.createElement('h3');
  title.className = 'gd-banner-title';
  title.textContent = `You have an approved action waiting: Continue on ${options.record.domain}`;

  const desc = document.createElement('p');
  desc.className = 'gd-banner-desc';
  const approverLabel = options.record.approver ? `Approved by ${options.record.approver}` : 'Approved by your Trusted Contact';
  desc.textContent = `${options.record.description} · ${approverLabel}`;

  textBlock.appendChild(title);
  textBlock.appendChild(desc);

  header.appendChild(icon);
  header.appendChild(textBlock);

  const actions = document.createElement('div');
  actions.className = 'gd-banner-actions';

  const dismissBtn = document.createElement('button');
  dismissBtn.className = 'gd-btn-dismiss';
  dismissBtn.type = 'button';
  dismissBtn.textContent = 'Dismiss';
  dismissBtn.addEventListener('click', () => {
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
  reviewBtn.addEventListener('click', () => {
    host.remove();
    options.onReviewAndContinue(options.record);
  });

  actions.appendChild(dismissBtn);
  actions.appendChild(reviewBtn);

  container.appendChild(header);
  container.appendChild(actions);
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
