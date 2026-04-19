// src/controllers/authController.js
const bcrypt  = require('bcryptjs');
const crypto  = require('crypto');
const jwt     = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { query, withTransaction } = require('../config/database');
const { cache } = require('../config/redis');
const emailService = require('../services/emailService');
const logger  = require('../config/logger');

// ── Helpers ──────────────────────────────────────────────────────────────────

const generateAccessToken = (user) =>
  jwt.sign(
    { sub: user.id, email: user.email, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d', issuer: 'studyspace-mahe' }
  );

const generateRefreshToken = () => {
  const raw   = uuidv4() + crypto.randomBytes(32).toString('hex');
  const hash  = crypto.createHash('sha256').update(raw).digest('hex');
  return { raw, hash };
};

const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

// ── REGISTER ─────────────────────────────────────────────────────────────────

exports.register = async (req, res) => {
  const { full_name, email, password, student_id, department, phone } = req.body;

  try {
    // Duplicate check
    const exists = await query('SELECT id FROM users WHERE email = $1', [email.toLowerCase()]);
    if (exists.rowCount) return res.status(409).json({ success: false, message: 'Email already registered' });

    if (student_id) {
      const sidExists = await query('SELECT id FROM users WHERE student_id = $1', [student_id]);
      if (sidExists.rowCount) return res.status(409).json({ success: false, message: 'Student ID already registered' });
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const userRes = await query(
      `INSERT INTO users (full_name, email, password_hash, student_id, department, phone, role, is_verified)
       VALUES ($1,$2,$3,$4,$5,$6,'student',FALSE) RETURNING id, full_name, email, role`,
      [full_name, email.toLowerCase(), passwordHash, student_id || null, department || null, phone || null]
    );
    const user = userRes.rows[0];

    // Email verification token
    const verifyToken = crypto.randomBytes(32).toString('hex');
    const verifyHash  = hashToken(verifyToken);
    await query(
      `INSERT INTO email_verification_tokens (user_id, token_hash, expires_at) VALUES ($1,$2, NOW() + INTERVAL '24 hours')`,
      [user.id, verifyHash]
    );

    await emailService.sendVerificationEmail(email, full_name, verifyToken);

    logger.info('User registered', { userId: user.id, email });
    res.status(201).json({
      success: true,
      message: 'Registration successful. Please verify your email.',
      data: { id: user.id, full_name: user.full_name, email: user.email, role: user.role },
    });
  } catch (err) {
    logger.error('Register error', { error: err.message });
    res.status(500).json({ success: false, message: 'Registration failed' });
  }
};

// ── LOGIN ─────────────────────────────────────────────────────────────────────

exports.login = async (req, res) => {
  const { email, password } = req.body;

  try {
    const userRes = await query(
      `SELECT id, full_name, email, password_hash, role, is_active, is_verified, student_id, department, avatar_url
       FROM users WHERE email = $1`,
      [email.toLowerCase()]
    );
    if (!userRes.rowCount) return res.status(401).json({ success: false, message: 'Invalid credentials' });

    const user = userRes.rows[0];
    if (!user.is_active)   return res.status(403).json({ success: false, message: 'Account suspended. Contact admin.' });

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ success: false, message: 'Invalid credentials' });

    // Tokens
    const accessToken  = generateAccessToken(user);
    const { raw, hash } = generateRefreshToken();
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    await query(
      `INSERT INTO refresh_tokens (user_id, token_hash, expires_at, ip_address, user_agent)
       VALUES ($1,$2,$3,$4,$5)`,
      [user.id, hash, expiresAt, req.ip, req.headers['user-agent'] || '']
    );

    // Update last login
    await query('UPDATE users SET last_login_at = NOW() WHERE id = $1', [user.id]);

    // Cache user profile
    await cache.set(`user:${user.id}`, { id: user.id, full_name: user.full_name, email: user.email, role: user.role }, 3600);

    logger.info('User logged in', { userId: user.id, email: user.email });

    res.json({
      success: true,
      message: 'Login successful',
      data: {
        access_token:  accessToken,
        refresh_token: raw,
        expires_in:    7 * 24 * 60 * 60,
        user: {
          id:         user.id,
          full_name:  user.full_name,
          email:      user.email,
          role:       user.role,
          student_id: user.student_id,
          department: user.department,
          avatar_url: user.avatar_url,
          is_verified: user.is_verified,
        },
      },
    });
  } catch (err) {
    logger.error('Login error', { error: err.message });
    res.status(500).json({ success: false, message: 'Login failed' });
  }
};

// ── REFRESH TOKEN ─────────────────────────────────────────────────────────────

exports.refreshToken = async (req, res) => {
  const { refresh_token } = req.body;
  if (!refresh_token) return res.status(400).json({ success: false, message: 'Refresh token required' });

  try {
    const hash = hashToken(refresh_token);
    const tokenRes = await query(
      `SELECT rt.*, u.id as uid, u.email, u.role, u.full_name, u.is_active
       FROM refresh_tokens rt JOIN users u ON rt.user_id = u.id
       WHERE rt.token_hash = $1 AND rt.revoked = FALSE AND rt.expires_at > NOW()`,
      [hash]
    );
    if (!tokenRes.rowCount) return res.status(401).json({ success: false, message: 'Invalid or expired refresh token' });

    const t = tokenRes.rows[0];
    if (!t.is_active) return res.status(403).json({ success: false, message: 'Account suspended' });

    // Rotate: revoke old, issue new
    await query('UPDATE refresh_tokens SET revoked = TRUE WHERE id = $1', [t.id]);
    const newAccess = generateAccessToken({ id: t.uid, email: t.email, role: t.role });
    const { raw: newRaw, hash: newHash } = generateRefreshToken();
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    await query(
      `INSERT INTO refresh_tokens (user_id, token_hash, expires_at, ip_address, user_agent)
       VALUES ($1,$2,$3,$4,$5)`,
      [t.uid, newHash, expiresAt, req.ip, req.headers['user-agent'] || '']
    );

    res.json({ success: true, data: { access_token: newAccess, refresh_token: newRaw } });
  } catch (err) {
    logger.error('Refresh token error', { error: err.message });
    res.status(500).json({ success: false, message: 'Token refresh failed' });
  }
};

// ── LOGOUT ────────────────────────────────────────────────────────────────────

exports.logout = async (req, res) => {
  const { refresh_token } = req.body;
  try {
    if (refresh_token) {
      const hash = hashToken(refresh_token);
      await query('UPDATE refresh_tokens SET revoked = TRUE WHERE token_hash = $1', [hash]);
    }
    await cache.del(`user:${req.user.id}`);
    logger.info('User logged out', { userId: req.user.id });
    res.json({ success: true, message: 'Logged out successfully' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Logout failed' });
  }
};

// ── VERIFY EMAIL ──────────────────────────────────────────────────────────────

exports.verifyEmail = async (req, res) => {
  const { token } = req.params;
  try {
    const hash = hashToken(token);
    const res2 = await query(
      `SELECT evt.user_id FROM email_verification_tokens evt
       WHERE evt.token_hash = $1 AND evt.expires_at > NOW()`,
      [hash]
    );
    if (!res2.rowCount) return res.status(400).json({ success: false, message: 'Invalid or expired verification link' });

    const userId = res2.rows[0].user_id;
    await withTransaction(async (client) => {
      await client.query(`UPDATE users SET is_verified = TRUE, email_verified_at = NOW() WHERE id = $1`, [userId]);
      await client.query(`DELETE FROM email_verification_tokens WHERE user_id = $1`, [userId]);
    });

    res.json({ success: true, message: 'Email verified successfully. You can now log in.' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Verification failed' });
  }
};

// ── FORGOT PASSWORD ───────────────────────────────────────────────────────────

exports.forgotPassword = async (req, res) => {
  const { email } = req.body;
  try {
    const userRes = await query('SELECT id, full_name FROM users WHERE email = $1 AND is_active = TRUE', [email.toLowerCase()]);
    // Always return success to prevent email enumeration
    if (!userRes.rowCount) return res.json({ success: true, message: 'If this email exists, a reset link has been sent.' });

    const user = userRes.rows[0];
    const raw  = crypto.randomBytes(32).toString('hex');
    const hash = hashToken(raw);
    await query(`DELETE FROM password_reset_tokens WHERE user_id = $1`, [user.id]);
    await query(
      `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES ($1,$2, NOW() + INTERVAL '1 hour')`,
      [user.id, hash]
    );
    await emailService.sendPasswordResetEmail(email, user.full_name, raw);
    logger.info('Password reset requested', { userId: user.id });
    res.json({ success: true, message: 'If this email exists, a reset link has been sent.' });
  } catch (err) {
    logger.error('Forgot password error', { error: err.message });
    res.status(500).json({ success: false, message: 'Request failed' });
  }
};

// ── RESET PASSWORD ────────────────────────────────────────────────────────────

exports.resetPassword = async (req, res) => {
  const { token, new_password } = req.body;
  try {
    const hash = hashToken(token);
    const tokenRes = await query(
      `SELECT user_id FROM password_reset_tokens WHERE token_hash = $1 AND used = FALSE AND expires_at > NOW()`,
      [hash]
    );
    if (!tokenRes.rowCount) return res.status(400).json({ success: false, message: 'Invalid or expired reset token' });

    const userId = tokenRes.rows[0].user_id;
    const passwordHash = await bcrypt.hash(new_password, 12);
    await withTransaction(async (client) => {
      await client.query('UPDATE users SET password_hash = $1 WHERE id = $2', [passwordHash, userId]);
      await client.query('UPDATE password_reset_tokens SET used = TRUE WHERE token_hash = $1', [hash]);
      await client.query('UPDATE refresh_tokens SET revoked = TRUE WHERE user_id = $1', [userId]);
    });
    await cache.del(`user:${userId}`);
    logger.info('Password reset complete', { userId });
    res.json({ success: true, message: 'Password reset successfully. Please log in.' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Password reset failed' });
  }
};

// ── ME (current user) ─────────────────────────────────────────────────────────

exports.getMe = async (req, res) => {
  try {
    const cached = await cache.get(`user:${req.user.id}`);
    if (cached) return res.json({ success: true, data: cached });

    const result = await query(
      `SELECT id, student_id, full_name, email, role, department, phone, avatar_url, is_verified, created_at, last_login_at
       FROM users WHERE id = $1`,
      [req.user.id]
    );
    if (!result.rowCount) return res.status(404).json({ success: false, message: 'User not found' });

    const user = result.rows[0];
    await cache.set(`user:${user.id}`, user, 3600);
    res.json({ success: true, data: user });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch profile' });
  }
};

// ── UPDATE PROFILE ────────────────────────────────────────────────────────────

exports.updateProfile = async (req, res) => {
  const { full_name, department, phone } = req.body;
  try {
    const result = await query(
      `UPDATE users SET full_name = COALESCE($1, full_name), department = COALESCE($2, department), phone = COALESCE($3, phone)
       WHERE id = $4 RETURNING id, full_name, email, department, phone`,
      [full_name || null, department || null, phone || null, req.user.id]
    );
    await cache.del(`user:${req.user.id}`);
    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Update failed' });
  }
};

// ── CHANGE PASSWORD ───────────────────────────────────────────────────────────

exports.changePassword = async (req, res) => {
  const { current_password, new_password } = req.body;
  try {
    const userRes = await query('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
    const valid = await bcrypt.compare(current_password, userRes.rows[0].password_hash);
    if (!valid) return res.status(400).json({ success: false, message: 'Current password is incorrect' });

    const hash = await bcrypt.hash(new_password, 12);
    await query('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, req.user.id]);
    res.json({ success: true, message: 'Password changed successfully' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Password change failed' });
  }
};
