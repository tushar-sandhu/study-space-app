// src/services/notificationService.js
const { query } = require('../config/database');
const { cache } = require('../config/redis');
const emailService = require('./emailService');
const logger = require('../config/logger');

/**
 * Persist a notification to DB and push via WebSocket
 */
exports.createNotification = async ({ userId, type, title, message, bookingId = null, data = null }) => {
  try {
    const result = await query(
      `INSERT INTO notifications (user_id, type, title, message, booking_id, data)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [userId, type, title, message, bookingId, data ? JSON.stringify(data) : null]
    );
    const notification = result.rows[0];

    // Publish to Redis so WebSocket server can push to connected clients
    await cache.publish(`user-notifications:${userId}`, notification);

    return notification;
  } catch (err) {
    logger.error('Create notification error', { error: err.message, userId, type });
  }
};

// ── SCHEDULER ─────────────────────────────────────────────────────────────────

/**
 * Send 30-minute reminders for upcoming bookings.
 * Should be called every minute by a cron-like setInterval.
 */
exports.sendReminders = async () => {
  try {
    const result = await query(
      `SELECT b.*, ss.name AS space_name, ss.emoji AS space_emoji,
              u.full_name, u.email
       FROM bookings b
       JOIN study_spaces ss ON b.space_id = ss.id
       JOIN users u ON b.user_id = u.id
       WHERE b.status = 'confirmed'
         AND b.reminder_sent = FALSE
         AND (b.booking_date + b.start_time::TIME) BETWEEN NOW() + INTERVAL '28 minutes' AND NOW() + INTERVAL '32 minutes'`
    );

    for (const booking of result.rows) {
      try {
        await exports.createNotification({
          userId:    booking.user_id,
          type:      'booking_reminder',
          title:     '⏰ Session starting soon',
          message:   `Your booking at ${booking.space_name} starts in 30 minutes.`,
          bookingId: booking.id,
        });
        await emailService.sendBookingReminder(booking.email, booking.full_name, booking);
        await query('UPDATE bookings SET reminder_sent = TRUE WHERE id = $1', [booking.id]);
        logger.info('Reminder sent', { bookingId: booking.id, userId: booking.user_id });
      } catch (err) {
        logger.error('Reminder error', { bookingId: booking.id, error: err.message });
      }
    }
  } catch (err) {
    logger.error('sendReminders error', { error: err.message });
  }
};

/**
 * Auto-cancel bookings with no check-in after grace period.
 */
exports.autoCancelNoShows = async () => {
  const grace = parseInt(process.env.AUTO_CANCEL_MINUTES || 20);
  try {
    const result = await query(
      `UPDATE bookings SET status = 'no_show'
       WHERE status = 'confirmed'
         AND checked_in_at IS NULL
         AND (booking_date + start_time::TIME) < NOW() - ($1 || ' minutes')::INTERVAL
       RETURNING id, user_id, space_id, slot_id, booking_date, start_time, booking_ref`,
      [grace]
    );

    for (const b of result.rows) {
      // Release slot
      if (b.slot_id) {
        await query('UPDATE time_slots SET is_available = TRUE WHERE id = $1', [b.slot_id]);
      }
      await cache.delPattern(`avail:${b.space_id}:*`);

      await exports.createNotification({
        userId:    b.user_id,
        type:      'booking_cancelled',
        title:     '🚫 Booking Marked as No-Show',
        message:   `Your booking (${b.booking_ref}) was marked as no-show because check-in was not completed.`,
        bookingId: b.id,
      });
    }

    if (result.rowCount > 0)
      logger.info(`Auto-cancelled ${result.rowCount} no-show bookings`);
  } catch (err) {
    logger.error('autoCancelNoShows error', { error: err.message });
  }
};

/**
 * Mark past confirmed bookings as completed.
 */
exports.markCompletedBookings = async () => {
  try {
    const result = await query(
      `UPDATE bookings SET status = 'completed'
       WHERE status = 'confirmed'
         AND checked_in_at IS NOT NULL
         AND (booking_date + end_time::TIME) < NOW()
       RETURNING id, user_id, space_id, space_id AS sid`,
    );
    // Trigger feedback request emails
    for (const b of result.rows) {
      const data = await query(
        `SELECT u.email, u.full_name, ss.name AS space_name, b.id, b.space_id, b.booking_ref
         FROM bookings b JOIN users u ON b.user_id = u.id JOIN study_spaces ss ON b.space_id = ss.id
         WHERE b.id = $1`, [b.id]
      );
      if (data.rowCount) {
        const row = data.rows[0];
        emailService.sendFeedbackRequest(row.email, row.full_name, row)
          .catch(err => logger.error('Feedback email error', { error: err.message }));
      }
    }
    if (result.rowCount > 0)
      logger.info(`Marked ${result.rowCount} bookings as completed`);
  } catch (err) {
    logger.error('markCompletedBookings error', { error: err.message });
  }
};

/**
 * Generate time slots for the next N days for all active spaces.
 * Run daily at midnight.
 */
exports.generateFutureSlots = async (daysAhead = 7) => {
  try {
    const spaces = await query(
      `SELECT id, open_from, open_until FROM study_spaces WHERE is_active = TRUE`
    );

    const HOURS = ['08','09','10','11','12','13','14','15','16','17','18','19','20'];
    let created = 0;

    for (const space of spaces.rows) {
      const openH  = parseInt(space.open_from);
      const closeH = parseInt(space.open_until);

      for (let d = 0; d <= daysAhead; d++) {
        const date = new Date();
        date.setDate(date.getDate() + d);
        const dateStr = date.toISOString().split('T')[0];

        for (const h of HOURS) {
          const hour = parseInt(h);
          if (hour < openH || hour >= closeH) continue;
          const start  = `${h}:00`;
          const endH   = String(hour + 1).padStart(2, '0');
          const end    = `${endH}:00`;

          await query(
            `INSERT INTO time_slots (space_id, slot_date, start_time, end_time, is_available)
             VALUES ($1,$2,$3,$4,TRUE) ON CONFLICT (space_id, slot_date, start_time) DO NOTHING`,
            [space.id, dateStr, start, end]
          );
          created++;
        }
      }
    }
    logger.info(`generateFutureSlots: ${created} slots ensured`);
  } catch (err) {
    logger.error('generateFutureSlots error', { error: err.message });
  }
};

/**
 * Start all background jobs.
 */
exports.startScheduler = () => {
  // Every 2 minutes: reminders + no-show detection
  setInterval(async () => {
    await exports.sendReminders();
    await exports.autoCancelNoShows();
    await exports.markCompletedBookings();
  }, 2 * 60 * 1000);

  // Every 6 hours: ensure future slots exist
  setInterval(() => exports.generateFutureSlots(7), 6 * 60 * 60 * 1000);

  // Run immediately on start
  exports.generateFutureSlots(7).catch(() => {});

  logger.info('Background scheduler started');
};
