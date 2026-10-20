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

export interface FilterBarOptions {
  filters: RequestFilters;
  totalCount: number;
  filteredCount: number;
  showStatusFilter?: boolean;
  showRiskFilter?: boolean;
  showDateFilter?: boolean;
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
  if (filters.searchQuery && filters.searchQuery.trim().length > 0) return true;
  return false;
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

  const searchInput = document.createElement('input');
  searchInput.type = 'search';
  searchInput.className = 'gd-search-input';
  searchInput.placeholder = options.searchPlaceholder || 'Search by description, website, or ID...';
  searchInput.value = options.filters.searchQuery || '';
  searchInput.setAttribute('aria-label', 'Search requests by description, website, or ID');

  searchInput.addEventListener('input', (e) => {
    const val = (e?.target as HTMLInputElement)?.value ?? searchInput.value;
    options.onFiltersChange({
      ...options.filters,
      searchQuery: val,
    });
  });

  searchWrap.appendChild(searchInput);
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

    statusSelect.addEventListener('change', () => {
      options.onFiltersChange({
        ...options.filters,
        status: statusSelect.value,
      });
    });

    controlsRow.appendChild(statusSelect);
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

    riskSelect.addEventListener('change', () => {
      options.onFiltersChange({
        ...options.filters,
        riskLevel: riskSelect.value,
      });
    });

    controlsRow.appendChild(riskSelect);
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

    dateSelect.addEventListener('change', () => {
      options.onFiltersChange({
        ...options.filters,
        dateRange: dateSelect.value as any,
      });
    });

    controlsRow.appendChild(dateSelect);
  }

  // Clear Filters Button (shown only when filters or search query are active)
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
        searchQuery: '',
      });
    });
    controlsRow.appendChild(clearBtn);
  }

  // Live Count Indicator
  const countEl = document.createElement('div');
  countEl.className = 'gd-filter-results-count';
  countEl.setAttribute('role', 'status');
  countEl.setAttribute('aria-live', 'polite');
  countEl.textContent = `Showing ${options.filteredCount} of ${options.totalCount}`;

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
