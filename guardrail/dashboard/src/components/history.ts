/**
 * Guardrail Trusted-Contact Dashboard - Decision History Component
 *
 * Displays the historical audit log of decided, expired, and cancelled requests.
 * Provides an intentional empty placeholder when no prior decisions have been committed.
 */

import { ApprovalRequest } from '../types.js';

export interface DecisionHistoryProps {
  historyRequests?: readonly ApprovalRequest[];
}

export function renderDecisionHistory(props: DecisionHistoryProps): HTMLElement {
  const section = document.createElement('section');
  section.id = 'view-history';
  section.className = 'gd-view-section';
  section.setAttribute('aria-labelledby', 'history-title');

  // Header
  const header = document.createElement('header');
  header.className = 'gd-section-header';

  const title = document.createElement('h1');
  title.id = 'history-title';
  title.className = 'gd-section-title';
  title.textContent = 'Decision History & Audit Log';

  const subtitle = document.createElement('p');
  subtitle.className = 'gd-section-subtitle';
  subtitle.textContent =
    'Permanent compliance audit trail recording all approved, rejected, expired, or cancelled requests.';

  header.appendChild(title);
  header.appendChild(subtitle);
  section.appendChild(header);

  // Content Card
  const card = document.createElement('div');
  card.className = 'gd-card';

  if (!props.historyRequests || props.historyRequests.length === 0) {
    const placeholder = document.createElement('div');
    placeholder.className = 'gd-placeholder';

    const icon = document.createElement('div');
    icon.className = 'gd-placeholder-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = '📜';

    const pTitle = document.createElement('h2');
    pTitle.className = 'gd-placeholder-title';
    pTitle.textContent = 'No Prior Decisions Recorded';

    const pText = document.createElement('p');
    pText.className = 'gd-placeholder-text';
    pText.textContent =
      'Decisions submitted by trusted contacts (or actions cancelled by wards) will be archived here with immutable timestamps and reviewer signatures.';

    placeholder.appendChild(icon);
    placeholder.appendChild(pTitle);
    placeholder.appendChild(pText);
    card.appendChild(placeholder);
  } else {
    // If historical items exist, render a structured audit list
    const list = document.createElement('div');
    list.className = 'gd-history-list';

    for (const req of props.historyRequests) {
      const item = document.createElement('div');
      item.className = 'gd-request-card';

      const desc = document.createElement('h2');
      desc.className = 'gd-request-description';
      desc.textContent = req.actionDescription;

      const meta = document.createElement('div');
      meta.className = 'gd-request-meta';
      meta.textContent = `Status: ${req.status} | Resolved: ${req.resolvedAt || 'N/A'}`;

      item.appendChild(desc);
      item.appendChild(meta);
      list.appendChild(item);
    }
    card.appendChild(list);
  }

  section.appendChild(card);
  return section;
}
