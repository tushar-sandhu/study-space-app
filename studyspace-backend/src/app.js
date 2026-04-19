// src/app.js
require('dotenv').config();
const express    = require('express');
const helmet     = require('helmet');
const cors       = require('cors');
const compression = require('compression');
const { globalLimiter, requestLogger, errorHandler, notFound } = require('./middleware/errorHandler');
const routes     = require('./routes/index');
const logger     = require('./config/logger');

const app = express();

// ── Security ──────────────────────────────────────────────────────────────────
app.set('trust proxy', 1);

app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc:   ["'self'", "'unsafe-inline'"],
      imgSrc:     ["'self'", 'data:', 'https:'],
    },
  },
}));

// ── CORS ──────────────────────────────────────────────────────────────────────
const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:3000').split(',');
app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
    callback(new Error(`CORS: Origin ${origin} not allowed`));
  },
  credentials: true,
  methods:  ['GET','POST','PUT','PATCH','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization','X-Request-ID'],
  exposedHeaders: ['X-RateLimit-Limit','X-RateLimit-Remaining','X-Total-Count'],
}));

// ── Body & utilities ──────────────────────────────────────────────────────────
app.use(compression());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(requestLogger);

// ── Rate limiting ─────────────────────────────────────────────────────────────
app.use('/api/', globalLimiter);

// ── Request ID ────────────────────────────────────────────────────────────────
app.use((req, res, next) => {
  req.requestId = req.headers['x-request-id'] || require('crypto').randomUUID();
  res.setHeader('X-Request-ID', req.requestId);
  next();
});

// ── Routes ────────────────────────────────────────────────────────────────────
const API_PREFIX = `/api/${process.env.API_VERSION || 'v1'}`;
app.use(API_PREFIX, routes);

// ── Root ──────────────────────────────────────────────────────────────────────
app.get('/', (req, res) => res.json({
  service: 'StudySpace MAHE Bengaluru API',
  version: '1.0.0',
  docs:    `${API_PREFIX}/health`,
  status:  'running',
}));

// ── 404 & Error ───────────────────────────────────────────────────────────────
app.use(notFound);
app.use(errorHandler);

module.exports = app;
