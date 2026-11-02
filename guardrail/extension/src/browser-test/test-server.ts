/**
 * Guardrail UI - Controlled Browser Test Local Server
 *
 * Lightweight, zero-dependency local HTTP server infrastructure for real-browser testing.
 * Serves:
 * 1. Demo test page (guardrail/demo-sites/test-page/)
 * 2. Extension dist artifacts (guardrail/extension/dist/)
 * 3. Mock Approval Backend on http://127.0.0.1:3000 (IN-MEMORY DEVELOPMENT ONLY)
 */

import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { ApprovalApiRouter, InMemoryTokenVerifier } from '../approval/api.js';
import {
  DevelopmentInMemoryApprovalRequestRepository,
  PERSISTENCE_METADATA,
} from '../approval/repository.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface RunningTestServers {
  staticServer: http.Server;
  staticPort: number;
  staticUrl: string;
  mockBackendServer: http.Server;
  mockBackendPort: number;
  mockBackendUrl: string;
  close: () => Promise<void>;
}

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

export function findTestPageDir(): string {
  const candidates = [
    path.resolve(process.cwd(), '../demo-sites/test-page'),
    path.resolve(process.cwd(), 'demo-sites/test-page'),
    path.resolve(process.cwd(), 'guardrail/demo-sites/test-page'),
    path.resolve(__dirname, '../../../../demo-sites/test-page'),
    path.resolve(__dirname, '../../../demo-sites/test-page'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(path.join(c, 'index.html'))) {
      return c;
    }
  }
  return path.resolve(process.cwd(), '../demo-sites/test-page');
}

export function findExtensionDistDir(): string {
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
 * Starts the isolated local test servers for browser integration testing.
 */
export async function startControlledTestServers(options?: {
  staticPort?: number;
  mockBackendPort?: number;
}): Promise<RunningTestServers> {
  const testPageDir = findTestPageDir();
  const extensionDistDir = findExtensionDistDir();

  // 1. Static File Server for Test Page and Dist Assets
  const staticServer = http.createServer((req, res) => {
    console.log(`[TestServer] Incoming request: ${req.method} ${req.url}`);
    try {
      const parsedUrl = new URL(req.url || '/', 'http://127.0.0.1');
      let pathname = decodeURIComponent(parsedUrl.pathname);

      if (pathname === '/' || pathname === '/test-page' || pathname === '/test-page/') {
        pathname = '/index.html';
      }

      let filePath = '';
      if (pathname.startsWith('/extension/dist/')) {
        filePath = path.join(extensionDistDir, pathname.replace('/extension/dist/', ''));
      } else {
        filePath = path.join(testPageDir, pathname.replace(/^\/test-page\//, '/'));
      }

      console.log(`[TestServer] Serving file path: ${filePath} (exists: ${fs.existsSync(filePath)})`);
      if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
        const ext = path.extname(filePath).toLowerCase();
        const contentType = MIME_TYPES[ext] || 'application/octet-stream';
        res.writeHead(200, {
          'Content-Type': contentType,
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'no-store',
        });
        fs.createReadStream(filePath).pipe(res);
      } else {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end(`File not found: ${pathname}`);
      }
    } catch (err: any) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end(`Server Error: ${err?.message || 'unknown'}`);
    }
  });

  const staticPort = options?.staticPort || 8888;
  await new Promise<void>((resolve, reject) => {
    staticServer.listen(staticPort, '127.0.0.1', () => resolve());
    staticServer.on('error', reject);
  });

  // 2. Mock Approval Backend Server on port 3000 (IN-MEMORY DEVELOPMENT ONLY)
  const repository = new DevelopmentInMemoryApprovalRequestRepository();
  const tokenVerifier = new InMemoryTokenVerifier();
  tokenVerifier.registerToken('test-ward-token', {
    subject: 'usr_alice',
    wardId: 'usr_alice',
    roles: ['ward'],
  });
  tokenVerifier.registerToken('test-contact-token', {
    subject: 'usr_carol',
    wardId: 'usr_alice',
    roles: ['trusted_contact'],
  });

  const approvalRouter = new ApprovalApiRouter({
    repository,
    tokenVerifier,
    rateLimiter: { isRateLimited: () => false },
  });

  const mockBackendServer = http.createServer((req, res) => {
    const parsedUrl = new URL(req.url || '/', 'http://127.0.0.1');
    const pathName = parsedUrl.pathname;
    const method = req.method || 'GET';

    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', async () => {
      let parsedBody: any;
      try {
        if (body.trim()) parsedBody = JSON.parse(body);
      } catch {
        // Leave undefined
      }

      const headers: Record<string, string> = {};
      for (const [k, v] of Object.entries(req.headers)) {
        if (typeof v === 'string') headers[k] = v;
      }

      const response = await approvalRouter.handleRequest({
        method: method as any,
        path: pathName,
        headers,
        body: parsedBody,
        queryParams: Object.fromEntries(parsedUrl.searchParams.entries()),
      });

      res.writeHead(response.status, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      });
      res.end(JSON.stringify(response.body));
    });
  });

  const mockBackendPort = options?.mockBackendPort || 3000;
  await new Promise<void>((resolve, reject) => {
    mockBackendServer.listen(mockBackendPort, '127.0.0.1', () => resolve());
    mockBackendServer.on('error', reject);
  });

  console.log(`[Controlled Test Server] Static server listening at: http://127.0.0.1:${staticPort}`);
  console.log(`[Controlled Test Server] Mock approval backend listening at: http://127.0.0.1:${mockBackendPort}`);
  console.log(`[Controlled Test Server] Persistence type: ${PERSISTENCE_METADATA.STORAGE_TYPE} (isProduction: ${PERSISTENCE_METADATA.IS_PRODUCTION})`);

  return {
    staticServer,
    staticPort,
    staticUrl: `http://127.0.0.1:${staticPort}`,
    mockBackendServer,
    mockBackendPort,
    mockBackendUrl: `http://127.0.0.1:${mockBackendPort}`,
    close: async () => {
      await Promise.all([
        new Promise<void>((res) => staticServer.close(() => res())),
        new Promise<void>((res) => mockBackendServer.close(() => res())),
      ]);
    },
  };
}
