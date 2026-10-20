/**
 * Guardrail Trusted-Contact Dashboard - Navigation Component
 *
 * Implements the responsive brand header and sidebar navigation.
 * Uses semantic `<nav>`, `<header>`, and accessible buttons with `aria-current`.
 */

import { DashboardView } from '../types.js';

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
  badge.textContent = '🛡️';

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
  navList.setAttribute('role', 'menubar');

  const items: Array<{ view: DashboardView; label: string; icon: string; count?: number }> = [
    { view: 'overview', label: 'Overview', icon: '📊' },
    { view: 'pending', label: 'Pending Approvals', icon: '⏳', count: props.pendingCount },
    { view: 'history', label: 'Decision History', icon: '📜' },
  ];

  for (const item of items) {
    const li = document.createElement('li');
    li.setAttribute('role', 'none');

    const link = document.createElement('a');
    link.href = `#${item.view}`;
    link.className = `gd-nav-link ${props.activeView === item.view ? 'active' : ''}`;
    link.setAttribute('role', 'menuitem');
    if (props.activeView === item.view) {
      link.setAttribute('aria-current', 'page');
    }

    const iconSpan = document.createElement('span');
    iconSpan.className = 'gd-nav-icon';
    iconSpan.setAttribute('aria-hidden', 'true');
    iconSpan.textContent = item.icon;

    const labelSpan = document.createElement('span');
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
