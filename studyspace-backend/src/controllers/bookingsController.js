// src/controllers/bookingsController.js
const { query, withTransaction } = require('../config/database');
const { cache }   = require('../config/redis');
const notifService = require('../services/notificationService');
const emailService = require('../services/emailService');
const logger      = require('../config/logger');

const MAX_ACTIVE = parseInt(process.env.MAX_ACTIVE_BOOKINGS_PER_USER) || 3;
const MAX_DAYS   = parseInt(process.env.MAX_ADVANCE_BOOKING_DAYS)     || 7;

// ── CREATE BOOKING ────────────────────────────────────────────────────────────

exports.createBooking = async (req, res) => {
  const { space_id, booking_date, start_time, end_time, purpose, attendees_count = 1 } = req.body;
  const userId = req.user.id;

  try {
    // Validate date range
    const bookDate  = new Date(booking_date);
    const today     = new Date(); today.setHours(0, 0, 0, 0);
    const maxDate   = new Date(today); maxDate.setDate(today.getDate() + MAX_DAYS);
    if (bookDate < today)    return res.status(400).json({ success: false, message: 'Cannot book in the past' });
    if (bookDate > maxDate)  return res.status(400).json({ success: false, message: `Bookings allowed up to ${MAX_DAYS} days in advance` });

    // Check space exists and is active
    const spaceRes = await query(
      `SELECT id, name, capacity, open_from, open_until, requires_approval, emoji FROM study_spaces WHERE id = $1 AND is_active = TRUE`,
      [space_id]
    );
    if (!spaceRes.rowCount) return res.status(404).json({ success: false, message: 'Space not found or inactive' });
    const space = spaceRes.rows[0];

    // Check space capacity vs attendees
    if (attendees_count > space.capacity)
      return res.status(400).json({ success: false, message: `This space has a capacity of ${space.capacity}` });

    // Check active booking limit
    const activeCount = await query(
      `SELECT COUNT(*) FROM bookings WHERE user_id = $1 AND status IN ('confirmed','pending') AND booking_date >= CURRENT_DATE`,
      [userId]
    );
    if (parseInt(activeCount.rows[0].count) >= MAX_ACTIVE)
      return res.status(400).json({ success: false, message: `You can have at most ${MAX_ACTIVE} active bookings at a time` });

    // Check for user's own time conflict
    const userConflict = await query(
      `SELECT id FROM bookings WHERE user_id = $1 AND booking_date = $2 AND status NOT IN ('cancelled')
       AND (start_time, end_time) OVERLAPS ($3::TIME, $4::TIME)`,
      [userId, booking_date, start_time, end_time]
    );
    if (userConflict.rowCount)
      return res.status(409).json({ success: false, message: 'You already have a booking that overlaps this time' });

    // Check space conflict
    const spaceConflict = await query(
      `SELECT id FROM bookings WHERE space_id = $1 AND booking_date = $2 AND status NOT IN ('cancelled')
       AND (start_time, end_time) OVERLAPS ($3::TIME, $4::TIME)`,
      [space_id, booking_date, start_time, end_time]
    );
    if (spaceConflict.rowCount)
      return res.status(409).json({ success: false, message: 'This slot is no longer available. Please choose another.' });

    // Check space closure
    const closureCheck = await query(
      `SELECT id FROM space_closures WHERE space_id = $1
       AND ($2::DATE + $3::TIME, $2::DATE + $4::TIME) OVERLAPS (start_time, end_time)`,
      [space_id, booking_date, start_time, end_time]
    );
    if (closureCheck.rowCount)
      return res.status(409).json({ success: false, message: 'Space is closed during this time' });

    // Find matching time slot
    const slotRes = await query(
      `SELECT id FROM time_slots WHERE space_id = $1 AND slot_date = $2 AND start_time = $3 AND is_available = TRUE`,
      [space_id, booking_date, start_time]
    );
    const slotId = slotRes.rowCount ? slotRes.rows[0].id : null;

    const status = space.requires_approval ? 'pending' : 'confirmed';

    // Create booking in transaction
    const booking = await withTransaction(async (client) => {
      const bRes = await client.query(
        `INSERT INTO bookings (user_id, space_id, slot_id, booking_date, start_time, end_time, status, attendees_count, purpose)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
        [userId, space_id, slotId, booking_date, start_time, end_time, status, attendees_count, purpose || null]
      );
      // Mark slot as booked
      if (slotId) {
        await client.query('UPDATE time_slots SET is_available = FALSE WHERE id = $1', [slotId]);
      }
      return bRes.rows[0];
    });

    // Invalidate availability cache
    await cache.delPattern(`avail:${space_id}:*`);

    // Enrich with space name
    const fullBooking = { ...booking, space_name: space.name, space_emoji: space.emoji };

    // Send notification + email (async)
    const userRes = await query('SELECT full_name, email FROM users WHERE id = $1', [userId]);
    const user    = userRes.rows[0];

    notifService.createNotification({
      userId, type: 'booking_confirmed',
      title: status === 'pending' ? '⏳ Booking Pending Approval' : '✅ Booking Confirmed!',
      message: `Your booking for ${space.name} on ${booking_date} at ${start_time} is ${status}.`,
      bookingId: booking.id,
      data: { booking_ref: booking.booking_ref, space_name: space.name, booking_date, start_time },
    }).catch(err => logger.error('Notification error', { error: err.message }));

    emailService.sendBookingConfirmation(user.email, user.full_name, fullBooking)
      .catch(err => logger.error('Email error', { error: err.message }));

    // Publish availability change via Redis pub/sub
    await cache.publish('availability-update', { space_id, booking_date, start_time, status: 'booked' });

    logger.info('Booking created', { bookingId: booking.id, ref: booking.booking_ref, userId, spaceId: space_id });

    res.status(201).json({ success: true, message: 'Booking created successfully', data: fullBooking });
  } catch (err) {
    if (err.message?.includes('Booking conflict')) return res.status(409).json({ success: false, message: err.message });
    logger.error('Create booking error', { error: err.message });
    res.status(500).json({ success: false, message: 'Booking failed. Please try again.' });
  }
};

// ── GET MY BOOKINGS ───────────────────────────────────────────────────────────

exports.getMyBookings = async (req, res) => {
  const { status, page = 1, limit = 20 } = req.query;
  const offset = (page - 1) * limit;
  const params = [req.user.id];
  const conditions = ['b.user_id = $1'];
  if (status) { params.push(status); conditions.push(`b.status = $${params.length}`); }

  try {
    const result = await query(
      `SELECT b.*, ss.name AS space_name, ss.emoji, ss.building, ss.floor, ss.space_type
       FROM bookings b JOIN study_spaces ss ON b.space_id = ss.id
       WHERE ${conditions.join(' AND ')}
       ORDER BY b.booking_date DESC, b.start_time DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset]
    );
    const countRes = await query(`SELECT COUNT(*) FROM bookings b WHERE ${conditions.join(' AND ')}`, params);
    res.json({
      success: true,
      data: result.rows,
      meta: { total: parseInt(countRes.rows[0].count), page: parseInt(page), limit: parseInt(limit) },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch bookings' });
  }
};

// ── GET BOOKING BY ID ─────────────────────────────────────────────────────────

exports.getBooking = async (req, res) => {
  const { id } = req.params;
  try {
    const result = await query(
      `SELECT b.*, ss.name AS space_name, ss.emoji, ss.building, ss.floor, ss.space_type,
              ss.map_x, ss.map_y, u.full_name, u.email, u.student_id
       FROM bookings b
       JOIN study_spaces ss ON b.space_id = ss.id
       JOIN users u ON b.user_id = u.id
       WHERE b.id = $1`,
      [id]
    );
    if (!result.rowCount) return res.status(404).json({ success: false, message: 'Booking not found' });
    const booking = result.rows[0];
    // Allow user to see own bookings; admins/staff see all
    if (req.user.role === 'student' && booking.user_id !== req.user.id)
      return res.status(403).json({ success: false, message: 'Forbidden' });
    res.json({ success: true, data: booking });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch booking' });
  }
};

// ── CANCEL BOOKING ────────────────────────────────────────────────────────────

exports.cancelBooking = async (req, res) => {
  const { id } = req.params;
  const { reason } = req.body;
  try {
    const bookingRes = await query('SELECT * FROM bookings WHERE id = $1', [id]);
    if (!bookingRes.rowCount) return res.status(404).json({ success: false, message: 'Booking not found' });
    const booking = bookingRes.rows[0];

    if (req.user.role === 'student' && booking.user_id !== req.user.id)
      return res.status(403).json({ success: false, message: 'Forbidden' });

    if (['cancelled', 'completed'].includes(booking.status))
      return res.status(400).json({ success: false, message: `Cannot cancel a ${booking.status} booking` });

    // Cannot cancel within 30 mins of start (students only)
    if (req.user.role === 'student') {
      const startDT = new Date(`${booking.booking_date}T${booking.start_time}`);
      if (startDT - Date.now() < 30 * 60 * 1000)
        return res.status(400).json({ success: false, message: 'Cannot cancel within 30 minutes of the booking start time' });
    }

    await withTransaction(async (client) => {
      await client.query(
        `UPDATE bookings SET status = 'cancelled', cancelled_at = NOW(), cancelled_by = $1, cancel_reason = $2 WHERE id = $3`,
        [req.user.id, reason || null, id]
      );
      if (booking.slot_id) {
        await client.query('UPDATE time_slots SET is_available = TRUE WHERE id = $1', [booking.slot_id]);
      }
    });

    await cache.delPattern(`avail:${booking.space_id}:*`);
    await cache.publish('availability-update', { space_id: booking.space_id, booking_date: booking.booking_date, start_time: booking.start_time, status: 'available' });

    notifService.createNotification({
      userId: booking.user_id, type: 'booking_cancelled',
      title: '❌ Booking Cancelled',
      message: `Your booking (${booking.booking_ref}) has been cancelled.`,
      bookingId: id,
    }).catch(() => {});

    logger.info('Booking cancelled', { bookingId: id, by: req.user.id });
    res.json({ success: true, message: 'Booking cancelled successfully' });
  } catch (err) {
    logger.error('Cancel booking error', { error: err.message });
    res.status(500).json({ success: false, message: 'Cancellation failed' });
  }
};

// ── CHECK IN ──────────────────────────────────────────────────────────────────

exports.checkIn = async (req, res) => {
  const { id } = req.params;
  try {
    const bookRes = await query('SELECT * FROM bookings WHERE id = $1 AND user_id = $2', [id, req.user.id]);
    if (!bookRes.rowCount) return res.status(404).json({ success: false, message: 'Booking not found' });
    const b = bookRes.rows[0];

    if (b.status !== 'confirmed') return res.status(400).json({ success: false, message: 'Booking is not in confirmed state' });
    if (b.checked_in_at)          return res.status(400).json({ success: false, message: 'Already checked in' });

    // Must be within 15 mins of start
    const startDT = new Date(`${b.booking_date}T${b.start_time}`);
    const grace   = parseInt(process.env.BOOKING_GRACE_PERIOD_MINUTES || 15) * 60 * 1000;
    if (Date.now() < startDT.getTime() - grace)
      return res.status(400).json({ success: false, message: 'Check-in available 15 minutes before the slot start' });
    if (Date.now() > new Date(`${b.booking_date}T${b.end_time}`).getTime())
      return res.status(400).json({ success: false, message: 'Booking has already ended' });

    await query('UPDATE bookings SET checked_in_at = NOW() WHERE id = $1', [id]);
    res.json({ success: true, message: 'Checked in successfully', data: { checked_in_at: new Date() } });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Check-in failed' });
  }
};

// ── ADMIN: ALL BOOKINGS ───────────────────────────────────────────────────────

exports.getAllBookings = async (req, res) => {
  const { status, space_id, date, page = 1, limit = 30 } = req.query;
  const offset = (page - 1) * limit;
  const params = [];
  const conditions = [];
  if (status)   { params.push(status);   conditions.push(`b.status = $${params.length}`); }
  if (space_id) { params.push(space_id); conditions.push(`b.space_id = $${params.length}`); }
  if (date)     { params.push(date);     conditions.push(`b.booking_date = $${params.length}`); }
  const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
  try {
    const result = await query(
      `SELECT b.*, ss.name AS space_name, ss.emoji, u.full_name, u.email, u.student_id
       FROM bookings b
       JOIN study_spaces ss ON b.space_id = ss.id
       JOIN users u ON b.user_id = u.id
       ${where}
       ORDER BY b.created_at DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset]
    );
    const countRes = await query(`SELECT COUNT(*) FROM bookings b ${where}`, params);
    res.json({
      success: true, data: result.rows,
      meta: { total: parseInt(countRes.rows[0].count), page: parseInt(page), limit: parseInt(limit) },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch bookings' });
  }
};

// ── ADMIN: UPDATE BOOKING STATUS ──────────────────────────────────────────────

exports.updateBookingStatus = async (req, res) => {
  const { id }     = req.params;
  const { status, admin_notes } = req.body;
  const allowed    = ['confirmed', 'cancelled', 'completed', 'no_show'];
  if (!allowed.includes(status)) return res.status(400).json({ success: false, message: 'Invalid status' });
  try {
    const result = await query(
      `UPDATE bookings SET status = $1, admin_notes = COALESCE($2, admin_notes) WHERE id = $3 RETURNING *`,
      [status, admin_notes || null, id]
    );
    if (!result.rowCount) return res.status(404).json({ success: false, message: 'Booking not found' });
    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Update failed' });
  }
};

// ── DASHBOARD STATS ───────────────────────────────────────────────────────────

exports.getDashboardStats = async (req, res) => {
  try {
    const [spaces, bookings, todayBookings, topSpaces] = await Promise.all([
      query(`SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE is_active) AS active FROM study_spaces`),
      query(`SELECT status, COUNT(*) FROM bookings GROUP BY status`),
      query(`SELECT COUNT(*) FROM bookings WHERE booking_date = CURRENT_DATE AND status = 'confirmed'`),
      query(`SELECT ss.name, ss.emoji, COUNT(b.id) AS booking_count
             FROM bookings b JOIN study_spaces ss ON b.space_id = ss.id
             WHERE b.booking_date >= CURRENT_DATE - INTERVAL '30 days'
             GROUP BY ss.id ORDER BY booking_count DESC LIMIT 5`),
    ]);

    const statusMap = {};
    bookings.rows.forEach(r => { statusMap[r.status] = parseInt(r.count); });

    res.json({
      success: true,
      data: {
        spaces:       { total: parseInt(spaces.rows[0].total), active: parseInt(spaces.rows[0].active) },
        bookings:     { ...statusMap, total: Object.values(statusMap).reduce((a, b) => a + b, 0) },
        today:        parseInt(todayBookings.rows[0].count),
        top_spaces:   topSpaces.rows,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch stats' });
  }
};
