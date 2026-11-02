/**
 * Guardrail UI - Controlled Chrome Browser Runner
 *
 * Minimal, zero-dependency browser automation harness for testing the Guardrail Manifest V3
 * Chrome extension in real headless Chromium / Google Chrome via Chrome DevTools Protocol (CDP).
 *
 * ARCHITECTURAL PRINCIPLES:
 * 1. ZERO EXTERNAL AUTOMATION FRAMEWORK DEPENDENCIES:
 *    - Uses native Node.js child_process, fetch, and WebSocket (supported in Node 22+).
 *    - Does not require Playwright/Puppeteer/Selenium downloads or version locks.
 * 2. REAL EXTENSION EXECUTION:
 *    - Loads the unpacked extension directly from `guardrail/extension/dist`.
 *    - Exercises real Chrome content script injection, background service workers, and DOM events.
 * 3. STRICT ISOLATION & RESOURCE CLEANUP:
 *    - Runs with an isolated temporary user-data-dir in /tmp.
 *    - Always terminates child processes and cleans up temporary folders upon test completion.
 */

import { spawn, ChildProcess } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface ChromeRunnerOptions {
  headless?: boolean;
  port?: number;
  extensionDistDir?: string;
  userDataDir?: string;
}

export interface CdpTarget {
  id: string;
  type: string;
  title: string;
  url: string;
  webSocketDebuggerUrl?: string;
}

export interface ChromePage {
  navigate: (url: string) => Promise<void>;
  evaluate: <T = any>(expression: string | (() => any)) => Promise<T>;
  click: (selector: string) => Promise<void>;
  clickInShadow: (hostSelector: string, innerSelector: string) => Promise<void>;
  typeText: (selector: string, text: string) => Promise<void>;
  getText: (selector: string) => Promise<string | null>;
  getTextInShadow: (hostSelector: string, innerSelector: string) => Promise<string | null>;
  getAttribute: (selector: string, attr: string) => Promise<string | null>;
  waitForCondition: (fnExpression: string, timeoutMs?: number) => Promise<void>;
  close: () => Promise<void>;
}

export interface RunningChromeSession {
  process: ChildProcess;
  port: number;
  userDataDir: string;
  getPage: () => Promise<ChromePage>;
  getTargets: () => Promise<CdpTarget[]>;
  close: () => Promise<void>;
}

export function findExtensionDistDir(): string {
  // Try candidate paths
  const candidates = [
    path.resolve(process.cwd(), 'dist'),
    path.resolve(process.cwd(), 'guardrail/extension/dist'),
    path.resolve(__dirname, '..'),
    path.resolve(__dirname, '../..'),
    path.resolve(__dirname, '../../dist'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(path.join(c, 'manifest.json'))) {
      return c;
    }
  }
  return path.resolve(process.cwd(), 'guardrail/extension/dist');
}

/**
 * Finds the local Google Chrome or Chromium executable.
 */
export function findChromeBinary(): string {
  if (process.env.CHROME_BIN && fs.existsSync(process.env.CHROME_BIN)) {
    return process.env.CHROME_BIN;
  }

  const macPath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  if (fs.existsSync(macPath)) {
    return macPath;
  }

  const linuxPaths = [
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ];
  for (const p of linuxPaths) {
    if (fs.existsSync(p)) return p;
  }

  throw new Error(
    '[ChromeRunner] Could not find Google Chrome or Chromium executable. Set CHROME_BIN environment variable.'
  );
}

/**
 * Launches a real headless Chrome session with the Guardrail extension loaded.
 */
export async function launchControlledChrome(
  options?: ChromeRunnerOptions
): Promise<RunningChromeSession> {
  const chromeBinary = findChromeBinary();
  const port = options?.port || 9222 + Math.floor(Math.random() * 500);
  const extensionDist = options?.extensionDistDir || findExtensionDistDir();

  console.log(`[ChromeRunner] Using extension dist directory: ${extensionDist}`);
  console.log(`[ChromeRunner] manifest.json exists: ${fs.existsSync(path.join(extensionDist, 'manifest.json'))}`);

  const userDataDir =
    options?.userDataDir ||
    path.join(os.tmpdir(), `guardrail-chrome-profile-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  fs.mkdirSync(userDataDir, { recursive: true });

  const chromeArgs = [
    '--headless=new',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    `--disable-extensions-except=${extensionDist}`,
    `--load-extension=${extensionDist}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-default-apps',
    '--disable-popup-blocking',
    '--disable-background-networking',
    '--disable-sync',
    '--mute-audio',
    'about:blank',
  ];

  const proc = spawn(chromeBinary, chromeArgs, { stdio: 'ignore' });

  // Wait for CDP endpoint to become ready
  const maxAttempts = 30;
  let ready = false;
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (res.ok) {
        ready = true;
        break;
      }
    } catch {
      await new Promise((r) => setTimeout(r, 200));
    }
  }

  if (!ready) {
    try {
      proc.kill();
    } catch {}
    throw new Error(`[ChromeRunner] Failed to connect to Chrome CDP on port ${port} after ${maxAttempts * 200}ms.`);
  }

  async function getTargets(): Promise<CdpTarget[]> {
    const res = await fetch(`http://127.0.0.1:${port}/json/list`);
    return (await res.json()) as CdpTarget[];
  }

  async function getPage(): Promise<ChromePage> {
    const targets = await getTargets();
    console.log('[ChromeRunner] getPage targets:', targets.map(t => ({ type: t.type, title: t.title, url: t.url, ws: t.webSocketDebuggerUrl })));
    const pageTarget = targets.find((t) => t.type === 'page');
    console.log('[ChromeRunner] selected pageTarget:', pageTarget ? { title: pageTarget.title, url: pageTarget.url, ws: pageTarget.webSocketDebuggerUrl } : 'none');
    if (!pageTarget || !pageTarget.webSocketDebuggerUrl) {
      throw new Error('[ChromeRunner] No open page target with WebSocket debugger URL found.');
    }

    const ws = new WebSocket(pageTarget.webSocketDebuggerUrl);
    await new Promise<void>((resolve, reject) => {
      ws.onopen = () => resolve();
      ws.onerror = (e) => reject(new Error('WebSocket connection error'));
    });

    let messageId = 1;
    function sendCdp(method: string, params: Record<string, any> = {}): Promise<any> {
      return new Promise((resolve, reject) => {
        const id = messageId++;
        const timeout = setTimeout(() => {
          ws.removeEventListener('message', onMsg);
          reject(new Error(`[ChromeRunner] CDP command ${method} timed out after 10000ms`));
        }, 10000);

        const onMsg = (event: MessageEvent) => {
          try {
            const data = JSON.parse(event.data);
            if (data.id === id) {
              clearTimeout(timeout);
              ws.removeEventListener('message', onMsg);
              if (data.error) {
                reject(new Error(`[CDP Error] ${data.error.message}`));
              } else {
                resolve(data.result);
              }
            }
          } catch (err) {
            // Ignore parse errors
          }
        };

        ws.addEventListener('message', onMsg);
        ws.send(JSON.stringify({ id, method, params }));
      });
    }

    // Enable required CDP domains
    await sendCdp('Page.enable');
    await sendCdp('Runtime.enable');
    await sendCdp('DOM.enable');

    async function evaluate<T = any>(expression: string | (() => any)): Promise<T> {
      const expr = typeof expression === 'function' ? `(${expression.toString()})()` : expression;
      const res = await sendCdp('Runtime.evaluate', {
        expression: expr,
        returnByValue: true,
        awaitPromise: true,
      });

      if (res?.exceptionDetails) {
        throw new Error(`[Page Evaluation Error]: ${res.exceptionDetails.text || res.exceptionDetails.exception?.description}`);
      }

      return res?.result?.value as T;
    }

    return {
      navigate: async (url: string) => {
        let loadFired = false;
        const loadListener = (event: MessageEvent) => {
          try {
            const data = JSON.parse(event.data);
            if (data.method === 'Page.loadEventFired') {
              loadFired = true;
            }
          } catch {}
        };
        ws.addEventListener('message', loadListener);

        console.log(`[ChromeRunner] Navigating to: ${url}`);
        const navRes = await sendCdp('Page.navigate', { url });
        console.log(`[ChromeRunner] Page.navigate response:`, navRes);

        const start = Date.now();
        while (Date.now() - start < 5000) {
          if (loadFired) break;
          try {
            const ready = await evaluate<string>('document.readyState');
            if (ready === 'complete') break;
          } catch {}
          await new Promise((r) => setTimeout(r, 100));
        }

        ws.removeEventListener('message', loadListener);
        // Brief settle time for DOM scripts to complete execution
        await new Promise((r) => setTimeout(r, 300));
      },
      evaluate,
      click: async (selector: string) => {
        const found = await evaluate<boolean>(`Boolean(document.querySelector(${JSON.stringify(selector)}))`);
        if (!found) {
          throw new Error(`[ChromeRunner] Click target "${selector}" not found in DOM.`);
        }
        await evaluate(`
          (() => {
            const el = document.querySelector(${JSON.stringify(selector)});
            if (el) {
              el.scrollIntoView();
              el.click();
            }
          })()
        `);
      },
      clickInShadow: async (hostSelector: string, innerSelector: string) => {
        await evaluate(`
          (() => {
            const host = document.querySelector(${JSON.stringify(hostSelector)});
            if (!host || !host.shadowRoot) {
              throw new Error("Shadow host not found or has no shadow root: " + ${JSON.stringify(hostSelector)});
            }
            const el = host.shadowRoot.querySelector(${JSON.stringify(innerSelector)});
            if (!el) {
              throw new Error("Target not found inside shadow root: " + ${JSON.stringify(innerSelector)});
            }
            el.scrollIntoView();
            el.click();
          })()
        `);
      },
      typeText: async (selector: string, text: string) => {
        await evaluate(`
          (() => {
            const el = document.querySelector(${JSON.stringify(selector)});
            if (el) {
              el.focus();
              el.value = ${JSON.stringify(text)};
              el.dispatchEvent(new Event('input', { bubbles: true }));
              el.dispatchEvent(new Event('change', { bubbles: true }));
            }
          })()
        `);
      },
      getText: async (selector: string) => {
        return evaluate<string | null>(`
          (() => {
            const el = document.querySelector(${JSON.stringify(selector)});
            return el ? el.textContent : null;
          })()
        `);
      },
      getTextInShadow: async (hostSelector: string, innerSelector: string) => {
        return evaluate<string | null>(`
          (() => {
            const host = document.querySelector(${JSON.stringify(hostSelector)});
            if (!host || !host.shadowRoot) return null;
            const el = host.shadowRoot.querySelector(${JSON.stringify(innerSelector)});
            return el ? el.textContent : null;
          })()
        `);
      },
      getAttribute: async (selector: string, attr: string) => {
        return evaluate<string | null>(`
          (() => {
            const el = document.querySelector(${JSON.stringify(selector)});
            return el ? el.getAttribute(${JSON.stringify(attr)}) : null;
          })()
        `);
      },
      waitForCondition: async (fnExpression: string, timeoutMs: number = 5000) => {
        const start = Date.now();
        while (Date.now() - start < timeoutMs) {
          const res = await evaluate<boolean>(fnExpression);
          if (res) return;
          await new Promise((r) => setTimeout(r, 100));
        }
        throw new Error(`[ChromeRunner] Condition [${fnExpression}] timed out after ${timeoutMs}ms.`);
      },
      close: async () => {
        try {
          ws.close();
        } catch {}
      },
    };
  }

  return {
    process: proc,
    port,
    userDataDir,
    getPage,
    getTargets,
    close: async () => {
      try {
        proc.kill('SIGTERM');
      } catch {}
      // Give process 200ms to exit then force kill if needed
      await new Promise((r) => setTimeout(r, 200));
      try {
        if (!proc.killed) proc.kill('SIGKILL');
      } catch {}

      // Clean up temporary profile directory
      try {
        if (fs.existsSync(userDataDir)) {
          fs.rmSync(userDataDir, { recursive: true, force: true });
        }
      } catch (err) {
        console.warn(`[ChromeRunner] Warning: Could not remove temporary dir ${userDataDir}:`, err);
      }
    },
  };
}
