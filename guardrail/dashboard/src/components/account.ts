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

  // Minimal unauthenticated state: Simple, sleek Sign In button with profile icon
  if (!props.profile?.isAuthenticated) {
    const signInBtn = document.createElement('button');
    signInBtn.type = 'button';
    signInBtn.className = 'gd-sidebar-sign-in-btn';
    signInBtn.setAttribute('aria-label', 'Sign in to Guardrail');

    const iconSpan = document.createElement('span');
    iconSpan.className = 'gd-sidebar-sign-in-icon';
    iconSpan.setAttribute('aria-hidden', 'true');
    iconSpan.appendChild(createIcon('log-in'));

    const textSpan = document.createElement('span');
    textSpan.className = 'gd-sidebar-sign-in-text';
    textSpan.textContent = 'Sign In';

    signInBtn.appendChild(iconSpan);
    signInBtn.appendChild(textSpan);

    const clickHandler = props.onOpenAuth ?? props.onOpenSettings;
    if (clickHandler) {
      signInBtn.addEventListener('click', () => {
        clickHandler();
      });
    }

    container.appendChild(signInBtn);
    return container;
  }

  // Authenticated state: User avatar, identity details, and account settings
  const card = document.createElement('div');
  card.className = 'gd-account-card clickable';
  card.setAttribute('role', 'button');
  card.setAttribute('tabindex', '0');
  card.setAttribute('aria-label', 'Manage session and account settings');
  const clickHandler = props.onOpenAuth ?? props.onOpenSettings;
  if (clickHandler) {
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

  const isDefaultAvatar = (url?: string | null): boolean => {
    if (!url) return true;
    return (
      url.includes('img.clerk.com/eyJ0eXBlIjoiZGVmYXVsdC') ||
      url.includes('images.clerk.dev') ||
      url.includes('gravatar.com/avatar?d=mp') ||
      url.includes('d=mp')
    );
  };

  const photoUrl = props.profile.avatarUrl || props.profile.imageUrl;
  if (photoUrl && !isDefaultAvatar(photoUrl)) {
    const img = document.createElement('img');
    img.className = 'gd-account-avatar-img';
    img.src = photoUrl;
    img.alt = props.profile.fullName || props.profile.email || 'Profile photo';
    img.setAttribute('loading', 'eager');
    img.onerror = () => {
      img.remove();
      if (!avatar.hasChildNodes()) {
        avatar.appendChild(createIcon('user', 'gd-avatar-icon'));
      }
    };
    avatar.appendChild(img);
  } else {
    avatar.appendChild(createIcon('user', 'gd-avatar-icon'));
  }

  const details = document.createElement('div');
  details.className = 'gd-account-details';

  const name = document.createElement('span');
  name.className = 'gd-account-name';
  name.textContent = props.profile.fullName || props.profile.email || props.profile.actorId;
  if (props.profile.email && props.profile.fullName) {
    name.title = props.profile.email;
  }

  const role = document.createElement('span');
  role.className = 'gd-account-role';
  role.textContent = props.profile.assignedWardId
    ? `Contact for ${props.profile.assignedWardId}`
    : (props.profile.relationshipLabel || 'Trusted Contact');

  details.appendChild(name);
  details.appendChild(role);

  card.appendChild(avatar);
  card.appendChild(details);

  const authIcon = document.createElement('span');
  authIcon.className = 'gd-account-settings-icon';
  authIcon.setAttribute('aria-hidden', 'true');
  authIcon.appendChild(createIcon('settings'));
  card.appendChild(authIcon);

  container.appendChild(card);
  return container;
}
