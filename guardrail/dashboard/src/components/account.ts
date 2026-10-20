/**
 * Guardrail Trusted-Contact Dashboard - Account Area Component
 *
 * Displays the authenticated trusted contact profile or an intentional unauthenticated placeholder.
 * Strictly avoids fabricated user data or storing credentials in client memory.
 */

import { TrustedContactProfile } from '../types.js';

export interface AccountProps {
  profile: TrustedContactProfile | null;
}

export function renderAccountArea(props: AccountProps): HTMLElement {
  const container = document.createElement('div');
  container.className = 'gd-sidebar-footer';
  container.setAttribute('aria-label', 'Trusted Contact Identity');

  const card = document.createElement('div');
  card.className = 'gd-account-card';

  const avatar = document.createElement('div');
  avatar.className = 'gd-account-avatar';
  avatar.setAttribute('aria-hidden', 'true');

  const details = document.createElement('div');
  details.className = 'gd-account-details';

  const name = document.createElement('span');
  name.className = 'gd-account-name';

  const role = document.createElement('span');
  role.className = 'gd-account-role';

  if (props.profile && props.profile.isAuthenticated) {
    avatar.textContent = (props.profile.actorId.slice(3, 5) || 'TC').toUpperCase();
    name.textContent = props.profile.actorId;
    role.textContent = props.profile.assignedWardId
      ? `Contact for ${props.profile.assignedWardId}`
      : 'Trusted Contact';
  } else {
    avatar.textContent = '🔒';
    name.textContent = 'Not Authenticated';
    role.textContent = 'Standalone Shell';
  }

  details.appendChild(name);
  details.appendChild(role);

  card.appendChild(avatar);
  card.appendChild(details);
  container.appendChild(card);

  return container;
}
