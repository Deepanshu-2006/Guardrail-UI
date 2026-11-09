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
import {
  ApprovalApiRouter,
  InMemoryTokenVerifier,
  DEFAULT_ALLOWED_ORIGINS,
} from '../approval/api.js';
import {
  DevelopmentInMemoryApprovalRequestRepository,
  PERSISTENCE_METADATA,
} from '../approval/repository.js';
import { ApprovalService } from '../approval/service.js';
import {
  InMemoryActionOwnershipRegistry,
  InMemoryTrustedContactRegistry,
  TrustedContactStatus,
} from '../approval/authorization.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface RunningTestServers {
  staticServer: http.Server;
  staticPort: number;
  staticUrl: string;
  mockBackendServer: http.Server;
  mockBackendPort: number;
  mockBackendUrl: string;
  repository: DevelopmentInMemoryApprovalRequestRepository;
  tokenVerifier: InMemoryTokenVerifier;
  contactRegistry: InMemoryTrustedContactRegistry;
  actionOwnershipRegistry: InMemoryActionOwnershipRegistry;
  service: ApprovalService;
  router: ApprovalApiRouter;
  close: () => Promise<void>;
}

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.bin': 'application/octet-stream',
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

export interface ControlledTestServerOptions {
  staticPort?: number;
  mockBackendPort?: number;
  repository?: DevelopmentInMemoryApprovalRequestRepository;
  tokenVerifier?: InMemoryTokenVerifier;
  contactRegistry?: InMemoryTrustedContactRegistry;
  actionOwnershipRegistry?: InMemoryActionOwnershipRegistry;
  service?: ApprovalService;
}

/**
 * Starts the isolated local test servers for browser integration testing.
 */
export async function startControlledTestServers(options?: ControlledTestServerOptions): Promise<RunningTestServers> {
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
  const repository = options?.repository ?? new DevelopmentInMemoryApprovalRequestRepository();
  const tokenVerifier = options?.tokenVerifier ?? new InMemoryTokenVerifier();
  const contactRegistry = options?.contactRegistry ?? new InMemoryTrustedContactRegistry();
  const actionOwnershipRegistry = options?.actionOwnershipRegistry ?? new InMemoryActionOwnershipRegistry();
  const service =
    options?.service ??
    new ApprovalService({
      repository,
      contactRegistry,
      actionOwnershipRegistry,
    });

  if (!tokenVerifier.verifyToken('test-ward-token')) {
    tokenVerifier.registerToken('test-ward-token', {
      actorId: 'usr_alice',
      role: 'USER',
      isAuthenticated: true,
    });
  }
  if (!tokenVerifier.verifyToken('test-contact-token')) {
    tokenVerifier.registerToken('test-contact-token', {
      actorId: 'tc_carol',
      role: 'TRUSTED_CONTACT',
      isAuthenticated: true,
    });
  }

  // Register Carol as an active trusted contact for Alice by default
  if (!contactRegistry.isTrustedContactForUser('tc_carol', 'usr_alice')) {
    contactRegistry.addContact({
      id: 'tc_carol',
      userId: 'usr_alice',
      relationshipLabel: 'Caregiver',
      status: TrustedContactStatus.ACTIVE,
      createdAt: new Date().toISOString(),
    });
  }

  const mockBackendPort = options?.mockBackendPort || 3000;
  const approvalRouter = new ApprovalApiRouter(service, tokenVerifier, {
    rateLimiter: { checkRateLimit: () => ({ allowed: true }) },
    allowedOrigins: [
      ...DEFAULT_ALLOWED_ORIGINS,
      `http://127.0.0.1:${staticPort}`,
      `http://localhost:${staticPort}`,
      `http://127.0.0.1:${mockBackendPort}`,
      `http://localhost:${mockBackendPort}`,
    ],
  });

  const mockBackendServer = http.createServer((req, res) => {
    approvalRouter.handleHttpStream(req, res).catch((err: unknown) => {
      console.error('[MockBackendServer] Unhandled request error:', err);
      if (!res.headersSent) {
        res.statusCode = 500;
        res.setHeader('content-type', 'application/json');
        res.end(
          JSON.stringify({
            success: false,
            error: {
              code: 'INTERNAL_SERVER_ERROR',
              message: err instanceof Error ? err.message : 'Internal Server Error',
              statusCode: 500,
            },
          })
        );
      }
    });
  });

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
    repository,
    tokenVerifier,
    contactRegistry,
    actionOwnershipRegistry,
    service,
    router: approvalRouter,
    close: async () => {
      await Promise.all([
        new Promise<void>((res) => staticServer.close(() => res())),
        new Promise<void>((res) => mockBackendServer.close(() => res())),
      ]);
    },
  };
}
