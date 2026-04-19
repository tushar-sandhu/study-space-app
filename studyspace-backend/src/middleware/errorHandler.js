// src/middleware/errorHandler.js
const logger = require('../config/logger');

/** Global error handler – must be registered last */
exports.errorHandler = (err, req, res, next) => {
  const status  = err.statusCode || err.status || 500;
  const message = status < 500 ? err.message : 'Internal server error';

  logger.error('Unhandled error', {
    status, message: err.message, stack: err.stack,
    path: req.path, method: req.method,
    userId: req.user?.id, ip: req.ip,
  });

  res.status(status).json({ success: false, message, ...(process.env.NODE_ENV === 'development' && { stack: err.stack }) });
};

/** 404 handler */
exports.notFound = (req, res) => {
  res.status(404).json({ success: false, message: `Route not found: ${req.method} ${req.path}` });
};

/** Async route wrapper – eliminates try/catch boilerplate */
exports.asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// ── src/middleware/requestLogger.js ──────────────────────────────────────────

const morgan = require('morgan');

const stream = {
  write: (message) => logger.http(message.trim()),
};

const skip = () => process.env.NODE_ENV === 'test';

exports.requestLogger = morgan(
  ':remote-addr :method :url :status :res[content-length] - :response-time ms',
  { stream, skip }
);

// ── src/middleware/rateLimiter.js ─────────────────────────────────────────────

const rateLimit = require('express-rate-limit');

exports.globalLimiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
  max:      parseInt(process.env.RATE_LIMIT_MAX) || 100,
  standardHeaders: true, legacyHeaders: false,
  message: { success: false, message: 'Too many requests, please try again later' },
});

exports.authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 10,
  message: { success: false, message: 'Too many auth attempts, please try again after 15 minutes' },
});

exports.bookingLimiter = rateLimit({
  windowMs: 60 * 1000, max: 5,
  message: { success: false, message: 'Booking rate limit exceeded. Please wait a moment.' },
});
