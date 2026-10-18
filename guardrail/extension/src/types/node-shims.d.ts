/**
 * Ambient module declarations for Node.js built-ins used in verification tests.
 * Since tsconfig.json targets the browser extension with "types": ["chrome"],
 * this file provides ambient typings for node:http and node:net in test runner contexts.
 */

declare module 'node:http' {
  export interface IncomingMessage {
    readonly method?: string;
    readonly url?: string;
    readonly headers?: Record<string, string | string[] | undefined>;
    on(event: 'data', listener: (chunk: unknown) => void): this;
    on(event: 'end', listener: () => void): this;
    on(event: 'error', listener: (err: unknown) => void): this;
    destroy?(): void;
    [key: string]: unknown;
  }
  export interface ServerResponse {
    statusCode: number;
    writeHead(statusCode: number, headers?: Record<string, string>): void;
    setHeader(name: string, value: string | number | readonly string[]): void;
    end(data?: string): void;
    headersSent?: boolean;
    [key: string]: unknown;
  }
  export interface Server {
    listen(port?: number, hostname?: string, callback?: () => void): this;
    address(): { port: number } | string | null;
    close(callback?: (err?: Error) => void): this;
  }
  export function createServer(requestListener?: (req: any, res: any) => void): Server;
  const http: {
    createServer(requestListener?: (req: any, res: any) => void): Server;
  };
  export default http;
}

declare module 'node:net' {
  export interface AddressInfo {
    address: string;
    family: string;
    port: number;
  }
}
