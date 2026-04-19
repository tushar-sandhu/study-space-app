// src/middleware/auth.js
const jwt    = require('jsonwebtoken');
const { query } = require('../config/database');
const { cache } = require('../config/redis');
const logger = require('../config/logger');

/**
 * Verify JWT and attach req.user
 */
exports.authenticate = async (req, res, next) => {
  try {
    const header = req.headers['authorization'];
    if (!header?.startsWith('Bearer '))
      return res.status(401).json({ success: false, message: 'Authentication required' });

    const token = header.slice(7);
    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET, { issuer: 'studyspace-mahe' });
    } catch (err) {
      if (err.name === 'TokenExpiredError')
        return res.status(401).json({ success: false, message: 'Token expired', code: 'TOKEN_EXPIRED' });
      return res.status(401).json({ success: false, message: 'Invalid token' });
    }

    // Try cache first
    const cached = await cache.get(`user:${decoded.sub}`);
    if (cached) {
      req.user = cached;
      return next();
    }

    // Fall back to DB
    const result = await query(
      'SELECT id, full_name, email, role, student_id, department, is_active FROM users WHERE id = $1',
      [decoded.sub]
    );
    if (!result.rowCount) return res.status(401).json({ success: false, message: 'User not found' });
    const user = result.rows[0];
    if (!user.is_active) return res.status(403).json({ success: false, message: 'Account suspended' });

    await cache.set(`user:${user.id}`, user, 3600);
    req.user = user;
    next();
  } catch (err) {
    logger.error('Auth middleware error', { error: err.message });
    res.status(500).json({ success: false, message: 'Authentication failed' });
  }
};

/**
 * Require specific role(s)
 * Usage: requireRole('admin') or requireRole('admin','staff')
 */
exports.requireRole = (...roles) => (req, res, next) => {
  if (!req.user) return res.status(401).json({ success: false, message: 'Authentication required' });
  if (!roles.includes(req.user.role))
    return res.status(403).json({ success: false, message: `Access restricted to: ${roles.join(', ')}` });
  next();
};

/**
 * Optional auth — attaches user if token present, but doesn't fail
 */
exports.optionalAuth = async (req, res, next) => {
  const header = req.headers['authorization'];
  if (!header?.startsWith('Bearer ')) return next();
  try {
    const token   = header.slice(7);
    const decoded = jwt.verify(token, process.env.JWT_SECRET, { issuer: 'studyspace-mahe' });
    const result  = await query('SELECT id, full_name, email, role FROM users WHERE id = $1 AND is_active = TRUE', [decoded.sub]);
    if (result.rowCount) req.user = result.rows[0];
  } catch { /* silent */ }
  next();
};
