// scripts/migrate.js
require('dotenv').config();
const fs   = require('fs');
const path = require('path');
const { Pool } = require('pg');
const logger = require('../src/config/logger');

async function migrate() {
  const pool = new Pool({
    host: process.env.DB_HOST, port: process.env.DB_PORT,
    database: process.env.DB_NAME, user: process.env.DB_USER, password: process.env.DB_PASSWORD,
  });
  const client = await pool.connect();
  try {
    const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
    logger.info('Running migration...');
    await client.query(sql);
    logger.info('✅ Migration complete');
  } catch (err) {
    logger.error('Migration failed', { error: err.message });
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();
