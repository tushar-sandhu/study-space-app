// src/config/redis.js
const { createClient } = require('redis');
const logger = require('./logger');

let client = null;
let subscriber = null;
let publisher = null;

const createRedisClient = () => {
  const config = {
    socket: {
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT) || 6379,
      reconnectStrategy: (retries) => {
        if (retries > 10) {
          logger.error('Redis: max reconnect attempts reached');
          return new Error('Redis connection refused');
        }
        return Math.min(retries * 100, 3000);
      },
    },
  };
  if (process.env.REDIS_PASSWORD) config.password = process.env.REDIS_PASSWORD;
  return createClient(config);
};

const connectRedis = async () => {
  try {
    client = createRedisClient();
    subscriber = createRedisClient();
    publisher = createRedisClient();

    client.on('error',      (err) => logger.error('Redis client error',      { error: err.message }));
    subscriber.on('error',  (err) => logger.error('Redis subscriber error',  { error: err.message }));
    publisher.on('error',   (err) => logger.error('Redis publisher error',   { error: err.message }));

    await Promise.all([client.connect(), subscriber.connect(), publisher.connect()]);
    logger.info('Redis connected (client + pub/sub)');
  } catch (err) {
    logger.warn('Redis unavailable – caching disabled', { error: err.message });
    client = null; subscriber = null; publisher = null;
  }
};

// ── Cache helpers ────────────────────────────────────────────────────────────

const TTL = parseInt(process.env.REDIS_TTL) || 300;

const cache = {
  get: async (key) => {
    if (!client) return null;
    try {
      const val = await client.get(key);
      return val ? JSON.parse(val) : null;
    } catch { return null; }
  },

  set: async (key, value, ttl = TTL) => {
    if (!client) return;
    try {
      await client.setEx(key, ttl, JSON.stringify(value));
    } catch (err) { logger.warn('Redis set failed', { key, error: err.message }); }
  },

  del: async (...keys) => {
    if (!client) return;
    try { await client.del(keys); } catch { /* ignore */ }
  },

  delPattern: async (pattern) => {
    if (!client) return;
    try {
      const keys = await client.keys(pattern);
      if (keys.length) await client.del(keys);
    } catch { /* ignore */ }
  },

  /** Publish availability change to all subscribers */
  publish: async (channel, message) => {
    if (!publisher) return;
    try { await publisher.publish(channel, JSON.stringify(message)); } catch { /* ignore */ }
  },

  subscribe: async (channel, handler) => {
    if (!subscriber) return;
    try { await subscriber.subscribe(channel, (msg) => handler(JSON.parse(msg))); } catch { /* ignore */ }
  },
};

const getClient     = () => client;
const getSubscriber = () => subscriber;
const getPublisher  = () => publisher;

module.exports = { connectRedis, cache, getClient, getSubscriber, getPublisher };
