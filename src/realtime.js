import { WebSocketServer } from 'ws';
import { config } from './config.js';

let wss = null;

export function initRealtime(server) {
  if (wss) {
    return wss;
  }

  wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (request, socket, head) => {
    if (!String(request.url || '').startsWith('/ws')) {
      return;
    }

    if (!isAuthorized(request)) {
      socket.write('HTTP/1.1 401 Unauthorized\r\nWWW-Authenticate: Basic realm="Kaspi Panel"\r\n\r\n');
      socket.destroy();
      return;
    }

    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  });

  wss.on('connection', (socket) => {
    safeSend(socket, {
      type: 'hello',
      payload: {
        connectedAt: new Date().toISOString(),
      },
    });
  });

  return wss;
}

export function broadcastRealtimeEvent(type, payload = {}) {
  if (!wss) {
    return;
  }

  const message = JSON.stringify({
    type: String(type || 'event'),
    payload,
    sentAt: new Date().toISOString(),
  });

  for (const client of wss.clients) {
    if (client.readyState === client.OPEN) {
      client.send(message);
    }
  }
}

function isAuthorized(request) {
  const { user, password } = config.panel;

  if (!user || !password) {
    return true;
  }

  const authorization = request.headers.authorization || '';
  const [scheme, encoded] = authorization.split(' ');

  if (scheme !== 'Basic' || !encoded) {
    return false;
  }

  const decoded = Buffer.from(encoded, 'base64').toString('utf8');
  const separator = decoded.indexOf(':');
  const reqUser = separator >= 0 ? decoded.slice(0, separator) : '';
  const reqPassword = separator >= 0 ? decoded.slice(separator + 1) : '';

  return reqUser === user && reqPassword === password;
}

function safeSend(socket, payload) {
  try {
    socket.send(JSON.stringify(payload));
  } catch {
    // Ignore broken sockets during initial handshake and page reloads.
  }
}
