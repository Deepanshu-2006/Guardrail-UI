/**
 * Guardrail Risk Signals Catalog
 *
 * Defines the initial concrete risk signals evaluated by the Guardrail system.
 * Keeps signal definitions, baseline score contributions, and human-readable reasons
 * decoupled from the Risk Engine evaluation logic.
 *
 * PRIVACY GUARANTEE:
 * Signal definitions and their generated reasons describe structural and contextual
 * characteristics only. They never store or inspect user input values, passwords,
 * card numbers, OTPs, or form payloads.
 */

import { RiskSignalDefinition, RiskSignalId } from '../types/risk.js';

/**
 * Baseline default definitions for all initial Guardrail risk signals.
 *
 * Score contributions are calibrated on a 0–100 risk scale:
 * - DESTRUCTIVE_ACTION: 75 (High to Critical potential impact)
 * - PAYMENT_ACTION: 60 (High potential financial impact)
 * - AUTHENTICATION_ACTION: 50 (Moderate-to-High access/identity boundary)
 * - DOWNLOAD_ACTION: 30 (Moderate asset/executable transfer)
 * - EXTERNAL_NAVIGATION: 25 (Low-to-Moderate third-party domain egress)
 */
export const INITIAL_RISK_SIGNALS: Readonly<Record<RiskSignalId, RiskSignalDefinition>> = Object.freeze({
  [RiskSignalId.PAYMENT_ACTION]: {
    id: RiskSignalId.PAYMENT_ACTION,
    name: 'Payment Action',
    scoreContribution: 60,
    reason: 'Action interacts with financial transactions, checkout flows, or billing elements.',
    description: 'Triggered when an interaction targets payment buttons, checkout forms, or financial workflows.',
  },

  [RiskSignalId.DESTRUCTIVE_ACTION]: {
    id: RiskSignalId.DESTRUCTIVE_ACTION,
    name: 'Destructive Action',
    scoreContribution: 75,
    reason: 'Action initiates permanent resource deletion, cancellation, or irreversible state destruction.',
    description: 'Triggered when an interaction targets deletion controls, account termination, or destructive purge buttons.',
  },

  [RiskSignalId.AUTHENTICATION_ACTION]: {
    id: RiskSignalId.AUTHENTICATION_ACTION,
    name: 'Authentication Action',
    scoreContribution: 50,
    reason: 'Action interacts with authentication boundaries, credential inputs, or login sessions.',
    description: 'Triggered when an interaction targets sign-in, login, password, or security token controls.',
  },

  [RiskSignalId.DOWNLOAD_ACTION]: {
    id: RiskSignalId.DOWNLOAD_ACTION,
    name: 'Download Action',
    scoreContribution: 30,
    reason: 'Action triggers a file download, software installation, or document export.',
    description: 'Triggered when an interaction initiates downloading files, binary assets, or data exports to disk.',
  },

  [RiskSignalId.EXTERNAL_NAVIGATION]: {
    id: RiskSignalId.EXTERNAL_NAVIGATION,
    name: 'External Navigation',
    scoreContribution: 25,
    reason: 'Action navigates away from the current trusted domain to an external destination.',
    description: 'Triggered when a link or form submission redirects to an untrusted or third-party origin.',
  },
});

/**
 * Optional custom configuration overrides for risk signals.
 * Allows organizations or policy engines to adjust baseline score contributions and explanations.
 */
export type RiskSignalOverrides = Partial<
  Record<
    RiskSignalId,
    {
      scoreContribution?: number;
      reason?: string;
    }
  >
>;

/**
 * Retrieves a risk signal definition, optionally applying custom score or reason overrides.
 *
 * @param id The stable identifier of the risk signal.
 * @param overrides Optional environment/policy score overrides.
 * @returns The resolved RiskSignalDefinition.
 */
export function getRiskSignalDefinition(
  id: RiskSignalId,
  overrides?: RiskSignalOverrides
): RiskSignalDefinition {
  const base = INITIAL_RISK_SIGNALS[id];
  const override = overrides?.[id];

  if (!override) {
    return base;
  }

  return {
    ...base,
    scoreContribution:
      typeof override.scoreContribution === 'number'
        ? override.scoreContribution
        : base.scoreContribution,
    reason: override.reason || base.reason,
  };
}

/**
 * Returns all active risk signal definitions as an array.
 *
 * @param overrides Optional environment/policy score overrides.
 */
export function getAllRiskSignalDefinitions(
  overrides?: RiskSignalOverrides
): RiskSignalDefinition[] {
  return (Object.keys(INITIAL_RISK_SIGNALS) as RiskSignalId[]).map((id) =>
    getRiskSignalDefinition(id, overrides)
  );
}
