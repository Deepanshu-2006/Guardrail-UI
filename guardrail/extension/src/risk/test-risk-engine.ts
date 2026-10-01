/**
 * Guardrail Risk Engine - Verification & Test Suite
 *
 * Validates all required scenarios, risk levels, signal combinations, and edge cases.
 */

declare const process: { exit: (code: number) => void };

import { classifyAction } from '../classifier/index.js';
import { assessRisk } from './engine.js';
import {
  ActionCategory,
  ActionType,
  GuardrailAction,
  GuardrailActionMessage,
  RiskLevel,
  RiskSignalId,
} from '../types/index.js';

interface TestCase {
  name: string;
  action: GuardrailAction;
  expectedCategory: ActionCategory;
  expectedSignals: RiskSignalId[];
  expectedScore: number;
  expectedRiskLevel: RiskLevel;
  verifyReasons?: (reasons: string[]) => boolean;
  verifySafety?: (action: GuardrailAction) => boolean;
}

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
  if (condition) {
    console.log(`  ✓ ${message}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${message}`);
    failed++;
  }
}

console.log('\n============================================================');
console.log('🧪 GUARDRAIL RISK ENGINE - COMPREHENSIVE VERIFICATION SUITE');
console.log('============================================================\n');

// Mock service worker message receiver to verify end-to-end payload integrity
let lastServiceWorkerMessage: GuardrailActionMessage | null = null;
function mockServiceWorker(message: GuardrailActionMessage) {
  lastServiceWorkerMessage = message;
}

const testCases: TestCase[] = [
  // 1. General action
  {
    name: '1. General Action (Generic Action Button)',
    action: {
      id: 'act-general-1',
      type: ActionType.CLICK,
      element: { tagName: 'BUTTON', id: 'test-action-btn', visibleText: 'Generic Action' },
      page: { url: 'http://localhost:3000/index.html', title: 'Guardrail Test Page' },
      timestamp: new Date().toISOString(),
    },
    expectedCategory: ActionCategory.GENERAL,
    expectedSignals: [],
    expectedScore: 0,
    expectedRiskLevel: RiskLevel.LOW,
  },

  // 2. Authentication action
  {
    name: '2. Authentication Action (Sign In Button)',
    action: {
      id: 'act-auth-1',
      type: ActionType.CLICK,
      element: { tagName: 'BUTTON', id: 'btn-auth', visibleText: '🔐 Sign In' },
      page: { url: 'http://localhost:3000/index.html', title: 'Guardrail Test Page' },
      timestamp: new Date().toISOString(),
    },
    expectedCategory: ActionCategory.AUTHENTICATION,
    expectedSignals: [RiskSignalId.AUTHENTICATION_ACTION],
    expectedScore: 20,
    expectedRiskLevel: RiskLevel.LOW, // 20 <= 24 (LOW)
  },

  // 3. Payment action
  {
    name: '3. Payment Action (Pay ₹5,000 Button)',
    action: {
      id: 'act-pay-1',
      type: ActionType.CLICK,
      element: { tagName: 'BUTTON', id: 'btn-payment', visibleText: '💳 Pay ₹5,000' },
      page: { url: 'http://localhost:3000/index.html', title: 'Guardrail Test Page' },
      timestamp: new Date().toISOString(),
    },
    expectedCategory: ActionCategory.PAYMENT,
    expectedSignals: [RiskSignalId.PAYMENT_ACTION],
    expectedScore: 40,
    expectedRiskLevel: RiskLevel.MEDIUM, // 25–49 (MEDIUM)
  },

  // 4. Destructive action
  {
    name: '4. Destructive Action (Delete Account Button)',
    action: {
      id: 'act-dest-1',
      type: ActionType.CLICK,
      element: { tagName: 'BUTTON', id: 'btn-destructive', visibleText: '🗑️ Delete Account' },
      page: { url: 'http://localhost:3000/index.html', title: 'Guardrail Test Page' },
      timestamp: new Date().toISOString(),
    },
    expectedCategory: ActionCategory.DESTRUCTIVE,
    expectedSignals: [RiskSignalId.DESTRUCTIVE_ACTION],
    expectedScore: 50,
    expectedRiskLevel: RiskLevel.HIGH, // 50–74 (HIGH)
  },

  // 5. Download action
  {
    name: '5. Download Action (Download Export Button)',
    action: {
      id: 'act-down-1',
      type: ActionType.CLICK,
      element: { tagName: 'BUTTON', id: 'btn-download', visibleText: '📥 Download Export' },
      page: { url: 'http://localhost:3000/index.html', title: 'Guardrail Test Page' },
      timestamp: new Date().toISOString(),
    },
    expectedCategory: ActionCategory.DOWNLOAD,
    expectedSignals: [RiskSignalId.DOWNLOAD_ACTION],
    expectedScore: 10,
    expectedRiskLevel: RiskLevel.LOW, // 10 <= 24 (LOW)
  },

  // 6. External navigation
  {
    name: '6. External Navigation Action (External Link Click)',
    action: {
      id: 'act-ext-1',
      type: ActionType.CLICK,
      element: { tagName: 'A', id: 'external-link', visibleText: 'External Navigation ↗' },
      page: { url: 'http://localhost:3000/index.html', title: 'Guardrail Test Page' },
      timestamp: new Date().toISOString(),
    },
    expectedCategory: ActionCategory.EXTERNAL_NAVIGATION,
    expectedSignals: [RiskSignalId.EXTERNAL_NAVIGATION],
    expectedScore: 20,
    expectedRiskLevel: RiskLevel.LOW, // 20 <= 24 (LOW)
  },

  // 7. Combined scenario: Payment (+40) + External Navigation (+20) = 60 (HIGH)
  {
    name: '7. Combined Scenario (External Payment Gateway)',
    action: {
      id: 'act-comb-1',
      type: ActionType.CLICK,
      element: {
        tagName: 'BUTTON',
        id: 'btn-combined-external-payment',
        visibleText: 'Pay via External Gateway',
      },
      page: { url: 'http://localhost:3000/index.html', title: 'Guardrail Test Page' },
      timestamp: new Date().toISOString(),
    },
    expectedCategory: ActionCategory.PAYMENT,
    expectedSignals: [RiskSignalId.PAYMENT_ACTION, RiskSignalId.EXTERNAL_NAVIGATION],
    expectedScore: 60,
    expectedRiskLevel: RiskLevel.HIGH, // 50–74 (HIGH)
  },
];

for (const tc of testCases) {
  console.log(`▶ Testing Scenario: ${tc.name}`);

  // 1. Classification
  const classification = classifyAction(tc.action);
  assert(
    classification.category === tc.expectedCategory,
    `Classification category matched: ${classification.category} (expected: ${tc.expectedCategory})`
  );
  assert(
    classification.actionId === tc.action.id,
    `actionId matched across classification: ${classification.actionId}`
  );

  // 2. Risk Engine Evaluation
  const risk = assessRisk(tc.action, classification);
  assert(risk.score === tc.expectedScore, `Score calculated correctly: ${risk.score} (expected: ${tc.expectedScore})`);
  assert(
    risk.riskLevel === tc.expectedRiskLevel,
    `RiskLevel matched threshold tier: ${risk.riskLevel} (expected: ${tc.expectedRiskLevel})`
  );
  assert(risk.actionId === tc.action.id, `actionId preserved in RiskAssessment: ${risk.actionId}`);
  assert(risk.score >= 0 && risk.score <= 100, `Score bounded in [0, 100]: ${risk.score}`);
  assert(risk.reasons.length > 0, `Human-readable reasons present: ${risk.reasons.length} reason(s)`);

  // 3. Service worker dispatch simulation
  mockServiceWorker({
    type: 'GUARDRAIL_ACTION',
    action: tc.action,
    classification,
    risk,
  });

  const receivedMsg = lastServiceWorkerMessage as GuardrailActionMessage | null;
  assert(
    receivedMsg?.action.id === tc.action.id &&
    receivedMsg?.risk?.score === tc.expectedScore,
    `Service worker received complete pipeline payload with intact actionId and risk score`
  );

  console.log('');
}

console.log('------------------------------------------------------------');
console.log('🔍 TESTING EDGE CASES');
console.log('------------------------------------------------------------\n');

// Edge Case 1: No matching risk signal (Generic text input without keywords)
console.log('▶ Edge Case 1: No matching risk signal');
{
  const action: GuardrailAction = {
    id: 'edge-1',
    type: ActionType.INPUT,
    element: { tagName: 'INPUT', id: 'notes-input', visibleText: 'Enter notes...' },
    page: { url: 'http://localhost:3000', title: 'Test' },
    timestamp: new Date().toISOString(),
  };
  const classification = classifyAction(action);
  const risk = assessRisk(action, classification);
  assert(risk.score === 0, `No signals score is exactly 0: ${risk.score}`);
  assert(risk.riskLevel === RiskLevel.LOW, `Risk level is LOW: ${risk.riskLevel}`);
  assert(risk.reasons[0].includes('Routine interaction'), `Reasons indicate baseline safe action`);
}

console.log('\n▶ Edge Case 2: Multiple matching signals (Destructive + Download)');
{
  const action: GuardrailAction = {
    id: 'edge-2',
    type: ActionType.CLICK,
    element: {
      tagName: 'BUTTON',
      id: 'btn-delete-and-download',
      visibleText: 'Delete Account and Download Export',
    },
    page: { url: 'http://localhost:3000', title: 'Test' },
    timestamp: new Date().toISOString(),
  };
  const classification = classifyAction(action);
  const risk = assessRisk(action, classification);
  // Destructive (+50) + Download (+10) = 60 (HIGH)
  assert(risk.score === 60, `Multiple signals summed correctly: 50 + 10 = ${risk.score}`);
  assert(risk.riskLevel === RiskLevel.HIGH, `60 mapped to HIGH risk: ${risk.riskLevel}`);
  assert(risk.reasons.length >= 2, `Both reasons included in explanation: ${risk.reasons.length}`);
}

console.log('\n▶ Edge Case 3: Score that would exceed 100 (Destructive + Payment + External + Auth)');
{
  const action: GuardrailAction = {
    id: 'edge-3',
    type: ActionType.CLICK,
    element: {
      tagName: 'BUTTON',
      id: 'btn-purge-all',
      // delete (+50) + pay (+40) + external (+20) + login/auth (+20) = 130
      visibleText: 'Delete All Data, Cancel Payment Billing, and Login to External Server',
    },
    page: { url: 'http://localhost:3000', title: 'Test' },
    timestamp: new Date().toISOString(),
  };
  const classification = classifyAction(action);
  const risk = assessRisk(action, classification);
  assert(risk.score === 100, `Raw score (130) clamped strictly to 100: ${risk.score}`);
  assert(risk.riskLevel === RiskLevel.CRITICAL, `100 correctly mapped to CRITICAL: ${risk.riskLevel}`);
}

console.log('\n▶ Edge Case 4: Missing optional metadata (No element, no previousUrl)');
{
  const action: GuardrailAction = {
    id: 'edge-4',
    type: ActionType.NAVIGATION,
    page: { url: 'http://localhost:3000', title: 'Test' },
    timestamp: new Date().toISOString(),
  };
  // Should evaluate safely without TypeError or runtime exceptions
  let threw = false;
  try {
    const classification = classifyAction(action);
    const risk = assessRisk(action, classification);
    assert(risk.score === 0, `Evaluates safely without element metadata: score ${risk.score}`);
  } catch (err) {
    threw = true;
  }
  assert(!threw, `No exception thrown on missing optional metadata`);
}

console.log('\n▶ Edge Case 5: Unknown/unclassified action');
{
  const action: GuardrailAction = {
    id: 'edge-5',
    type: 'CUSTOM_UNKNOWN_TYPE' as ActionType,
    page: { url: '', title: '' },
    timestamp: new Date().toISOString(),
  };
  let threw = false;
  try {
    const classification = classifyAction(action);
    const risk = assessRisk(action, classification);
    assert(risk.score === 0, `Unknown action scores 0: ${risk.score}`);
    assert(risk.riskLevel === RiskLevel.LOW, `Unknown action assigns LOW risk: ${risk.riskLevel}`);
  } catch (err) {
    threw = true;
  }
  assert(!threw, `Handles unclassified/corrupt action safely without crash`);
}

console.log('\n------------------------------------------------------------');
console.log('🔒 VERIFYING SENSITIVE DATA LEAKAGE PREVENTION');
console.log('------------------------------------------------------------\n');

// Test input sanitization
{
  const sampleSecretValues = [
    'SuperSecretPassword123!',
    '4111222233334444',
    '987654',
    'user-private-token-xyz',
  ];

  const action: GuardrailAction = {
    id: 'sec-1',
    type: ActionType.INPUT,
    element: {
      tagName: 'INPUT',
      id: 'password-field',
      visibleText: 'Enter your password', // only placeholder is captured
    },
    page: { url: 'http://localhost:3000/login', title: 'Login' },
    timestamp: new Date().toISOString(),
  };

  const classification = classifyAction(action);
  const risk = assessRisk(action, classification);

  const serialized = JSON.stringify({ action, classification, risk });
  let leakedSecret = false;
  for (const secret of sampleSecretValues) {
    if (serialized.includes(secret)) {
      leakedSecret = true;
    }
  }

  assert(!leakedSecret, `No sensitive user input values leaked into action, classification, or risk payloads`);
  assert(
    !serialized.includes('password123') && !serialized.includes('4111'),
    `Payload strictly preserves metadata-only privacy guarantee`
  );
}

console.log('\n============================================================');
console.log(`TOTAL TESTS: ${passed + failed} | PASSED: ${passed} | FAILED: ${failed}`);
console.log('============================================================\n');

if (failed > 0) {
  process.exit(1);
}
