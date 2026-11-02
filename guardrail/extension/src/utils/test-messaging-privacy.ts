import { ActionType, GuardrailAction } from '../types/actions.js';
import { dispatchActionToBackground } from './messaging.js';

let captured: any;
(globalThis as any).chrome = {
  runtime: {
    id: 'synthetic-extension-id',
    sendMessage: async (message: unknown) => {
      captured = message;
      return { success: true };
    },
  },
};

const action: GuardrailAction = {
  id: 'act_privacy_test',
  type: ActionType.CLICK,
  timestamp: '2026-11-02T00:00:00.000Z',
  page: { url: 'https://example.test/transfer?token=synthetic-secret#step', title: 'Synthetic private title' },
  element: { tagName: 'BUTTON', visibleText: 'Synthetic password=not-a-real-secret' },
};

await dispatchActionToBackground(action);

const serialized = JSON.stringify(captured);
if (serialized.includes('not-a-real-secret') || serialized.includes('synthetic-secret') || serialized.includes('Synthetic private title')) {
  throw new Error('Sensitive-looking DOM text or URL data crossed the content-to-background boundary.');
}
if (!serialized.includes('https://example.test/transfer')) {
  throw new Error('Sanitized page origin/path context was not preserved.');
}

console.log('Content-to-background diagnostics omit DOM text, page title, and URL query/hash data.');
