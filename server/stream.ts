import type { Request, Response, Express } from 'express';

interface SSEClient {
  res: Response;
  id: string;
  ping: NodeJS.Timeout;
}

const clients = new Set<SSEClient>();
let clientIdCounter = 0;

/**
 * Broadcast an event to all connected Server-Sent Events clients.
 */
export function broadcastStreamEvent(event: string, data: unknown): void {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of [...clients]) {
    try {
      client.res.write(payload);
    } catch {
      clearInterval(client.ping);
      clients.delete(client);
    }
  }
}

/**
 * Total active streaming connections.
 */
export function streamClientCount(): number {
  return clients.size;
}

/**
 * Closes all active SSE connections cleanly. Useful during testing or graceful server teardown.
 */
export function closeAllStreamClients(): void {
  for (const client of [...clients]) {
    clearInterval(client.ping);
    try {
      client.res.end();
    } catch {
      // socket already closed
    }
  }
  clients.clear();
}

/**
 * Register Server-Sent Events streaming routes for real-time client updates.
 */
export function registerStreamRoutes(app: Express): void {
  app.get('/api/stream', (req: Request, res: Response) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    if (typeof res.flushHeaders === 'function') {
      res.flushHeaders();
    }

    let ping: NodeJS.Timeout | null = null;
    const client: SSEClient = { res, id: `client_${++clientIdCounter}`, ping: null as any };

    let cleaned = false;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      if (ping) {
        clearInterval(ping);
        ping = null;
      }
      clients.delete(client);
    };

    ping = setInterval(() => {
      try {
        res.write(': keepalive\n\n');
      } catch {
        cleanup();
      }
    }, 25_000);
    client.ping = ping;

    clients.add(client);

    res.on('error', cleanup);
    req.on('error', cleanup);
    req.on('close', cleanup);

    // Initial connection confirmation
    try {
      res.write(`event: connected\ndata: ${JSON.stringify({ time: new Date().toISOString(), clients: clients.size })}\n\n`);
    } catch {
      cleanup();
    }
  });
}
