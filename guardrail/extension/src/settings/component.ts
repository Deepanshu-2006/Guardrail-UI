/**
 * Guardrail UI - Protection Settings Component
 *
 * Implements the responsive, accessible protection settings interface for
 * the protected user. Adheres strictly to the Guardrail design system tokens
 * and architectural security requirements.
 *
 * ZERO TRUST & INTEGRITY RULES:
 * 1. TRUTHFUL CAPABILITY REPRESENTATION:
 *    - Never displays fake toggles for unsupported features (e.g. automated SMS alerts).
 *    - Explicitly describes the scope boundary of pilot protection.
 * 2. IMMUTABLE SAFETY INVARIANTS:
 *    - CONTROLLED_DESTRUCTIVE and UNSUPPORTED_BOUNDARY_GUARD are permanently locked
 *      with clear visual lock indicators and explanations.
 * 3. REAL-TIME VALIDATION:
 *    - Validates inputs as the user edits, displaying field-level guidance.
 * 4. RESPONSIVE DESIGN:
 *    - Flawlessly usable on desktop workspaces and smaller/mobile screens.
 */

import { ResponseAction } from '../types/response.js';
import { RiskPolicyId } from '../types/policy.js';
import { POLICY_SETTINGS_SPECIFICATIONS } from '../config/schema.js';
import { ProtectionSettingsController } from './controller.js';
import {
  ProtectionSettingsProps,
  ProtectionSettingsState,
  SensitivityPreset,
} from './types.js';

export function renderProtectionSettings(
  controller: ProtectionSettingsController,
  props: ProtectionSettingsProps = {}
): HTMLElement {
  const container = document.createElement('div');
  container.className = 'gd-settings-container';
  container.setAttribute('role', 'region');
  container.setAttribute('aria-label', 'Protection Settings');

  function render(): void {
    container.innerHTML = '';
    const state = controller.getState();

    // -------------------------------------------------------------------------
    // Top Navigation / Header
    // -------------------------------------------------------------------------
    const header = document.createElement('header');
    header.className = 'gd-settings-header';

    const headerLeft = document.createElement('div');
    headerLeft.className = 'gd-settings-header-left';

    const brandRow = document.createElement('div');
    brandRow.className = 'gd-settings-brand-row';

    const logoBadge = document.createElement('div');
    logoBadge.className = 'gd-brand-badge';
    logoBadge.textContent = 'G';
    logoBadge.setAttribute('aria-hidden', 'true');

    const titleGroup = document.createElement('div');
    const title = document.createElement('h1');
    title.className = 'gd-page-title';
    title.textContent = 'Protection Settings';

    const subtitle = document.createElement('p');
    subtitle.className = 'gd-page-subtitle';
    subtitle.textContent =
      'Configure browser protection policies, risk sensitivity thresholds, and safety rules.';

    titleGroup.appendChild(title);
    titleGroup.appendChild(subtitle);
    brandRow.appendChild(logoBadge);
    brandRow.appendChild(titleGroup);
    headerLeft.appendChild(brandRow);

    const headerActions = document.createElement('div');
    headerActions.className = 'gd-settings-header-actions';

    // Status Pill
    const statusPill = document.createElement('span');
    statusPill.className = `gd-status-pill ${
      state.protectionReport?.status === 'ACTIVE'
        ? 'gd-status-active'
        : state.protectionReport?.status === 'DEGRADED'
        ? 'gd-status-warn'
        : 'gd-status-error'
    }`;
    statusPill.textContent = state.protectionReport
      ? `Protection: ${state.protectionReport.status}`
      : 'Loading Status...';
    headerActions.appendChild(statusPill);

    // Reset Defaults Button
    const btnReset = document.createElement('button');
    btnReset.type = 'button';
    btnReset.className = 'gd-btn gd-btn-secondary';
    btnReset.id = 'btn-reset-defaults';
    btnReset.textContent = 'Reset to Defaults';
    btnReset.disabled = state.status === 'saving';
    btnReset.addEventListener('click', () => {
      controller.resetToDefaults();
    });
    headerActions.appendChild(btnReset);

    // Save Button
    const btnSave = document.createElement('button');
    btnSave.type = 'button';
    btnSave.className = 'gd-btn gd-btn-primary';
    btnSave.id = 'btn-save-settings';
    btnSave.textContent = state.status === 'saving' ? 'Saving...' : 'Save Changes';
    btnSave.disabled = !state.isDirty || state.validationErrors.length > 0 || state.status === 'saving';
    btnSave.addEventListener('click', async () => {
      await controller.save();
    });
    headerActions.appendChild(btnSave);

    header.appendChild(headerLeft);
    header.appendChild(headerActions);
    container.appendChild(header);

    // -------------------------------------------------------------------------
    // Quick Section Anchor Navigation (Pills)
    // -------------------------------------------------------------------------
    const navBar = document.createElement('nav');
    navBar.className = 'gd-settings-nav';
    navBar.setAttribute('aria-label', 'Settings Sections');

    const navItems = [
      { id: 'card-overall-status', label: 'Status & Scope' },
      { id: 'card-action-categories', label: 'Action Policies' },
      { id: 'card-risk-sensitivity', label: 'Risk Sensitivity' },
      { id: 'card-staging-mode', label: 'Timeouts' },
      { id: 'card-trusted-contacts', label: 'Trusted Contacts' },
      { id: 'card-trusted-domains', label: 'Allowlist' },
      { id: 'card-policy-specifications', label: 'Specifications' },
    ];

    for (const item of navItems) {
      const navBtn = document.createElement('button');
      navBtn.type = 'button';
      navBtn.className = 'gd-nav-pill';
      navBtn.textContent = item.label;
      navBtn.addEventListener('click', () => {
        const target = container.querySelector(`#${item.id}`);
        if (target && typeof (target as any).scrollIntoView === 'function') {
          (target as any).scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      });
      navBar.appendChild(navBtn);
    }
    container.appendChild(navBar);

    // -------------------------------------------------------------------------
    // Banners: Feedback, Dirty State, Errors
    // -------------------------------------------------------------------------
    if (state.errorMessage) {
      const errBanner = document.createElement('div');
      errBanner.className = 'gd-alert gd-alert-danger';
      errBanner.id = 'settings-error-banner';
      errBanner.setAttribute('role', 'alert');
      errBanner.textContent = state.errorMessage;
      container.appendChild(errBanner);
    }

    if (state.successMessage) {
      const succBanner = document.createElement('div');
      succBanner.className = 'gd-alert gd-alert-success';
      succBanner.id = 'settings-success-banner';
      succBanner.setAttribute('role', 'status');
      succBanner.textContent = state.successMessage;
      container.appendChild(succBanner);
    }

    if (state.isDirty && state.validationErrors.length === 0) {
      const dirtyBanner = document.createElement('div');
      dirtyBanner.className = 'gd-alert gd-alert-info';
      dirtyBanner.id = 'settings-dirty-banner';
      dirtyBanner.textContent =
        '● You have uncommitted setting adjustments. Click "Save Changes" to apply them.';
      container.appendChild(dirtyBanner);
    }

    // -------------------------------------------------------------------------
    // Main Settings Workspace (Responsive Grid)
    // -------------------------------------------------------------------------
    const mainGrid = document.createElement('div');
    mainGrid.className = 'gd-settings-layout-grid';

    // -------------------------------------------------------------------------
    // Card 1: Live Protection Status & Scope Boundaries
    // -------------------------------------------------------------------------
    const cardStatus = document.createElement('section');
    cardStatus.className = 'gd-card gd-settings-card';
    cardStatus.id = 'card-overall-status';

    const cardStatusHeader = document.createElement('div');
    cardStatusHeader.className = 'gd-card-header';
    const statusKicker = document.createElement('div');
    statusKicker.className = 'gd-section-tag-group';
    statusKicker.innerHTML = `
      <span class="gd-section-number">01</span>
      <span class="gd-section-kicker">SCOPE & STATE</span>
    `;
    const statusTitle = document.createElement('h2');
    statusTitle.className = 'gd-card-title';
    statusTitle.textContent = 'Protection Status & Scope';
    const statusDesc = document.createElement('p');
    statusDesc.className = 'gd-section-desc';
    statusDesc.textContent = 'Runtime health and pilot boundary guarantees.';
    cardStatusHeader.appendChild(statusKicker);
    cardStatusHeader.appendChild(statusTitle);
    cardStatusHeader.appendChild(statusDesc);
    cardStatus.appendChild(cardStatusHeader);

    const statusBody = document.createElement('div');
    statusBody.className = 'gd-card-body';

    const statusReport = state.protectionReport;
    const isLiveActive = statusReport?.status === 'ACTIVE';

    const statusGrid = document.createElement('div');
    statusGrid.className = 'gd-info-grid';

    const addInfoItem = (label: string, value: string, badgeClass?: string) => {
      const item = document.createElement('div');
      item.className = 'gd-info-item';
      const lbl = document.createElement('span');
      lbl.className = 'gd-info-label';
      lbl.textContent = label;
      const val = document.createElement('span');
      val.className = `gd-info-value ${badgeClass ?? ''}`;
      val.textContent = value;
      item.appendChild(lbl);
      item.appendChild(val);
      statusGrid.appendChild(item);
    };

    addInfoItem(
      'Operational State',
      statusReport ? statusReport.statusTitle : 'Loading...',
      isLiveActive ? 'gd-text-success' : 'gd-text-warn'
    );
    addInfoItem('Policy Format', `v${state.draftConfig.schemaVersion}`);
    addInfoItem('Policy Configuration', `v${state.draftConfig.policyVersion}`);
    addInfoItem(
      'Active Rules Count',
      `${state.draftConfig.policies.filter((p) => p.enabled).length} of ${state.draftConfig.policies.length} enabled`
    );

    statusBody.appendChild(statusGrid);

    // Truthful Scope Disclosure
    const scopeBox = document.createElement('div');
    scopeBox.className = 'gd-scope-disclosure-box';
    const scopeTitle = document.createElement('h3');
    scopeTitle.className = 'gd-disclosure-title';
    scopeTitle.textContent = 'Truthful Protection Scope Boundary';
    const scopeDesc = document.createElement('p');
    scopeDesc.className = 'gd-disclosure-desc';
    scopeDesc.textContent =
      'Guardrail UI enforces protection exclusively on supported pilot workflows. Protection does NOT monitor arbitrary websites or background operating system actions.';

    const scopeList = document.createElement('ul');
    scopeList.className = 'gd-scope-list';

    const li1 = document.createElement('li');
    li1.innerHTML = '<strong>Protected Actions:</strong> Irreversible destructive actions, checkout/payment triggers, cross-domain navigation, and authentication boundary forms.';
    const li2 = document.createElement('li');
    li2.innerHTML = '<strong>Not Protected:</strong> Uninstrumented websites, background OS software, and direct file system downloads.';

    scopeList.appendChild(li1);
    scopeList.appendChild(li2);
    scopeBox.appendChild(scopeTitle);
    scopeBox.appendChild(scopeDesc);
    scopeBox.appendChild(scopeList);
    statusBody.appendChild(scopeBox);

    cardStatus.appendChild(statusBody);
    mainGrid.appendChild(cardStatus);

    // -------------------------------------------------------------------------
    // Card 2: Supported Action Protection Categories & Invariants
    // -------------------------------------------------------------------------
    const cardPolicies = document.createElement('section');
    cardPolicies.className = 'gd-card gd-settings-card';
    cardPolicies.id = 'card-action-categories';

    const cardPolHeader = document.createElement('div');
    cardPolHeader.className = 'gd-card-header';
    const polKicker = document.createElement('div');
    polKicker.className = 'gd-section-tag-group';
    polKicker.innerHTML = `
      <span class="gd-section-number">02</span>
      <span class="gd-section-kicker">INTERCEPTION RULES</span>
    `;
    const polTitle = document.createElement('h2');
    polTitle.className = 'gd-card-title';
    polTitle.textContent = 'Action Protection Policies';
    const polDesc = document.createElement('p');
    polDesc.className = 'gd-section-desc';
    polDesc.textContent = 'Manage interception rules. Mandatory invariants remain locked.';
    cardPolHeader.appendChild(polKicker);
    cardPolHeader.appendChild(polTitle);
    cardPolHeader.appendChild(polDesc);
    cardPolicies.appendChild(cardPolHeader);

    const polBody = document.createElement('div');
    polBody.className = 'gd-card-body';

    const rulesList = document.createElement('div');
    rulesList.className = 'gd-policy-rules-list';

    for (const rule of state.draftConfig.policies) {
      const ruleRow = document.createElement('div');
      ruleRow.className = `gd-policy-rule-card ${rule.isImmutableSecurityInvariant ? 'gd-rule-locked' : ''}`;
      ruleRow.id = `policy-rule-${rule.id}`;

      const ruleTop = document.createElement('div');
      ruleTop.className = 'gd-rule-header-row';

      const ruleNameGroup = document.createElement('div');
      ruleNameGroup.className = 'gd-rule-name-group';

      const ruleName = document.createElement('h3');
      ruleName.className = 'gd-rule-title';
      ruleName.textContent = rule.name;

      if (rule.isImmutableSecurityInvariant) {
        const lockBadge = document.createElement('span');
        lockBadge.className = 'gd-badge gd-badge-lock';
        lockBadge.textContent = '🔒 Mandatory Invariant';
        lockBadge.setAttribute('title', 'This safety rule cannot be disabled or relaxed.');
        ruleNameGroup.appendChild(ruleName);
        ruleNameGroup.appendChild(lockBadge);
      } else {
        ruleNameGroup.appendChild(ruleName);
      }

      ruleTop.appendChild(ruleNameGroup);

      // Toggle / Decision Controls
      const ruleControls = document.createElement('div');
      ruleControls.className = 'gd-rule-controls';

      if (rule.isImmutableSecurityInvariant) {
        // Disabled toggle for invariant
        const lockedPill = document.createElement('span');
        lockedPill.className = 'gd-badge gd-badge-protect';
        lockedPill.textContent = 'Always PROTECT (Staged)';
        ruleControls.appendChild(lockedPill);
      } else if (rule.id === RiskPolicyId.ROUTINE_INTERACTION) {
        // Routine interaction is always ALLOW
        const allowPill = document.createElement('span');
        allowPill.className = 'gd-badge gd-badge-allow';
        allowPill.textContent = 'Always ALLOW (Silent)';
        ruleControls.appendChild(allowPill);
      } else {
        // Configurable Category (PAYMENT, EXTERNAL_NAVIGATION, AUTHENTICATION_BOUNDARY)
        // Enabled Toggle
        const toggleLabel = document.createElement('label');
        toggleLabel.className = 'gd-toggle-switch';

        const toggleInput = document.createElement('input');
        toggleInput.type = 'checkbox';
        toggleInput.checked = rule.enabled;
        toggleInput.id = `toggle-${rule.id}`;
        toggleInput.addEventListener('change', () => {
          controller.updatePolicyRule(rule.id, { enabled: toggleInput.checked });
        });

        const toggleSlider = document.createElement('span');
        toggleSlider.className = 'gd-toggle-slider';

        toggleLabel.appendChild(toggleInput);
        toggleLabel.appendChild(toggleSlider);

        // Decision Selector (WARN vs PROTECT)
        const decisionSelect = document.createElement('select');
        decisionSelect.className = 'gd-select';
        decisionSelect.id = `select-decision-${rule.id}`;
        decisionSelect.disabled = !rule.enabled;

        const optWarn = document.createElement('option');
        optWarn.value = ResponseAction.WARN;
        optWarn.textContent = 'Advisory Warning (WARN)';
        optWarn.selected = rule.decision === ResponseAction.WARN;

        const optProtect = document.createElement('option');
        optProtect.value = ResponseAction.PROTECT;
        optProtect.textContent = 'Require Approval (PROTECT)';
        optProtect.selected = rule.decision === ResponseAction.PROTECT;

        decisionSelect.appendChild(optWarn);
        decisionSelect.appendChild(optProtect);

        decisionSelect.addEventListener('change', () => {
          controller.updatePolicyRule(rule.id, { decision: decisionSelect.value as ResponseAction });
        });

        ruleControls.appendChild(toggleLabel);
        ruleControls.appendChild(decisionSelect);
      }

      ruleTop.appendChild(ruleControls);
      ruleRow.appendChild(ruleTop);

      // Explanation
      const ruleDesc = document.createElement('p');
      ruleDesc.className = 'gd-rule-explanation';
      ruleDesc.textContent = rule.userExplanation;
      ruleRow.appendChild(ruleDesc);

      // Targets
      const ruleMeta = document.createElement('div');
      ruleMeta.className = 'gd-rule-meta';
      ruleMeta.textContent = `Action Types: ${rule.actionTypes.join(', ')} | Priority: ${rule.priority}`;
      ruleRow.appendChild(ruleMeta);

      rulesList.appendChild(ruleRow);
    }

    polBody.appendChild(rulesList);
    cardPolicies.appendChild(polBody);
    mainGrid.appendChild(cardPolicies);

    // -------------------------------------------------------------------------
    // Card 3: Risk Sensitivity & Threshold Tuning
    // -------------------------------------------------------------------------
    const cardSens = document.createElement('section');
    cardSens.className = 'gd-card gd-settings-card';
    cardSens.id = 'card-risk-sensitivity';

    const cardSensHeader = document.createElement('div');
    cardSensHeader.className = 'gd-card-header';
    const sensKicker = document.createElement('div');
    sensKicker.className = 'gd-section-tag-group';
    sensKicker.innerHTML = `
      <span class="gd-section-number">03</span>
      <span class="gd-section-kicker">RISK THRESHOLDS</span>
    `;
    const sensTitle = document.createElement('h2');
    sensTitle.className = 'gd-card-title';
    sensTitle.textContent = 'Risk Sensitivity & Thresholds';
    const sensDesc = document.createElement('p');
    sensDesc.className = 'gd-section-desc';
    sensDesc.textContent = 'Score boundaries between 0 and 100 for risk evaluation.';
    cardSensHeader.appendChild(sensKicker);
    cardSensHeader.appendChild(sensTitle);
    cardSensHeader.appendChild(sensDesc);
    cardSens.appendChild(cardSensHeader);

    const sensBody = document.createElement('div');
    sensBody.className = 'gd-card-body';

    // Preset selector buttons
    const presetRow = document.createElement('div');
    presetRow.className = 'gd-preset-button-group';
    presetRow.setAttribute('role', 'group');
    presetRow.setAttribute('aria-label', 'Sensitivity Presets');

    const presets: Array<{ id: SensitivityPreset; label: string; desc: string }> = [
      { id: 'balanced', label: 'Balanced (Recommended)', desc: 'Standard thresholds (Low ≤ 24, Med ≤ 49, High ≤ 74)' },
      { id: 'strict', label: 'Strict (High Caution)', desc: 'Earlier alerts (Low ≤ 15, Med ≤ 35, High ≤ 60)' },
      { id: 'custom', label: 'Custom', desc: 'Manual numeric threshold boundaries' },
    ];

    for (const p of presets) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.id = `preset-${p.id}`;
      btn.className = `gd-preset-btn ${state.sensitivityPreset === p.id ? 'active' : ''}`;
      btn.innerHTML = `<strong>${p.label}</strong><small>${p.desc}</small>`;
      btn.addEventListener('click', () => {
        controller.setSensitivityPreset(p.id);
      });
      presetRow.appendChild(btn);
    }
    sensBody.appendChild(presetRow);

    // Visual Risk Tier Meter
    const meterBox = document.createElement('div');
    meterBox.className = 'gd-risk-meter-container';

    const meterTitle = document.createElement('div');
    meterTitle.className = 'gd-meter-title';
    meterTitle.textContent = 'Live Tier Boundaries';
    meterBox.appendChild(meterTitle);

    const meterBar = document.createElement('div');
    meterBar.className = 'gd-risk-meter-bar';

    const t = state.draftConfig.thresholds;
    const lowWidth = Math.max(5, t.lowMax);
    const medWidth = Math.max(5, t.mediumMax - t.lowMax);
    const highWidth = Math.max(5, t.highMax - t.mediumMax);
    const critWidth = Math.max(5, 100 - t.highMax);

    meterBar.innerHTML = `
      <div class="gd-bar-segment gd-seg-low" style="width: ${lowWidth}%" title="Low Risk: 0 to ${t.lowMax}">Low (0–${t.lowMax})</div>
      <div class="gd-bar-segment gd-seg-med" style="width: ${medWidth}%" title="Medium Risk: ${t.lowMax + 1} to ${t.mediumMax}">Med (${t.lowMax + 1}–${t.mediumMax})</div>
      <div class="gd-bar-segment gd-seg-high" style="width: ${highWidth}%" title="High Risk: ${t.mediumMax + 1} to ${t.highMax}">High (${t.mediumMax + 1}–${t.highMax})</div>
      <div class="gd-bar-segment gd-seg-crit" style="width: ${critWidth}%" title="Critical: ${t.highMax + 1} to 100">Critical (${t.highMax + 1}+)</div>
    `;
    meterBox.appendChild(meterBar);
    sensBody.appendChild(meterBox);

    // Numeric Inputs Grid
    const threshGrid = document.createElement('div');
    threshGrid.className = 'gd-threshold-inputs-grid';

    const addThreshInput = (
      id: string,
      label: string,
      currentVal: number,
      min: number,
      max: number,
      helperText: string,
      onChange: (val: number) => void
    ) => {
      const field = document.createElement('div');
      field.className = 'gd-field-group';

      const lbl = document.createElement('label');
      lbl.htmlFor = id;
      lbl.className = 'gd-field-label';
      lbl.textContent = label;

      const input = document.createElement('input');
      input.type = 'number';
      input.id = id;
      input.className = 'gd-input';
      input.value = String(currentVal);
      input.min = String(min);
      input.max = String(max);
      input.step = '1';

      input.addEventListener('input', () => {
        const parsed = parseInt(input.value, 10);
        if (!isNaN(parsed)) {
          onChange(parsed);
        }
      });

      const helper = document.createElement('small');
      helper.className = 'gd-field-helper';
      helper.textContent = helperText;

      field.appendChild(lbl);
      field.appendChild(input);
      field.appendChild(helper);
      threshGrid.appendChild(field);
    };

    addThreshInput(
      'input-low-max',
      'Low Risk Ceiling (lowMax)',
      t.lowMax,
      5,
      35,
      'Valid range: 5 to 35. Actions at or below this score proceed without alerts.',
      (val) => controller.updateThresholds({ lowMax: val })
    );

    addThreshInput(
      'input-medium-max',
      'Medium Risk Ceiling (mediumMax)',
      t.mediumMax,
      t.lowMax + 1,
      65,
      `Valid range: ${t.lowMax + 1} to 65. Actions in this tier trigger advisory warnings.`,
      (val) => controller.updateThresholds({ mediumMax: val })
    );

    addThreshInput(
      'input-high-max',
      'High Risk Ceiling (highMax)',
      t.highMax,
      t.mediumMax + 1,
      85,
      `Valid range: ${t.mediumMax + 1} to 85. Actions above this score require protective approval.`,
      (val) => controller.updateThresholds({ highMax: val })
    );

    sensBody.appendChild(threshGrid);
    cardSens.appendChild(sensBody);
    mainGrid.appendChild(cardSens);

    // -------------------------------------------------------------------------
    // Card 4: Staging Mode & Operational Timeouts
    // -------------------------------------------------------------------------
    const cardStaging = document.createElement('section');
    cardStaging.className = 'gd-card gd-settings-card';
    cardStaging.id = 'card-staging-mode';

    const cardStgHeader = document.createElement('div');
    cardStgHeader.className = 'gd-card-header';
    const stgKicker = document.createElement('div');
    stgKicker.className = 'gd-section-tag-group';
    stgKicker.innerHTML = `
      <span class="gd-section-number">04</span>
      <span class="gd-section-kicker">STAGING & TIMEOUTS</span>
    `;
    const stgTitle = document.createElement('h2');
    stgTitle.className = 'gd-card-title';
    stgTitle.textContent = 'Staging Mode & Timeouts';
    const stgDesc = document.createElement('p');
    stgDesc.className = 'gd-section-desc';
    stgDesc.textContent = 'Execution freeze windows and approval validity periods.';
    cardStgHeader.appendChild(stgKicker);
    cardStgHeader.appendChild(stgTitle);
    cardStgHeader.appendChild(stgDesc);
    cardStaging.appendChild(cardStgHeader);

    const stgBody = document.createElement('div');
    stgBody.className = 'gd-card-body';

    const stgNotice = document.createElement('div');
    stgNotice.className = 'gd-settings-notice-box';
    stgNotice.innerHTML = `
      <strong>🔒 Staging Mode Invariant:</strong>
      Destructive browser actions enter staging mode and freeze execution until your trusted contact confirms approval.
    `;
    stgBody.appendChild(stgNotice);

    const timeoutsGrid = document.createElement('div');
    timeoutsGrid.className = 'gd-threshold-inputs-grid';

    const ttlSeconds = state.draftConfig.timeouts.approvalTtlSeconds;
    const ttlMinutes = Math.round(ttlSeconds / 60);

    const ttlGroup = document.createElement('div');
    ttlGroup.className = 'gd-field-group';
    const ttlLabel = document.createElement('label');
    ttlLabel.htmlFor = 'input-approval-ttl';
    ttlLabel.className = 'gd-field-label';
    ttlLabel.textContent = `Approval Request Expiration TTL: ${ttlMinutes}m (${ttlSeconds}s)`;

    const ttlRange = document.createElement('input');
    ttlRange.type = 'range';
    ttlRange.id = 'input-approval-ttl';
    ttlRange.className = 'gd-range-slider';
    ttlRange.min = '60';
    ttlRange.max = '86400';
    ttlRange.step = '60';
    ttlRange.value = String(ttlSeconds);
    ttlRange.addEventListener('input', () => {
      const v = parseInt(ttlRange.value, 10);
      controller.updateOperationalTimeouts({ approvalTtlSeconds: v });
    });

    const ttlHelper = document.createElement('small');
    ttlHelper.className = 'gd-field-helper';
    ttlHelper.textContent = 'Staged actions expire if undecided within this window (1 min to 24 hours).';

    ttlGroup.appendChild(ttlLabel);
    ttlGroup.appendChild(ttlRange);
    ttlGroup.appendChild(ttlHelper);
    timeoutsGrid.appendChild(ttlGroup);

    stgBody.appendChild(timeoutsGrid);
    cardStaging.appendChild(stgBody);
    mainGrid.appendChild(cardStaging);

    // -------------------------------------------------------------------------
    // Card 5: Trusted-Contact Relationship & Notification Scope
    // -------------------------------------------------------------------------
    const cardContacts = document.createElement('section');
    cardContacts.className = 'gd-card gd-settings-card';
    cardContacts.id = 'card-trusted-contacts';

    const cardCtHeader = document.createElement('div');
    cardCtHeader.className = 'gd-card-header';
    const ctKicker = document.createElement('div');
    ctKicker.className = 'gd-section-tag-group';
    ctKicker.innerHTML = `
      <span class="gd-section-number">05</span>
      <span class="gd-section-kicker">GUARDIAN CONTACTS</span>
    `;
    const ctTitle = document.createElement('h2');
    ctTitle.className = 'gd-card-title';
    ctTitle.textContent = 'Trusted Contact Relationship';
    const ctDesc = document.createElement('p');
    ctDesc.className = 'gd-section-desc';
    ctDesc.textContent = 'Configured contacts receiving out-of-band decision requests.';
    cardCtHeader.appendChild(ctKicker);
    cardCtHeader.appendChild(ctTitle);
    cardCtHeader.appendChild(ctDesc);
    cardContacts.appendChild(cardCtHeader);

    const ctBody = document.createElement('div');
    ctBody.className = 'gd-card-body';

    const coverage = state.trustedContactCoverage;
    const covStatusRow = document.createElement('div');
    covStatusRow.className = 'gd-coverage-status-row';

    const covBadge = document.createElement('span');
    covBadge.className = `gd-badge ${coverage.hasActiveContact ? 'gd-badge-active' : 'gd-badge-danger'}`;
    covBadge.id = 'trusted-contact-coverage-badge';
    covBadge.textContent = coverage.hasActiveContact
      ? `Active Coverage: ${coverage.activeContacts.length} Contact(s) Linked`
      : 'Coverage Warning: No Active Trusted Contact Linked';

    covStatusRow.appendChild(covBadge);
    ctBody.appendChild(covStatusRow);

    if (!coverage.hasActiveContact) {
      const unlinkedWarn = document.createElement('p');
      unlinkedWarn.className = 'gd-text-warn gd-mt-8';
      unlinkedWarn.textContent =
        'Notice: High-risk browser actions requiring approval cannot proceed until a trusted contact is linked. You may still view the test page and receive advisory warnings.';
      ctBody.appendChild(unlinkedWarn);
    } else {
      const contactsList = document.createElement('ul');
      contactsList.className = 'gd-contact-card-list';
      for (const c of coverage.activeContacts) {
        const cLi = document.createElement('li');
        cLi.className = 'gd-contact-pill';
        cLi.textContent = `👤 ${c.id} (${c.relationshipLabel ?? 'Trusted Contact'})`;
        contactsList.appendChild(cLi);
      }
      ctBody.appendChild(contactsList);
    }

    // Truthful notification preferences
    const notifBox = document.createElement('div');
    notifBox.className = 'gd-scope-disclosure-box gd-mt-12';

    const notifTitle = document.createElement('h3');
    notifTitle.className = 'gd-disclosure-title';
    notifTitle.textContent = 'Trusted Contact Notification Architecture';

    const notifDesc = document.createElement('p');
    notifDesc.className = 'gd-disclosure-desc';
    notifDesc.textContent =
      'Security Requirement: Automated external SMS or email webhook notifications are NOT part of the current pilot release. Pending requests are synchronized out-of-band via trusted-contact dashboard polling.';

    const pollIntervalSec = Math.round(state.draftConfig.timeouts.dashboardPollIntervalMs / 1000);
    const pollNotice = document.createElement('p');
    pollNotice.className = 'gd-field-helper';
    pollNotice.textContent = `Active Portal Polling Cadence: ${pollIntervalSec}s (configurable between 1s and 60s).`;

    notifBox.appendChild(notifTitle);
    notifBox.appendChild(notifDesc);
    notifBox.appendChild(pollNotice);
    ctBody.appendChild(notifBox);

    cardContacts.appendChild(ctBody);
    mainGrid.appendChild(cardContacts);

    // -------------------------------------------------------------------------
    // Card 6: Trusted Domains Allowlist
    // -------------------------------------------------------------------------
    const cardDomains = document.createElement('section');
    cardDomains.className = 'gd-card gd-settings-card';
    cardDomains.id = 'card-trusted-domains';

    const cardDomHeader = document.createElement('div');
    cardDomHeader.className = 'gd-card-header';
    const domKicker = document.createElement('div');
    domKicker.className = 'gd-section-tag-group';
    domKicker.innerHTML = `
      <span class="gd-section-number">06</span>
      <span class="gd-section-kicker">DOMAIN ALLOWLIST</span>
    `;
    const domTitle = document.createElement('h2');
    domTitle.className = 'gd-card-title';
    domTitle.textContent = 'Trusted Domains Allowlist';
    const domDesc = document.createElement('p');
    domDesc.className = 'gd-section-desc';
    domDesc.textContent = 'Internal hosts exempted from external navigation warnings.';
    cardDomHeader.appendChild(domKicker);
    cardDomHeader.appendChild(domTitle);
    cardDomHeader.appendChild(domDesc);
    cardDomains.appendChild(cardDomHeader);

    const domBody = document.createElement('div');
    domBody.className = 'gd-card-body';

    const addDomainRow = document.createElement('div');
    addDomainRow.className = 'gd-inline-form-row';

    const domainInput = document.createElement('input');
    domainInput.type = 'text';
    domainInput.id = 'input-new-domain';
    domainInput.className = 'gd-input';
    domainInput.placeholder = 'e.g. portal.company.com';

    const btnAddDomain = document.createElement('button');
    btnAddDomain.type = 'button';
    btnAddDomain.className = 'gd-btn gd-btn-secondary';
    btnAddDomain.id = 'btn-add-domain';
    btnAddDomain.textContent = 'Add Domain';

    const domainErr = document.createElement('small');
    domainErr.className = 'gd-field-error';
    domainErr.id = 'domain-error-msg';

    btnAddDomain.addEventListener('click', () => {
      domainErr.textContent = '';
      const res = controller.addTrustedDomain(domainInput.value);
      if (res.success) {
        domainInput.value = '';
      } else {
        domainErr.textContent = res.error || 'Failed to add domain.';
      }
    });

    addDomainRow.appendChild(domainInput);
    addDomainRow.appendChild(btnAddDomain);
    domBody.appendChild(addDomainRow);
    domBody.appendChild(domainErr);

    // Domain Tags List
    const domainList = document.createElement('div');
    domainList.className = 'gd-domain-tags-list';

    if (state.draftConfig.trustedDomains.length === 0) {
      const emptyDomains = document.createElement('span');
      emptyDomains.className = 'gd-text-muted';
      emptyDomains.textContent = 'No external domains added. Localhost is always trusted.';
      domainList.appendChild(emptyDomains);
    } else {
      for (const d of state.draftConfig.trustedDomains) {
        const tag = document.createElement('span');
        tag.className = 'gd-domain-tag';
        tag.textContent = d;

        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'gd-tag-remove-btn';
        removeBtn.setAttribute('aria-label', `Remove ${d}`);
        removeBtn.textContent = '×';
        removeBtn.addEventListener('click', () => {
          controller.removeTrustedDomain(d);
        });

        tag.appendChild(removeBtn);
        domainList.appendChild(tag);
      }
    }

    domBody.appendChild(domainList);
    cardDomains.appendChild(domBody);
    mainGrid.appendChild(cardDomains);

    // -------------------------------------------------------------------------
    // Card 7: Programmatic Policy Specifications & Explanations
    // -------------------------------------------------------------------------
    const cardSpecs = document.createElement('section');
    cardSpecs.className = 'gd-card gd-settings-card';
    cardSpecs.id = 'card-policy-specifications';

    const cardSpecHeader = document.createElement('div');
    cardSpecHeader.className = 'gd-card-header';
    const specKicker = document.createElement('div');
    specKicker.className = 'gd-section-tag-group';
    specKicker.innerHTML = `
      <span class="gd-section-number">07</span>
      <span class="gd-section-kicker">POLICY SPECIFICATIONS</span>
    `;
    const specTitle = document.createElement('h2');
    specTitle.className = 'gd-card-title';
    specTitle.textContent = 'Policy Specifications';
    const specDesc = document.createElement('p');
    specDesc.className = 'gd-section-desc';
    specDesc.textContent = 'Canonical schema parameters and security implications.';
    cardSpecHeader.appendChild(specKicker);
    cardSpecHeader.appendChild(specTitle);
    cardSpecHeader.appendChild(specDesc);
    cardSpecs.appendChild(cardSpecHeader);

    const specBody = document.createElement('div');
    specBody.className = 'gd-card-body';

    const specIntro = document.createElement('p');
    specIntro.className = 'gd-card-intro';
    specIntro.textContent =
      'Reference details and security implications for all policy configuration settings:';
    specBody.appendChild(specIntro);

    const specDetailsList = document.createElement('div');
    specDetailsList.className = 'gd-spec-list';

    for (const spec of POLICY_SETTINGS_SPECIFICATIONS) {
      const specItem = document.createElement('details');
      specItem.className = 'gd-spec-detail-item';

      const summary = document.createElement('summary');
      summary.className = 'gd-spec-summary';
      summary.innerHTML = `<strong>${spec.title}</strong> <span class="gd-mono gd-spec-key">(${spec.key})</span> ${
        spec.isImmutableInvariant ? '<span class="gd-badge-lock">🔒 Immutable Invariant</span>' : ''
      }`;

      const content = document.createElement('div');
      content.className = 'gd-spec-content';
      content.innerHTML = `
        <p><strong>Description:</strong> ${spec.description}</p>
        <p><strong>Security Implication:</strong> ${spec.securityImplication}</p>
        <p class="gd-mono gd-text-muted">Type: ${spec.valueType} | Default: ${JSON.stringify(spec.defaultValue)}</p>
      `;

      specItem.appendChild(summary);
      specItem.appendChild(content);
      specDetailsList.appendChild(specItem);
    }

    specBody.appendChild(specDetailsList);
    cardSpecs.appendChild(specBody);
    mainGrid.appendChild(cardSpecs);

    container.appendChild(mainGrid);
  }

  controller.subscribe(() => {
    render();
  });

  render();
  return container;
}
