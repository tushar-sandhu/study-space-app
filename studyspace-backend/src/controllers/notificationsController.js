// src/controllers/notificationsController.js
const { query } = require('../config/database');
const logger = require('../config/logger');

exports.getNotifications = async (req, res) => {
  const { unread_only, page = 1, limit = 20 } = req.query;
  const offset = (page - 1) * limit;
  const conditions = ['user_id = $1'];
  const params = [req.user.id];
  if (unread_only === 'true') conditions.push('is_read = FALSE');
  try {
    const result = await query(
      `SELECT * FROM notifications WHERE ${conditions.join(' AND ')} ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
      [...params, limit, offset]
    );
    const countRes = await query(`SELECT COUNT(*) FROM notifications WHERE ${conditions.join(' AND ')}`, params);
    const unread   = await query('SELECT COUNT(*) FROM notifications WHERE user_id = $1 AND is_read = FALSE', [req.user.id]);
    res.json({
      success: true, data: result.rows,
      meta: { total: parseInt(countRes.rows[0].count), unread: parseInt(unread.rows[0].count), page: parseInt(page), limit: parseInt(limit) },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch notifications' });
  }
};

exports.markRead = async (req, res) => {
  const { id } = req.params;
  try {
    await query(`UPDATE notifications SET is_read = TRUE WHERE id = $1 AND user_id = $2`, [id, req.user.id]);
    res.json({ success: true, message: 'Marked as read' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to mark notification' });
  }
};

exports.markAllRead = async (req, res) => {
  try {
    const result = await query(
      `UPDATE notifications SET is_read = TRUE WHERE user_id = $1 AND is_read = FALSE RETURNING id`,
      [req.user.id]
    );
    res.json({ success: true, message: `Marked ${result.rowCount} notifications as read` });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to mark notifications' });
  }
};

exports.deleteNotification = async (req, res) => {
  try {
    await query('DELETE FROM notifications WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
    res.json({ success: true, message: 'Notification deleted' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to delete notification' });
  }
};

// ══════════════════════════════════════════════════════════════════════════════
// src/controllers/reviewsController.js
// ══════════════════════════════════════════════════════════════════════════════

const reviewsQuery = require('../config/database').query;

exports.createReview = async (req, res) => {
  const { space_id, booking_id, rating, comment } = req.body;
  const userId = req.user.id;
  try {
    // Verify space exists
    const spaceRes = await reviewsQuery('SELECT id FROM study_spaces WHERE id = $1', [space_id]);
    if (!spaceRes.rowCount) return res.status(404).json({ success: false, message: 'Space not found' });

    // If booking_id provided, must belong to user
    if (booking_id) {
      const bRes = await reviewsQuery(
        `SELECT id FROM bookings WHERE id = $1 AND user_id = $2 AND status IN ('completed','confirmed')`,
        [booking_id, userId]
      );
      if (!bRes.rowCount)
        return res.status(403).json({ success: false, message: 'You can only review spaces you have visited' });

      const dupRes = await reviewsQuery('SELECT id FROM reviews WHERE booking_id = $1', [booking_id]);
      if (dupRes.rowCount) return res.status(409).json({ success: false, message: 'You have already reviewed this booking' });
    }

    const result = await reviewsQuery(
      `INSERT INTO reviews (user_id, space_id, booking_id, rating, comment) VALUES ($1,$2,$3,$4,$5)
       RETURNING id, rating, comment, created_at`,
      [userId, space_id, booking_id || null, rating, comment || null]
    );

    logger.info('Review created', { reviewId: result.rows[0].id, userId, spaceId: space_id });
    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ success: false, message: 'Review already exists for this booking' });
    logger.error('Create review error', { error: err.message });
    res.status(500).json({ success: false, message: 'Failed to submit review' });
  }
};

exports.updateReview = async (req, res) => {
  const { id } = req.params;
  const { rating, comment } = req.body;
  try {
    const result = await reviewsQuery(
      `UPDATE reviews SET rating = COALESCE($1, rating), comment = COALESCE($2, comment)
       WHERE id = $3 AND user_id = $4 RETURNING *`,
      [rating || null, comment || null, id, req.user.id]
    );
    if (!result.rowCount) return res.status(404).json({ success: false, message: 'Review not found' });
    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Update failed' });
  }
};

exports.deleteReview = async (req, res) => {
  try {
    const result = await reviewsQuery(
      `DELETE FROM reviews WHERE id = $1 AND (user_id = $2 OR $3 = 'admin') RETURNING id`,
      [req.params.id, req.user.id, req.user.role]
    );
    if (!result.rowCount) return res.status(404).json({ success: false, message: 'Review not found' });
    res.json({ success: true, message: 'Review deleted' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Delete failed' });
  }
};

exports.getMyReviews = async (req, res) => {
  try {
    const result = await reviewsQuery(
      `SELECT r.*, ss.name AS space_name, ss.emoji FROM reviews r
       JOIN study_spaces ss ON r.space_id = ss.id
       WHERE r.user_id = $1 ORDER BY r.created_at DESC`,
      [req.user.id]
    );
    res.json({ success: true, data: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch reviews' });
  }
};
