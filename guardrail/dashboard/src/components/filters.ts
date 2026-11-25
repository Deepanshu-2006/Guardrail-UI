/**
 * Guardrail Trusted-Contact Dashboard - Filter & Search Utility Component
 *
 * Implements practical, privacy-conscious filtering and search over approval requests:
 * 1. Status Filter: ALL, APPROVED, REJECTED, CANCELLED, EXPIRED (for History).
 * 2. Risk Level Filter: ALL, CRITICAL, HIGH, MEDIUM, LOW.
 * 3. Date Range Filter: ALL, TODAY (24h), 7_DAYS, 30_DAYS.
 * 4. Safe Non-Sensitive Keyword Search: Matches only safe metadata (description, hostname, origin, ID, category, audit reasons).
 *    Strictly excludes sensitive fields (passwords, OTPs, card numbers, tokens, raw values).
 * 5. Visual distinction and clear empty states for filters vs empty datasets.
 */

import { ApprovalRequest, ApprovalStatus, RequestFilters, RiskLevel } from '../types.js';
import { populateWardAvatar } from './icons.js';

export interface FilterBarOptions {
  filters: RequestFilters;
  totalCount: number;
  filteredCount: number;
  showStatusFilter?: boolean;
  showRiskFilter?: boolean;
  showDateFilter?: boolean;
  showWardFilter?: boolean;
  connectedWards?: readonly { id: string; name: string }[];
  searchPlaceholder?: string;
  onFiltersChange: (newFilters: RequestFilters) => void;
}

export interface FilterEmptyStateOptions {
  title?: string;
  description?: string;
  onClearFilters: () => void;
}

/**
 * Pure filtering function that applies status, risk level, date range, and safe search filters.
 */
export function filterRequests(
  requests: readonly ApprovalRequest[],
  filters: RequestFilters
): readonly ApprovalRequest[] {
  if (!requests || requests.length === 0) return [];

  return requests.filter((req) => {
    // 1. Status Filter
    if (filters.status && filters.status !== 'ALL') {
      const targetStatus = filters.status.toUpperCase();
      const itemStatus = (req.status || ApprovalStatus.PENDING).toUpperCase();
      if (itemStatus !== targetStatus) {
        return false;
      }
    }

    // 2. Risk Level Filter
    if (filters.riskLevel && filters.riskLevel !== 'ALL') {
      const targetRisk = filters.riskLevel.toUpperCase();
      const itemRisk = (req.riskLevel || 'LOW').toUpperCase();
      if (itemRisk !== targetRisk) {
        return false;
      }
    }

    // 3. Date Range Filter
    if (filters.dateRange && filters.dateRange !== 'ALL') {
      const dateStr = req.resolvedAt || req.createdAt;
      if (!dateStr) return false;
      const parsedTime = new Date(dateStr).getTime();
      if (isNaN(parsedTime)) return false;

      const diffMs = Date.now() - parsedTime;
      switch (filters.dateRange) {
        case 'TODAY':
          // Within last 24 hours (86,400,000 ms)
          if (diffMs < 0 || diffMs > 86400000) return false;
          break;
        case '7_DAYS':
          // Within last 7 days
          if (diffMs < 0 || diffMs > 7 * 86400000) return false;
          break;
        case '30_DAYS':
          // Within last 30 days
          if (diffMs < 0 || diffMs > 30 * 86400000) return false;
          break;
      }
    }

    // 4. Safe Non-Sensitive Keyword Search
    if (filters.searchQuery && filters.searchQuery.trim()) {
      const q = filters.searchQuery.trim().toLowerCase();
      const desc = (req.actionDescription || '').toLowerCase();
      const host = (req.hostname || req.origin || '').toLowerCase();
      const id = (req.id || '').toLowerCase();
      const cat = (req.category || '').toLowerCase();
      const auditNote = (req.decision?.decisionReason || req.cancellationReason || '').toLowerCase();

      const matches =
        desc.includes(q) ||
        host.includes(q) ||
        id.includes(q) ||
        cat.includes(q) ||
        auditNote.includes(q);

      if (!matches) return false;
    }

    // 5. Multi-Ward Filter
    if (filters.wardId && filters.wardId !== 'ALL') {
      const targetWard = filters.wardId.trim().toLowerCase();
      const reqWard = (req.requesterId || (req as any).wardId || '').trim().toLowerCase();
      if (reqWard !== targetWard) {
        return false;
      }
    }

    return true;
  });
}

/**
 * Checks whether any non-default filter is currently active.
 */
export function hasActiveFilters(filters: RequestFilters): boolean {
  if (filters.status && filters.status !== 'ALL') return true;
  if (filters.riskLevel && filters.riskLevel !== 'ALL') return true;
  if (filters.dateRange && filters.dateRange !== 'ALL') return true;
  if (filters.wardId && filters.wardId !== 'ALL') return true;
  if (filters.searchQuery && filters.searchQuery.trim().length > 0) return true;
  return false;
}

/**
 * Wraps a native select element with a custom unboxed dropdown UI while keeping
 * the hidden native select synchronized for tests, forms, and assistive technologies.
 */
export function createCustomSelect(
  selectEl: HTMLSelectElement,
  items: Array<{ value: string; label: string }>,
  currentValue: string,
  onChange: (val: string) => void
): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'gd-select-wrap';

  // Synchronized native select (for tests and accessibility)
  selectEl.style.position = 'absolute';
  selectEl.style.opacity = '0';
  selectEl.style.pointerEvents = 'none';
  selectEl.style.width = '1px';
  selectEl.style.height = '1px';
  selectEl.setAttribute('tabindex', '-1');
  wrap.appendChild(selectEl);

  // Custom Trigger Button
  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'gd-select-trigger';
  trigger.setAttribute('aria-haspopup', 'listbox');
  trigger.setAttribute('aria-expanded', 'false');
  trigger.setAttribute('aria-label', selectEl.getAttribute('aria-label') || 'Filter selection');

  const selectedItem = items.find((i) => i.value === currentValue) || items[0];
  const valueText = document.createElement('span');
  valueText.className = 'gd-select-value-text';
  valueText.textContent = selectedItem ? selectedItem.label : '';

  const chevron = document.createElement('span');
  chevron.className = 'gd-select-chevron';
  chevron.setAttribute('aria-hidden', 'true');
  chevron.innerHTML = `
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
      <path d="M6 9l6 6 6-6"></path>
    </svg>
  `;

  const underline = document.createElement('span');
  underline.className = 'gd-select-underline';
  underline.setAttribute('aria-hidden', 'true');

  trigger.appendChild(valueText);
  trigger.appendChild(chevron);
  trigger.appendChild(underline);
  wrap.appendChild(trigger);

  // Custom Menu
  const menu = document.createElement('div');
  menu.className = 'gd-select-menu';
  menu.setAttribute('role', 'listbox');

  const closeDropdown = () => {
    wrap.classList.remove('is-open');
    trigger.setAttribute('aria-expanded', 'false');
  };

  const openDropdown = () => {
    if (typeof document !== 'undefined') {
      const openWraps = document.querySelectorAll('.gd-select-wrap.is-open');
      for (let i = 0; i < openWraps.length; i++) {
        if (openWraps[i] !== wrap) {
          openWraps[i].classList.remove('is-open');
          openWraps[i].querySelector('.gd-select-trigger')?.setAttribute('aria-expanded', 'false');
        }
      }
    }
    wrap.classList.add('is-open');
    trigger.setAttribute('aria-expanded', 'true');
  };

  trigger.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (wrap.classList.contains('is-open')) {
      closeDropdown();
    } else {
      openDropdown();
    }
  });

  items.forEach((item) => {
    const optEl = document.createElement('div');
    optEl.className = `gd-select-option ${item.value === currentValue ? 'selected' : ''}`;
    optEl.setAttribute('role', 'option');
    optEl.setAttribute('aria-selected', item.value === currentValue ? 'true' : 'false');
    optEl.textContent = item.label;

    optEl.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const allOpts = menu.querySelectorAll('.gd-select-option');
      for (let i = 0; i < allOpts.length; i++) {
        allOpts[i].classList.remove('selected');
        allOpts[i].setAttribute('aria-selected', 'false');
      }
      optEl.classList.add('selected');
      optEl.setAttribute('aria-selected', 'true');
      valueText.textContent = item.label;
      selectEl.value = item.value;
      closeDropdown();
      onChange(item.value);
    });

    menu.appendChild(optEl);
  });

  wrap.appendChild(menu);

  if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
    const handleOutsideClick = (e: any) => {
      if (wrap.classList && wrap.classList.contains && wrap.classList.contains('is-open') && typeof wrap.contains === 'function' && !wrap.contains(e.target)) {
        closeDropdown();
      }
    };
    document.addEventListener('click', handleOutsideClick);

    trigger.addEventListener('keydown', (e: any) => {
      if (e.key === 'Escape') {
        closeDropdown();
        if (typeof trigger.focus === 'function') trigger.focus();
      }
    });
  }

  return wrap;
}

/**
 * Renders the accessible search and filter bar for request lists.
 */
export function renderFilterBar(options: FilterBarOptions): HTMLElement {
  const container = document.createElement('div');
  container.className = 'gd-filter-bar';
  container.setAttribute('role', 'search');
  container.setAttribute('aria-label', 'Filter and search requests');

  // Search Input Wrap
  const searchWrap = document.createElement('div');
  searchWrap.className = 'gd-search-input-wrap';

  const searchIcon = document.createElement('span');
  searchIcon.className = 'gd-search-icon';
  searchIcon.setAttribute('aria-hidden', 'true');
  searchIcon.innerHTML = `
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="11" cy="11" r="8"></circle>
      <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
    </svg>
  `;

  const searchInput = document.createElement('input');
  searchInput.type = 'search';
  searchInput.setAttribute('type', 'search');
  searchInput.className = 'gd-search-input';
  searchInput.placeholder = options.searchPlaceholder || 'Search by description, website, or ID...';
  searchInput.value = options.filters.searchQuery || '';
  searchInput.setAttribute('aria-label', 'Search requests by description, website, or ID');

  const underline = document.createElement('span');
  underline.className = 'gd-search-underline';
  underline.setAttribute('aria-hidden', 'true');

  let searchDebounceTimer: any = null;

  const triggerSearch = (query: string) => {
    if (searchDebounceTimer) {
      clearTimeout(searchDebounceTimer);
      searchDebounceTimer = null;
    }
    options.onFiltersChange({
      ...options.filters,
      searchQuery: query,
    });
  };

  searchInput.addEventListener('input', (e) => {
    const val = (e?.target as HTMLInputElement)?.value ?? searchInput.value;
    if (searchDebounceTimer) {
      clearTimeout(searchDebounceTimer);
    }
    searchDebounceTimer = setTimeout(() => {
      triggerSearch(val);
    }, 150);
  });

  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      triggerSearch(searchInput.value);
    }
  });

  searchInput.addEventListener('search', () => {
    triggerSearch(searchInput.value);
  });

  searchWrap.appendChild(searchIcon);
  searchWrap.appendChild(searchInput);
  searchWrap.appendChild(underline);
  container.appendChild(searchWrap);

  // Filter Controls Row
  const controlsRow = document.createElement('div');
  controlsRow.className = 'gd-filter-controls-row';

  // Status Filter Select (if enabled, e.g. in History)
  if (options.showStatusFilter) {
    const statusSelect = document.createElement('select');
    statusSelect.className = 'gd-filter-select gd-status-filter';
    statusSelect.setAttribute('aria-label', 'Filter by decision status');

    const statuses = [
      { value: 'ALL', label: 'All Decisions' },
      { value: ApprovalStatus.APPROVED, label: 'Approved' },
      { value: ApprovalStatus.REJECTED, label: 'Rejected' },
      { value: ApprovalStatus.CANCELLED, label: 'Cancelled' },
      { value: ApprovalStatus.EXPIRED, label: 'Expired' },
    ];

    for (const s of statuses) {
      const opt = document.createElement('option');
      opt.value = s.value;
      opt.textContent = s.label;
      if ((options.filters.status || 'ALL') === s.value) {
        opt.selected = true;
      }
      statusSelect.appendChild(opt);
    }

    const currentStatus = options.filters.status || 'ALL';
    const statusWrap = createCustomSelect(statusSelect, statuses, currentStatus, (newVal) => {
      options.onFiltersChange({
        ...options.filters,
        status: newVal as any,
      });
    });

    controlsRow.appendChild(statusWrap);
  }

  // Risk Level Filter Select
  if (options.showRiskFilter !== false) {
    const riskSelect = document.createElement('select');
    riskSelect.className = 'gd-filter-select gd-risk-filter';
    riskSelect.setAttribute('aria-label', 'Filter by risk level');

    const risks = [
      { value: 'ALL', label: 'All Risk Levels' },
      { value: RiskLevel.CRITICAL, label: 'Critical Risk' },
      { value: RiskLevel.HIGH, label: 'High Risk' },
      { value: RiskLevel.MEDIUM, label: 'Medium Risk' },
      { value: RiskLevel.LOW, label: 'Low Risk' },
    ];

    for (const r of risks) {
      const opt = document.createElement('option');
      opt.value = r.value;
      opt.textContent = r.label;
      if ((options.filters.riskLevel || 'ALL') === r.value) {
        opt.selected = true;
      }
      riskSelect.appendChild(opt);
    }

    const currentRisk = options.filters.riskLevel || 'ALL';
    const riskWrap = createCustomSelect(riskSelect, risks, currentRisk, (newVal) => {
      options.onFiltersChange({
        ...options.filters,
        riskLevel: newVal as any,
      });
    });

    controlsRow.appendChild(riskWrap);
  }

  // Date Range Filter Select
  if (options.showDateFilter !== false) {
    const dateSelect = document.createElement('select');
    dateSelect.className = 'gd-filter-select gd-date-filter';
    dateSelect.setAttribute('aria-label', 'Filter by date range');

    const ranges = [
      { value: 'ALL', label: 'All Time' },
      { value: 'TODAY', label: 'Last 24 Hours' },
      { value: '7_DAYS', label: 'Last 7 Days' },
      { value: '30_DAYS', label: 'Last 30 Days' },
    ];

    for (const rng of ranges) {
      const opt = document.createElement('option');
      opt.value = rng.value;
      opt.textContent = rng.label;
      if ((options.filters.dateRange || 'ALL') === rng.value) {
        opt.selected = true;
      }
      dateSelect.appendChild(opt);
    }

    const currentDate = (options.filters.dateRange as string) || 'ALL';
    const dateWrap = createCustomSelect(dateSelect, ranges, currentDate, (newVal) => {
      options.onFiltersChange({
        ...options.filters,
        dateRange: newVal as any,
      });
    });

    controlsRow.appendChild(dateWrap);
  }

  // Ward Filter Select (if multiple wards connected and enabled)
  if (options.showWardFilter !== false && options.connectedWards && options.connectedWards.length > 1) {
    const wardSelect = document.createElement('select');
    wardSelect.className = 'gd-filter-select gd-ward-filter';
    wardSelect.setAttribute('aria-label', 'Filter by protected ward');

    const wardItems = [
      { value: 'ALL', label: 'All Wards' },
      ...options.connectedWards.map((w) => ({ value: w.id, label: w.name })),
    ];

    for (const w of wardItems) {
      const opt = document.createElement('option');
      opt.value = w.value;
      opt.textContent = w.label;
      if ((options.filters.wardId || 'ALL').toLowerCase() === w.value.toLowerCase()) {
        opt.selected = true;
      }
      wardSelect.appendChild(opt);
    }

    const currentWard = options.filters.wardId || 'ALL';
    const wardWrap = createCustomSelect(wardSelect, wardItems, currentWard, (newVal) => {
      options.onFiltersChange({
        ...options.filters,
        wardId: newVal,
      });
    });

    controlsRow.appendChild(wardWrap);
  }

  // Clear Filters Button & Live Count Indicator
  const isFiltered = hasActiveFilters(options.filters) || options.filteredCount !== options.totalCount;

  const countEl = document.createElement('div');
  countEl.className = 'gd-filter-results-count';
  countEl.setAttribute('role', 'status');
  countEl.setAttribute('aria-live', 'polite');

  const countText = document.createElement('span');
  countText.className = 'gd-filter-results-text';
  countText.textContent = `Showing ${options.filteredCount} of ${options.totalCount}`;
  countEl.appendChild(countText);

  if (!isFiltered) {
    countEl.classList.add('is-hidden');
    countEl.style.display = 'none';
  }

  if (hasActiveFilters(options.filters)) {
    const clearBtn = document.createElement('button');
    clearBtn.type = 'button';
    clearBtn.className = 'gd-btn-reset-filters';
    clearBtn.textContent = 'Clear Filters';
    clearBtn.setAttribute('aria-label', 'Reset all active filters and search query');
    clearBtn.addEventListener('click', () => {
      options.onFiltersChange({
        status: 'ALL',
        riskLevel: 'ALL',
        dateRange: 'ALL',
        wardId: 'ALL',
        searchQuery: '',
      });
    });
    countEl.appendChild(clearBtn);
  }

  controlsRow.appendChild(countEl);
  container.appendChild(controlsRow);

  return container;
}

/**
 * Renders the filter empty state when filters eliminate all items.
 */
export function renderFilterEmptyState(options: FilterEmptyStateOptions): HTMLElement {
  const placeholder = document.createElement('div');
  placeholder.className = 'gd-placeholder gd-filter-empty-state';

  const icon = document.createElement('div');
  icon.className = 'gd-placeholder-icon';
  icon.setAttribute('aria-hidden', 'true');
  icon.textContent = '🔍';

  const title = document.createElement('h2');
  title.className = 'gd-placeholder-title';
  title.textContent = options.title || 'No Matching Requests Found';

  const text = document.createElement('p');
  text.className = 'gd-placeholder-text';
  text.textContent =
    options.description ||
    'No requests match the current filter and search criteria. Try adjusting your search query or reset filters.';

  const resetBtn = document.createElement('button');
  resetBtn.type = 'button';
  resetBtn.className = 'gd-btn-reset-filters gd-btn-reset-primary';
  resetBtn.textContent = 'Clear All Filters';
  resetBtn.addEventListener('click', () => {
    options.onClearFilters();
  });

  placeholder.appendChild(icon);
  placeholder.appendChild(title);
  placeholder.appendChild(text);
  placeholder.appendChild(resetBtn);

  return placeholder;
}

export interface WardSwitcherOptions {
  wards: readonly { id: string; name: string; email?: string; imageUrl?: string; avatarUrl?: string }[];
  activeWardId?: string;
  requests?: readonly ApprovalRequest[];
  contextKey?: string;
  showAvatars?: boolean;
  onSelectWard: (wardId: string) => void;
}

const wardSwitcherGliderCache = new Map<string, { left: number; width: number }>();

/**
 * Renders an accessible, unified segmented pill bar with a sliding olive indicator for switching between wards.
 */
export function renderWardSwitcher(options: WardSwitcherOptions): HTMLElement {
  const switcher = document.createElement('div');
  switcher.className = 'gd-ward-switcher';
  switcher.setAttribute('role', 'tablist');
  switcher.setAttribute('aria-label', 'Filter by protected ward');

  const cacheKey = options.contextKey || 'default';
  const showAvatars = options.showAvatars !== false;

  const counts: Record<string, number> = {};
  let totalCount = 0;
  if (options.requests) {
    totalCount = options.requests.length;
    for (const req of options.requests) {
      const wId = (req.requesterId || (req as any).wardId || '').trim().toLowerCase();
      if (wId) {
        counts[wId] = (counts[wId] || 0) + 1;
      }
    }
  }

  let currentActiveId = (options.activeWardId || 'ALL').trim().toLowerCase();

  // Sliding active olive indicator behind the selected tab
  const glider = document.createElement('span');
  glider.className = 'gd-ward-switcher-glider';
  glider.setAttribute('aria-hidden', 'true');
  switcher.appendChild(glider);

  const pillButtons: { id: string; el: HTMLButtonElement }[] = [];

  const syncGlider = (animate: boolean, updateCache: boolean = true) => {
    const activeEntry = pillButtons.find((p) => p.id === currentActiveId) || pillButtons[0];
    if (!activeEntry) return;
    const btn = activeEntry.el;
    const targetLeft = (btn as any).offsetLeft as number | undefined;
    const targetWidth = (btn as any).offsetWidth as number | undefined;
    if (typeof targetLeft !== 'number' || typeof targetWidth !== 'number' || targetWidth <= 0) {
      return;
    }

    switcher.classList.add('has-glider');
    const prev = wardSwitcherGliderCache.get(cacheKey);

    if (animate && prev && (Math.abs(prev.left - targetLeft) > 0.5 || Math.abs(prev.width - targetWidth) > 0.5)) {
      if (glider.style) {
        glider.style.transition = 'none';
        glider.style.width = `${prev.width}px`;
        glider.style.transform = `translate3d(${prev.left}px, 0, 0)`;
      }
      // Force layout commit before transitioning to target
      void (glider as any).offsetWidth;
      const runTransition = () => {
        if (glider.style) {
          glider.style.transition = '';
          glider.style.width = `${targetWidth}px`;
          glider.style.transform = `translate3d(${targetLeft}px, 0, 0)`;
        }
      };
      if (typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(runTransition);
      } else {
        runTransition();
      }
    } else if (glider.style) {
      glider.style.transition = 'none';
      glider.style.width = `${targetWidth}px`;
      glider.style.transform = `translate3d(${targetLeft}px, 0, 0)`;
      void (glider as any).offsetWidth;
      glider.style.transition = '';
    }

    if (updateCache) {
      wardSwitcherGliderCache.set(cacheKey, { left: targetLeft, width: targetWidth });
    }
  };

  const activatePill = (nextIdRaw: string) => {
    const nextLower = nextIdRaw.trim().toLowerCase();
    currentActiveId = nextLower;
    for (const item of pillButtons) {
      const isMatch = item.id === nextLower;
      if (isMatch) {
        item.el.classList.add('active');
        item.el.setAttribute('aria-selected', 'true');
      } else {
        item.el.classList.remove('active');
        item.el.setAttribute('aria-selected', 'false');
      }
    }
    syncGlider(true, false);
    options.onSelectWard(nextIdRaw);
  };

  // All Wards Pill
  const allBtn = document.createElement('button');
  allBtn.type = 'button';
  allBtn.className = `gd-ward-pill ${currentActiveId === 'all' ? 'active' : ''}`;
  allBtn.setAttribute('role', 'tab');
  allBtn.setAttribute('aria-selected', currentActiveId === 'all' ? 'true' : 'false');
  allBtn.innerHTML = `
    <span class="gd-ward-pill-name">All Wards</span>
    <span class="gd-ward-pill-count">${totalCount}</span>
  `;
  allBtn.addEventListener('click', () => activatePill('ALL'));
  pillButtons.push({ id: 'all', el: allBtn });
  switcher.appendChild(allBtn);

  // Per Ward Pills
  for (const ward of options.wards) {
    const wardLower = ward.id.trim().toLowerCase();
    const isSelected = currentActiveId === wardLower;
    const wardCount = counts[wardLower] || 0;

    const pill = document.createElement('button');
    pill.type = 'button';
    pill.className = `gd-ward-pill ${isSelected ? 'active' : ''}`;
    pill.setAttribute('role', 'tab');
    pill.setAttribute('aria-selected', isSelected ? 'true' : 'false');

    if (showAvatars) {
      const avatarSpan = document.createElement('span');
      avatarSpan.className = 'gd-ward-pill-avatar';
      avatarSpan.setAttribute('aria-hidden', 'true');
      populateWardAvatar(avatarSpan, {
        imageUrl: ward.imageUrl || ward.avatarUrl,
        name: ward.name,
        imgClass: 'gd-ward-pill-avatar-img',
        iconClass: 'gd-ward-pill-avatar-icon',
      });
      pill.appendChild(avatarSpan);
    }

    const nameSpan = document.createElement('span');
    nameSpan.className = 'gd-ward-pill-name';
    nameSpan.textContent = ward.name;

    const countSpan = document.createElement('span');
    countSpan.className = 'gd-ward-pill-count';
    countSpan.textContent = String(wardCount);

    pill.appendChild(nameSpan);
    pill.appendChild(countSpan);
    pill.addEventListener('click', () => activatePill(ward.id));
    pillButtons.push({ id: wardLower, el: pill });
    switcher.appendChild(pill);
  }

  // Measure and animate glider once attached to browser DOM
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(() => {
      syncGlider(true);
    });
  }

  return switcher;
}
