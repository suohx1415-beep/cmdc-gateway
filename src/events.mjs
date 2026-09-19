const clients = new Set();
const HEARTBEAT_MS = 25_000;

let heartbeat = null;

function ensureHeartbeat() {
  if (heartbeat) return;
  heartbeat = setInterval(() => {
    for (const client of clients) {
      try {
        client.res.write(': ping\n\n');
      } catch {
        clients.delete(client);
      }
    }
    if (clients.size === 0 && heartbeat) {
      clearInterval(heartbeat);
      heartbeat = null;
    }
  }, HEARTBEAT_MS);
  heartbeat.unref?.();
}

function send(res, event, data) {
  try {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    return true;
  } catch {
    return false;
  }
}

export function subscribe(req, res, { hours = 24, account = 'all' } = {}) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
    'Access-Control-Allow-Origin': '*',
  });
  res.setTimeout?.(0);
  res.write(': connected\n\n');

  // `account` is what this connection is watching: per-scope pushes read it back,
  // otherwise a client on a single account would get the aggregate pushed over it
  const client = { res, hours, account };
  clients.add(client);
  ensureHeartbeat();

  const cleanup = () => {
    if (!clients.has(client)) return;
    clients.delete(client);
    try {
      res.end();
    } catch {
      /* already gone */
    }
  };
  req.on('close', cleanup);
  req.on('error', cleanup);
  res.on('error', cleanup);

  return cleanup;
}

export function publish(event, data) {
  const payload = { event, data };
  for (const client of [...clients]) {
    if (!send(client.res, payload.event, payload.data)) clients.delete(client);
  }
}

export function publishPer(event, build) {
  for (const client of [...clients]) {
    let data;
    try {
      data = build(client);
    } catch {
      continue;
    }
    if (data === undefined || data === null) continue;
    if (!send(client.res, event, data)) clients.delete(client);
  }
}

export function listenerCount() {
  return clients.size;
}

export function listClients() {
  return [...clients];
}
