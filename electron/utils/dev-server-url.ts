/**
 * Resolve the real Vite dev server URL before loading the renderer.
 * VITE_DEV_SERVER_URL can be wrong (e.g. still :5173 while Vite took :5174), or
 * the server may not be accepting connections yet — probing loopback avoids a blank window.
 */
import { createConnection } from 'node:net';
import { logger } from './logger';

const LOOPBACK = '127.0.0.1';
const DEV_PORT_MIN = 5173;
const DEV_PORT_MAX = 5185;

function probePortOpen(port: number, host = LOOPBACK, timeoutMs = 400): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ port, host }, () => {
      socket.destroy();
      resolve(true);
    });
    socket.setTimeout(timeoutMs);
    socket.once('error', () => resolve(false));
    socket.once('timeout', () => {
      try {
        socket.destroy();
      } catch {
        // ignore
      }
      resolve(false);
    });
  });
}

/**
 * Wait until a Vite dev server is accepting TCP on loopback, preferring the port from
 * configuredUrl when it matches the usual Vite range.
 */
export async function waitForViteDevServer(configuredUrl: string, options?: {
  maxWaitMs?: number;
  pollIntervalMs?: number;
}): Promise<string> {
  const maxWaitMs = options?.maxWaitMs ?? 60_000;
  const pollIntervalMs = options?.pollIntervalMs ?? 200;

  let preferredPort: number | undefined;
  try {
    const u = new URL(configuredUrl);
    if (u.hostname === 'localhost' || u.hostname === '127.0.0.1') {
      preferredPort = u.port ? parseInt(u.port, 10) : (u.protocol === 'https:' ? 443 : 80);
    }
  } catch {
    // ignore
  }

  const orderedPorts = (): number[] => {
    const set = new Set<number>();
    if (
      preferredPort !== undefined &&
      preferredPort >= DEV_PORT_MIN &&
      preferredPort <= DEV_PORT_MAX
    ) {
      set.add(preferredPort);
    }
    for (let p = DEV_PORT_MIN; p <= DEV_PORT_MAX; p++) {
      set.add(p);
    }
    return Array.from(set).sort((a, b) => {
      if (preferredPort !== undefined && a === preferredPort) return -1;
      if (preferredPort !== undefined && b === preferredPort) return 1;
      return a - b;
    });
  };

  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    for (const port of orderedPorts()) {
      if (await probePortOpen(port)) {
        const resolved = `http://${LOOPBACK}:${port}/`;
        if (resolved.replace(/\/$/, '') !== configuredUrl.replace(/\/$/, '')) {
          logger.warn(
            `Vite dev URL adjusted: env was ${configuredUrl}, loading ${resolved} (loopback port probe)`,
          );
        }
        return resolved;
      }
    }
    await new Promise((r) => setTimeout(r, pollIntervalMs));
  }

  logger.warn(`Vite dev server not detected on ${DEV_PORT_MIN}-${DEV_PORT_MAX} within ${maxWaitMs}ms; using configured URL ${configuredUrl}`);
  return configuredUrl;
}
