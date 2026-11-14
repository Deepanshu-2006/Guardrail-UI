/**
 * Guardrail Trusted-Contact Dashboard - Account Area Component
 *
 * Displays the authenticated trusted contact profile or an intentional unauthenticated placeholder.
 * Strictly avoids fabricated user data or storing credentials in client memory.
 * Uses crisp Lucide SVG icons instead of emojis.
 */

import { TrustedContactProfile } from '../types.js';
import { createIcon } from './icons.js';

export interface AccountProps {
  profile: TrustedContactProfile | null;
  onOpenSettings?: () => void;
  onOpenAuth?: () => void;
  onSignOut?: () => void;
}

export function renderAccountArea(props: AccountProps): HTMLElement {
  const container = document.createElement('div');
  container.className = 'gd-sidebar-footer';
  container.setAttribute('aria-label', 'Trusted Contact Identity');

  const card = document.createElement('div');
  card.className = 'gd-account-card';
  const clickHandler = props.onOpenAuth ?? props.onOpenSettings;
  if (clickHandler) {
    card.classList.add('clickable');
    card.setAttribute('role', 'button');
    card.setAttribute('tabindex', '0');
    card.setAttribute('aria-label', props.profile?.isAuthenticated ? 'Manage session and account settings' : 'Sign in to Guardrail');
    card.addEventListener('click', () => {
      clickHandler();
    });
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        clickHandler();
      }
    });
  }

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
    name.textContent = props.profile.email || props.profile.actorId;
    role.textContent = props.profile.assignedWardId
      ? `Contact for ${props.profile.assignedWardId}`
      : (props.profile.relationshipLabel || 'Trusted Contact');
  } else {
    avatar.appendChild(createIcon('lock', 'gd-avatar-icon'));
    name.textContent = 'Not Authenticated';
    role.textContent = 'Standalone Shell';
  }

  details.appendChild(name);
  details.appendChild(role);

  if (!props.profile?.isAuthenticated && props.onOpenAuth) {
    const signInBtn = document.createElement('button');
    signInBtn.type = 'button';
    signInBtn.className = 'gd-account-sign-in-btn';
    signInBtn.textContent = 'Sign In';
    signInBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      props.onOpenAuth?.();
    });
    details.appendChild(signInBtn);
  }

  card.appendChild(avatar);
  card.appendChild(details);

  if (props.onOpenAuth) {
    const authIcon = document.createElement('span');
    authIcon.className = 'gd-account-settings-icon';
    authIcon.setAttribute('aria-label', 'Authentication settings');
    authIcon.title = 'Session & Account Switcher';
    authIcon.appendChild(createIcon('shield'));
    card.appendChild(authIcon);
  } else if (props.onOpenSettings) {
    const settingsIcon = document.createElement('span');
    settingsIcon.className = 'gd-account-settings-icon';
    settingsIcon.setAttribute('aria-hidden', 'true');
    settingsIcon.appendChild(createIcon('settings'));
    card.appendChild(settingsIcon);
  }

  container.appendChild(card);

  return container;
}
