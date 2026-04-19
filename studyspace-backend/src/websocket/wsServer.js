// src/websocket/wsServer.js
const WebSocket = require('ws');
const jwt       = require('jsonwebtoken');
const { cache, getSubscriber } = require('../config/redis');
const logger    = require('../config/logger');

// Connected clients: userId → Set<WebSocket>
const clients = new Map();

/**
 * Authenticate WebSocket connection via JWT in query string or first message
 */
const authenticateWs = (token) => {
  try {
    return jwt.verify(token, process.env.JWT_SECRET, { issuer: 'studyspace-mahe' });
  } catch {
    return null;
  }
};

/**
 * Send JSON message to a specific user (all their connections)
 */
const sendToUser = (userId, data) => {
  const sockets = clients.get(userId);
  if (!sockets) return;
  const msg = JSON.stringify(data);
  sockets.forEach(ws => {
    if (ws.readyState === WebSocket.OPEN) {
      try { ws.send(msg); } catch { /* ignore */ }
    }
  });
};

/**
 * Broadcast to all connected clients (availability updates)
 */
const broadcast = (data, excludeUserId = null) => {
  const msg = JSON.stringify(data);
  clients.forEach((sockets, userId) => {
    if (userId === excludeUserId) return;
    sockets.forEach(ws => {
      if (ws.readyState === WebSocket.OPEN) {
        try { ws.send(msg); } catch { /* ignore */ }
      }
    });
  });
};

/**
 * Subscribe to Redis channels for real-time events
 */
const subscribeToRedis = async () => {
  const subscriber = getSubscriber();
  if (!subscriber) { logger.warn('Redis unavailable – real-time events disabled'); return; }

  // Availability changes (broadcast to all)
  await cache.subscribe('availability-update', (data) => {
    broadcast({ type: 'AVAILABILITY_UPDATE', payload: data });
    logger.debug('WS broadcast availability update', data);
  });

  // Per-user notifications
  // Pattern: user-notifications:<userId>
  try {
    await subscriber.pSubscribe('user-notifications:*', (message, channel) => {
      const userId = channel.split(':')[1];
      if (userId) {
        const data = typeof message === 'string' ? JSON.parse(message) : message;
        sendToUser(userId, { type: 'NOTIFICATION', payload: data });
      }
    });
  } catch (err) {
    logger.warn('pSubscribe not supported, using manual subscription', { error: err.message });
  }
};

/**
 * Attach WebSocket server to an existing HTTP server
 */
exports.createWsServer = (httpServer) => {
  const wss = new WebSocket.Server({ server: httpServer, path: '/ws' });

  wss.on('connection', (ws, req) => {
    // Auth via ?token= query param
    const url    = new URL(req.url, 'http://localhost');
    const token  = url.searchParams.get('token');
    const decoded = token ? authenticateWs(token) : null;

    ws.userId    = decoded?.sub || null;
    ws.isAlive   = true;
    ws.subscribedSpaces = new Set();

    if (ws.userId) {
      if (!clients.has(ws.userId)) clients.set(ws.userId, new Set());
      clients.get(ws.userId).add(ws);
      logger.debug('WS authenticated connection', { userId: ws.userId });
    } else {
      logger.debug('WS anonymous connection');
    }

    // Heartbeat pong
    ws.on('pong', () => { ws.isAlive = true; });

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw);

        switch (msg.type) {
          // Authenticate after connection if token wasn't in query
          case 'AUTH': {
            const d = authenticateWs(msg.token);
            if (d) {
              // Remove from old userId bucket
              if (ws.userId && clients.has(ws.userId)) {
                clients.get(ws.userId).delete(ws);
                if (!clients.get(ws.userId).size) clients.delete(ws.userId);
              }
              ws.userId = d.sub;
              if (!clients.has(ws.userId)) clients.set(ws.userId, new Set());
              clients.get(ws.userId).add(ws);
              ws.send(JSON.stringify({ type: 'AUTH_SUCCESS', userId: ws.userId }));
            } else {
              ws.send(JSON.stringify({ type: 'AUTH_ERROR', message: 'Invalid token' }));
            }
            break;
          }

          // Subscribe to a space's availability updates
          case 'SUBSCRIBE_SPACE': {
            if (msg.space_id) {
              ws.subscribedSpaces.add(msg.space_id);
              ws.send(JSON.stringify({ type: 'SUBSCRIBED', space_id: msg.space_id }));
            }
            break;
          }

          case 'UNSUBSCRIBE_SPACE': {
            ws.subscribedSpaces.delete(msg.space_id);
            break;
          }

          case 'PING':
            ws.send(JSON.stringify({ type: 'PONG', time: Date.now() }));
            break;

          default:
            ws.send(JSON.stringify({ type: 'ERROR', message: 'Unknown message type' }));
        }
      } catch (err) {
        logger.debug('WS message parse error', { error: err.message });
      }
    });

    ws.on('close', () => {
      if (ws.userId && clients.has(ws.userId)) {
        clients.get(ws.userId).delete(ws);
        if (!clients.get(ws.userId).size) clients.delete(ws.userId);
      }
      logger.debug('WS connection closed', { userId: ws.userId });
    });

    ws.on('error', (err) => logger.error('WS error', { error: err.message, userId: ws.userId }));

    // Welcome message
    ws.send(JSON.stringify({
      type:      'CONNECTED',
      message:   'Connected to StudySpace real-time server',
      userId:    ws.userId,
      timestamp: new Date().toISOString(),
    }));
  });

  // Heartbeat ping every 30s
  const heartbeat = setInterval(() => {
    wss.clients.forEach(ws => {
      if (!ws.isAlive) return ws.terminate();
      ws.isAlive = false;
      ws.ping();
    });
  }, 30000);

  wss.on('close', () => clearInterval(heartbeat));

  subscribeToRedis().catch(err => logger.error('Redis subscribe error', { error: err.message }));

  logger.info('WebSocket server initialised at /ws');

  return { wss, sendToUser, broadcast, clients };
};

exports.sendToUser = sendToUser;
exports.broadcast  = broadcast;
