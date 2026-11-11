/**
 * Guardrail Trusted-Contact Dashboard - Navigation Component
 *
 * Implements the responsive brand header and sidebar navigation according to
 * the Quiet Assurance design system.
 * Uses crisp Lucide SVG icons, semantic `<nav>`, `<aside>`, and accessible buttons with `aria-current`.
 */

import { DashboardView } from '../types.js';
import { createIcon, IconName } from './icons.js';

export interface NavigationProps {
  activeView: DashboardView;
  pendingCount: number;
  onViewChange: (view: DashboardView) => void;
  onMobileToggle?: () => void;
}

export function renderNavigation(props: NavigationProps): HTMLElement {
  const sidebar = document.createElement('aside');
  sidebar.className = 'gd-sidebar';
  sidebar.setAttribute('aria-label', 'Primary Navigation');

  // Sidebar Top / Brand Header
  const sidebarHeader = document.createElement('div');
  sidebarHeader.className = 'gd-sidebar-header';

  const brand = document.createElement('div');
  brand.className = 'gd-brand';

  const badge = document.createElement('div');
  badge.className = 'gd-brand-badge';
  badge.setAttribute('aria-hidden', 'true');
  badge.innerHTML = `
    <svg class="gd-brand-icon-svg" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M 16 38 V 26 C 16 19 21 14 28 14 H 72 C 79 14 84 19 84 26 V 38" stroke="#EDE6D6" stroke-width="6.5" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M 16 62 V 74 C 16 81 21 86 28 86 H 72 C 79 86 84 81 84 74 V 62" stroke="#EDE6D6" stroke-width="6.5" stroke-linecap="round" stroke-linejoin="round"/>
      <rect x="22" y="34" width="56" height="32" rx="16" fill="#EDE6D6"/>
      <path d="M 43 45 L 53 55 M 53 45 L 43 55" stroke="#273121" stroke-width="4.5" stroke-linecap="round"/>
      <path d="M 64 45 L 82 63 L 73.5 65.5 L 78.5 76 L 73.5 78.5 L 68.5 68 L 61.5 74 Z" fill="#273121" stroke="#EDE6D6" stroke-width="3" stroke-linejoin="round"/>
    </svg>
  `;

  const brandText = document.createElement('div');
  brandText.className = 'gd-brand-text';

  const brandName = document.createElement('span');
  brandName.className = 'gd-brand-name';
  brandName.textContent = 'Guardrail';

  const brandTag = document.createElement('span');
  brandTag.className = 'gd-brand-tag';
  brandTag.textContent = 'Trusted Contact Portal';

  brandText.appendChild(brandName);
  brandText.appendChild(brandTag);
  brand.appendChild(badge);
  brand.appendChild(brandText);
  sidebarHeader.appendChild(brand);
  sidebar.appendChild(sidebarHeader);

  // Nav list
  const nav = document.createElement('nav');
  nav.setAttribute('aria-label', 'Dashboard Sections');

  const navList = document.createElement('ul');
  navList.className = 'gd-nav-list';

  const items: Array<{ view: DashboardView; label: string; icon: IconName; count?: number }> = [
    { view: 'overview', label: 'Overview', icon: 'layout-dashboard' },
    { view: 'pending', label: 'Pending Approvals', icon: 'clock', count: props.pendingCount },
    { view: 'history', label: 'Decision History', icon: 'history' },
    { view: 'settings', label: 'Settings', icon: 'settings' },
  ];

  for (const item of items) {
    const li = document.createElement('li');

    const link = document.createElement('a');
    link.href = `#${item.view}`;
    link.className = `gd-nav-link ${props.activeView === item.view ? 'active' : ''}`;
    if (props.activeView === item.view) {
      link.setAttribute('aria-current', 'page');
    }

    const iconSpan = document.createElement('span');
    iconSpan.className = 'gd-nav-icon';
    iconSpan.setAttribute('aria-hidden', 'true');
    iconSpan.appendChild(createIcon(item.icon));

    const labelSpan = document.createElement('span');
    labelSpan.className = 'gd-nav-label';
    labelSpan.textContent = item.label;

    link.appendChild(iconSpan);
    link.appendChild(labelSpan);

    if (item.count !== undefined && item.count > 0) {
      const badgeSpan = document.createElement('span');
      badgeSpan.className = 'gd-nav-badge';
      badgeSpan.setAttribute('aria-label', `${item.count} pending items`);
      badgeSpan.textContent = String(item.count);
      link.appendChild(badgeSpan);
    }

    link.addEventListener('click', (e) => {
      e.preventDefault();
      props.onViewChange(item.view);
    });

    li.appendChild(link);
    navList.appendChild(li);
  }

  nav.appendChild(navList);
  sidebar.appendChild(nav);

  return sidebar;
}
