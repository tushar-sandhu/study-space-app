// src/controllers/spacesController.js
const { query } = require('../config/database');
const { cache } = require('../config/redis');
const logger = require('../config/logger');

// ── LIST SPACES ───────────────────────────────────────────────────────────────

exports.listSpaces = async (req, res) => {
  try {
    const { type, search, available_date, page = 1, limit = 20 } = req.query;
    const offset = (page - 1) * limit;
    const params = [];
    const conditions = ['ss.is_active = TRUE'];

    if (type)   { params.push(type);                 conditions.push(`ss.space_type = $${params.length}`); }
    if (search) { params.push(`%${search}%`);        conditions.push(`(ss.name ILIKE $${params.length} OR ss.building ILIKE $${params.length})`); }

    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

    const result = await query(
      `SELECT
          ss.id, ss.name, ss.code, ss.space_type, ss.capacity, ss.floor, ss.building,
          ss.map_x, ss.map_y, ss.emoji, ss.image_url, ss.requires_approval,
          ss.open_from, ss.open_until,
          COALESCE(src.avg_rating, 0) AS avg_rating,
          COALESCE(src.review_count, 0) AS review_count,
          ARRAY_AGG(DISTINCT sa.amenity ORDER BY sa.amenity) FILTER (WHERE sa.amenity IS NOT NULL) AS amenities
       FROM study_spaces ss
       LEFT JOIN space_rating_cache src ON ss.id = src.space_id
       LEFT JOIN space_amenities sa ON ss.id = sa.space_id
       ${where}
       GROUP BY ss.id, src.avg_rating, src.review_count
       ORDER BY src.avg_rating DESC NULLS LAST, ss.name
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset]
    );

    const countRes = await query(`SELECT COUNT(*) FROM study_spaces ss ${where}`, params);

    res.json({
      success: true,
      data: result.rows,
      meta: { total: parseInt(countRes.rows[0].count), page: parseInt(page), limit: parseInt(limit), pages: Math.ceil(countRes.rows[0].count / limit) },
    });
  } catch (err) {
    logger.error('List spaces error', { error: err.message });
    res.status(500).json({ success: false, message: 'Failed to fetch spaces' });
  }
};

// ── GET SINGLE SPACE ──────────────────────────────────────────────────────────

exports.getSpace = async (req, res) => {
  const { id } = req.params;
  const cacheKey = `space:${id}`;
  try {
    const cached = await cache.get(cacheKey);
    if (cached) return res.json({ success: true, data: cached });

    const result = await query(
      `SELECT
          ss.*,
          COALESCE(src.avg_rating, 0) AS avg_rating,
          COALESCE(src.review_count, 0) AS review_count,
          ARRAY_AGG(DISTINCT sa.amenity ORDER BY sa.amenity) FILTER (WHERE sa.amenity IS NOT NULL) AS amenities
       FROM study_spaces ss
       LEFT JOIN space_rating_cache src ON ss.id = src.space_id
       LEFT JOIN space_amenities sa ON ss.id = sa.space_id
       WHERE ss.id = $1 AND ss.is_active = TRUE
       GROUP BY ss.id, src.avg_rating, src.review_count`,
      [id]
    );
    if (!result.rowCount) return res.status(404).json({ success: false, message: 'Space not found' });

    await cache.set(cacheKey, result.rows[0], 600);
    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    logger.error('Get space error', { error: err.message });
    res.status(500).json({ success: false, message: 'Failed to fetch space' });
  }
};

// ── AVAILABILITY ──────────────────────────────────────────────────────────────

exports.getAvailability = async (req, res) => {
  const { id } = req.params;
  const { date } = req.query;

  if (!date) return res.status(400).json({ success: false, message: 'date query param required (YYYY-MM-DD)' });

  const cacheKey = `avail:${id}:${date}`;
  try {
    const cached = await cache.get(cacheKey);
    if (cached) return res.json({ success: true, data: cached });

    // Check space exists
    const spaceRes = await query('SELECT id, open_from, open_until FROM study_spaces WHERE id = $1 AND is_active = TRUE', [id]);
    if (!spaceRes.rowCount) return res.status(404).json({ success: false, message: 'Space not found' });

    // Check closures
    const closures = await query(
      `SELECT start_time, end_time, reason FROM space_closures
       WHERE space_id = $1 AND DATE(start_time) <= $2 AND DATE(end_time) >= $2`,
      [id, date]
    );

    const slots = await query(
      `SELECT
          ts.id, ts.start_time, ts.end_time, ts.is_available,
          COUNT(b.id) FILTER (WHERE b.status NOT IN ('cancelled')) AS booked_count,
          ts.max_bookings
       FROM time_slots ts
       LEFT JOIN bookings b ON b.slot_id = ts.id
       WHERE ts.space_id = $1 AND ts.slot_date = $2
       GROUP BY ts.id
       ORDER BY ts.start_time`,
      [id, date]
    );

    const data = {
      space_id:  id,
      date,
      closures:  closures.rows,
      is_closed: closures.rowCount > 0,
      slots: slots.rows.map(s => ({
        id:          s.id,
        start_time:  s.start_time,
        end_time:    s.end_time,
        status:      !s.is_available || parseInt(s.booked_count) >= s.max_bookings ? 'booked' : 'available',
        booked_count: parseInt(s.booked_count),
        max_bookings:  s.max_bookings,
      })),
    };

    await cache.set(cacheKey, data, 60); // 1-min TTL for real-time feel
    res.json({ success: true, data });
  } catch (err) {
    logger.error('Availability error', { error: err.message });
    res.status(500).json({ success: false, message: 'Failed to fetch availability' });
  }
};

// ── AVAILABILITY (multi-day) ──────────────────────────────────────────────────

exports.getWeeklyAvailability = async (req, res) => {
  const { id } = req.params;
  try {
    const days = await query(
      `SELECT
          ts.slot_date,
          COUNT(*) AS total_slots,
          COUNT(*) FILTER (WHERE ts.is_available = TRUE) AS available_slots,
          COUNT(b.id) FILTER (WHERE b.status NOT IN ('cancelled')) AS total_bookings
       FROM time_slots ts
       LEFT JOIN bookings b ON b.slot_id = ts.id
       WHERE ts.space_id = $1 AND ts.slot_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '6 days'
       GROUP BY ts.slot_date
       ORDER BY ts.slot_date`,
      [id]
    );
    res.json({ success: true, data: days.rows });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch weekly availability' });
  }
};

// ── REVIEWS FOR SPACE ─────────────────────────────────────────────────────────

exports.getSpaceReviews = async (req, res) => {
  const { id } = req.params;
  const { page = 1, limit = 10 } = req.query;
  const offset = (page - 1) * limit;
  try {
    const result = await query(
      `SELECT r.id, r.rating, r.comment, r.created_at,
              u.full_name, u.avatar_url, u.student_id
       FROM reviews r JOIN users u ON r.user_id = u.id
       WHERE r.space_id = $1 AND r.is_visible = TRUE
       ORDER BY r.created_at DESC
       LIMIT $2 OFFSET $3`,
      [id, limit, offset]
    );
    const countRes = await query('SELECT COUNT(*) FROM reviews WHERE space_id = $1 AND is_visible = TRUE', [id]);
    res.json({
      success: true,
      data: result.rows,
      meta: { total: parseInt(countRes.rows[0].count), page: parseInt(page), limit: parseInt(limit) },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch reviews' });
  }
};

// ── ADMIN: CREATE SPACE ───────────────────────────────────────────────────────

exports.createSpace = async (req, res) => {
  const { name, code, space_type, capacity, floor, building, map_x, map_y, emoji, open_from, open_until, amenities = [], description, requires_approval } = req.body;
  try {
    const result = await query(
      `INSERT INTO study_spaces (name, code, space_type, capacity, floor, building, map_x, map_y, emoji, open_from, open_until, description, requires_approval)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
      [name, code, space_type, capacity, floor || null, building || null, map_x, map_y, emoji || '📚', open_from || '08:00', open_until || '21:00', description || null, requires_approval || false]
    );
    const space = result.rows[0];

    // Insert amenities
    for (const amenity of amenities) {
      await query('INSERT INTO space_amenities (space_id, amenity) VALUES ($1,$2) ON CONFLICT DO NOTHING', [space.id, amenity]);
    }
    await query('INSERT INTO space_rating_cache (space_id) VALUES ($1) ON CONFLICT DO NOTHING', [space.id]);

    await cache.delPattern('space:*');
    logger.info('Space created', { spaceId: space.id, name, by: req.user.id });
    res.status(201).json({ success: true, data: space });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ success: false, message: 'Space code already exists' });
    logger.error('Create space error', { error: err.message });
    res.status(500).json({ success: false, message: 'Failed to create space' });
  }
};

// ── ADMIN: UPDATE SPACE ───────────────────────────────────────────────────────

exports.updateSpace = async (req, res) => {
  const { id } = req.params;
  const fields = ['name', 'capacity', 'floor', 'building', 'map_x', 'map_y', 'emoji', 'open_from', 'open_until', 'description', 'is_active', 'requires_approval'];
  const updates = [];
  const values  = [];
  fields.forEach(f => {
    if (req.body[f] !== undefined) { values.push(req.body[f]); updates.push(`${f} = $${values.length}`); }
  });
  if (!updates.length) return res.status(400).json({ success: false, message: 'No fields to update' });
  values.push(id);
  try {
    const result = await query(`UPDATE study_spaces SET ${updates.join(', ')} WHERE id = $${values.length} RETURNING *`, values);
    if (!result.rowCount) return res.status(404).json({ success: false, message: 'Space not found' });
    await cache.del(`space:${id}`);
    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Update failed' });
  }
};

// ── ADMIN: ADD CLOSURE ────────────────────────────────────────────────────────

exports.addClosure = async (req, res) => {
  const { id } = req.params;
  const { start_time, end_time, reason } = req.body;
  try {
    const result = await query(
      `INSERT INTO space_closures (space_id, start_time, end_time, reason, created_by) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [id, start_time, end_time, reason || null, req.user.id]
    );
    await cache.delPattern(`avail:${id}:*`);
    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to add closure' });
  }
};
