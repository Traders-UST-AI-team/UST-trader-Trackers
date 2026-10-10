import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createServer } from 'node:http';
import { broadcastStreamEvent, registerStreamRoutes, streamClientCount, closeAllStreamClients } from './stream.ts';

test('stream: provides SSE endpoint with connected greeting, broadcasts events and cleans up on close', async () => {
  const app = express();
  registerStreamRoutes(app);

  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const port = (server.address() as any).port;

  const controller = new AbortController();
  const res = await fetch(`http://127.0.0.1:${port}/api/stream`, {
    signal: controller.signal,
  });

  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'text/event-stream');
  assert.equal(streamClientCount(), 1);

  const reader = res.body!.getReader();
  const decoder = new TextDecoder();

  // Read initial greeting
  const first = await reader.read();
  const firstText = decoder.decode(first.value);
  assert.match(firstText, /event: connected/);
  assert.match(firstText, /"clients":1/);

  // Broadcast an event
  broadcastStreamEvent('refresh', { test: true });
  const second = await reader.read();
  const secondText = decoder.decode(second.value);
  assert.match(secondText, /event: refresh/);
  assert.match(secondText, /"test":true/);

  // Connect a second client to test multi-client broadcast
  const controller2 = new AbortController();
  const res2 = await fetch(`http://127.0.0.1:${port}/api/stream`, {
    signal: controller2.signal,
  });
  assert.equal(res2.status, 200);
  assert.equal(streamClientCount(), 2);

  // Broadcast alerts
  broadcastStreamEvent('alerts', { count: 3 });
  const reader2 = res2.body!.getReader();
  // reader2 first reads connected greeting
  const greet2 = await reader2.read();
  assert.match(decoder.decode(greet2.value), /event: connected/);
  const alertMsg2 = await reader2.read();
  assert.match(decoder.decode(alertMsg2.value), /event: alerts/);

  // Abort first client
  controller.abort();
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(streamClientCount(), 1);

  // Close all clients
  closeAllStreamClients();
  assert.equal(streamClientCount(), 0);

  controller2.abort();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});
