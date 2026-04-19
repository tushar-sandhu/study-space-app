// src/config/database.js
const { Pool } = require('pg');
const logger = require('./logger');

const pool = new Pool({
  host:     process.env.DB_HOST     || 'localhost',
  port:     parseInt(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME     || 'studyspace_db',
  user:     process.env.DB_USER     || 'studyspace_user',
  password: process.env.DB_PASSWORD || '',
  min:      parseInt(process.env.DB_POOL_MIN) || 2,
  max:      parseInt(process.env.DB_POOL_MAX) || 10,
  idleTimeoutMillis:    30000,
  connectionTimeoutMillis: 5000,
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
});

pool.on('connect', () => logger.debug('New DB connection established'));
pool.on('error',   (err) => logger.error('Unexpected DB error', { error: err.message }));

/**
 * Execute a query against the pool.
 * @param {string} text  - SQL query
 * @param {Array}  params - Parameterised values
 */
const query = async (text, params) => {
  const start = Date.now();
  try {
    const result = await pool.query(text, params);
    const duration = Date.now() - start;
    logger.debug('Query executed', { text: text.substring(0, 80), duration, rows: result.rowCount });
    return result;
  } catch (err) {
    logger.error('Query failed', { text: text.substring(0, 80), error: err.message });
    throw err;
  }
};

/**
 * Acquire a client for transactions.
 */
const getClient = () => pool.connect();

/**
 * Run multiple queries inside a single transaction.
 * @param {Function} callback - async (client) => { ... }
 */
const withTransaction = async (callback) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error('Transaction rolled back', { error: err.message });
    throw err;
  } finally {
    client.release();
  }
};

const testConnection = async () => {
  try {
    const result = await query('SELECT NOW() AS time, current_database() AS db');
    logger.info('Database connected', { db: result.rows[0].db, time: result.rows[0].time });
    return true;
  } catch (err) {
    logger.error('Database connection failed', { error: err.message });
    return false;
  }
};

module.exports = { query, getClient, withTransaction, testConnection, pool };
