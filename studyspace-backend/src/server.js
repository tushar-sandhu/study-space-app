// src/server.js
require('dotenv').config();
const http   = require('http');
const app    = require('./app');
const { testConnection } = require('./config/database');
const { connectRedis }   = require('./config/redis');
const { createWsServer } = require('./websocket/wsServer');
const { startScheduler } = require('./services/notificationService');
const logger = require('./config/logger');

const PORT = parseInt(process.env.PORT) || 5000;

async function bootstrap() {
  logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  logger.info('  StudySpace MAHE Bengaluru – API Server  ');
  logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  // 1. Database
  const dbOk = await testConnection();
  if (!dbOk && process.env.NODE_ENV === 'production') {
    logger.error('Cannot start without database in production');
    process.exit(1);
  }

  // 2. Redis
  await connectRedis();

  // 3. HTTP server
  const server = http.createServer(app);

  // 4. WebSocket
  createWsServer(server);

  // 5. Start listening
  server.listen(PORT, () => {
    logger.info(`HTTP server running on port ${PORT}`);
    logger.info(`API base: http://localhost:${PORT}/api/${process.env.API_VERSION || 'v1'}`);
    logger.info(`WebSocket: ws://localhost:${PORT}/ws`);
    logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
  });

  // 6. Background scheduler
  if (process.env.NODE_ENV !== 'test') {
    startScheduler();
  }

  // ── Graceful shutdown ────────────────────────────────────────────────────────
  const shutdown = async (signal) => {
    logger.info(`${signal} received – graceful shutdown`);
    server.close(async () => {
      const { pool } = require('./config/database');
      await pool.end();
      logger.info('Database pool closed');
      process.exit(0);
    });
    setTimeout(() => { logger.error('Forced shutdown after timeout'); process.exit(1); }, 10000);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT',  () => shutdown('SIGINT'));

  process.on('unhandledRejection', (reason) => logger.error('Unhandled rejection', { reason }));
  process.on('uncaughtException',  (err)    => { logger.error('Uncaught exception', { error: err.message }); process.exit(1); });
}

bootstrap();
