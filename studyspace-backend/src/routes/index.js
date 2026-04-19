// src/routes/index.js
const express = require('express');
const router  = express.Router();

router.use('/auth',          require('./authRoutes'));
router.use('/spaces',        require('./spacesRoutes'));
router.use('/bookings',      require('./bookingsRoutes'));
router.use('/notifications', require('./notificationsRoutes'));
router.use('/reviews',       require('./reviewsRoutes'));
router.use('/admin',         require('./adminRoutes'));

// Health check
router.get('/health', (req, res) => {
  res.json({
    success: true,
    status:  'healthy',
    service: 'StudySpace MAHE API',
    version: process.env.npm_package_version || '1.0.0',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
  });
});

module.exports = router;


// ═══════════════════════════════════════════════════════════════════════════
// src/routes/authRoutes.js
// ═══════════════════════════════════════════════════════════════════════════

const authRouter  = express.Router();
const authCtrl    = require('../controllers/authController');
const { authenticate } = require('../middleware/auth');
const v           = require('../middleware/validate');
const { authLimiter } = require('../middleware/errorHandler');

// Public
authRouter.post('/register',         authLimiter, v.register,        authCtrl.register);
authRouter.post('/login',            authLimiter, v.login,           authCtrl.login);
authRouter.post('/refresh',                                           authCtrl.refreshToken);
authRouter.get ('/verify/:token',                                     authCtrl.verifyEmail);
authRouter.post('/forgot-password',  authLimiter, v.forgotPassword,  authCtrl.forgotPassword);
authRouter.post('/reset-password',   authLimiter, v.resetPassword,   authCtrl.resetPassword);

// Protected
authRouter.post('/logout',           authenticate, authCtrl.logout);
authRouter.get ('/me',               authenticate, authCtrl.getMe);
authRouter.patch('/me',              authenticate, authCtrl.updateProfile);
authRouter.post('/change-password',  authenticate, v.changePassword, authCtrl.changePassword);

module.exports = authRouter;


// ═══════════════════════════════════════════════════════════════════════════
// src/routes/spacesRoutes.js
// ═══════════════════════════════════════════════════════════════════════════

const spacesRouter = express.Router();
const spacesCtrl   = require('../controllers/spacesController');
const { authenticate, requireRole, optionalAuth } = require('../middleware/auth');
const vs           = require('../middleware/validate');

// Public (optional auth for personalisation)
spacesRouter.get('/',                    optionalAuth, spacesCtrl.listSpaces);
spacesRouter.get('/:id',                 vs.idParam,   spacesCtrl.getSpace);
spacesRouter.get('/:id/availability',    vs.idParam, vs.availabilityQuery, spacesCtrl.getAvailability);
spacesRouter.get('/:id/availability/week', vs.idParam, spacesCtrl.getWeeklyAvailability);
spacesRouter.get('/:id/reviews',         vs.idParam,   spacesCtrl.getSpaceReviews);

// Admin / Staff
spacesRouter.post('/',                   authenticate, requireRole('admin','staff'), vs.createSpace, spacesCtrl.createSpace);
spacesRouter.patch('/:id',               authenticate, requireRole('admin','staff'), vs.idParam,     spacesCtrl.updateSpace);
spacesRouter.post('/:id/closures',       authenticate, requireRole('admin','staff'), vs.idParam,     spacesCtrl.addClosure);

module.exports = spacesRouter;


// ═══════════════════════════════════════════════════════════════════════════
// src/routes/bookingsRoutes.js
// ═══════════════════════════════════════════════════════════════════════════

const bookingsRouter = express.Router();
const bookCtrl       = require('../controllers/bookingsController');
const { authenticate, requireRole } = require('../middleware/auth');
const vb             = require('../middleware/validate');
const { bookingLimiter } = require('../middleware/errorHandler');

bookingsRouter.use(authenticate);

// Student
bookingsRouter.post('/',            bookingLimiter, vb.createBooking,  bookCtrl.createBooking);
bookingsRouter.get('/my',                                               bookCtrl.getMyBookings);
bookingsRouter.get('/:id',          vb.idParam,                        bookCtrl.getBooking);
bookingsRouter.post('/:id/cancel',  vb.cancelBooking,                  bookCtrl.cancelBooking);
bookingsRouter.post('/:id/checkin', vb.idParam,                        bookCtrl.checkIn);

// Admin / Staff
bookingsRouter.get('/',             requireRole('admin','staff'),       bookCtrl.getAllBookings);
bookingsRouter.patch('/:id/status', requireRole('admin','staff'), vb.idParam, bookCtrl.updateBookingStatus);
bookingsRouter.get('/stats/dashboard', requireRole('admin','staff'),   bookCtrl.getDashboardStats);

module.exports = bookingsRouter;


// ═══════════════════════════════════════════════════════════════════════════
// src/routes/notificationsRoutes.js
// ═══════════════════════════════════════════════════════════════════════════

const notifRouter = express.Router();
const notifCtrl   = require('../controllers/notificationsController');
const { authenticate } = require('../middleware/auth');

notifRouter.use(authenticate);

notifRouter.get('/',            notifCtrl.getNotifications);
notifRouter.post('/mark-all-read', notifCtrl.markAllRead);
notifRouter.patch('/:id/read', notifCtrl.markRead);
notifRouter.delete('/:id',     notifCtrl.deleteNotification);

module.exports = notifRouter;


// ═══════════════════════════════════════════════════════════════════════════
// src/routes/reviewsRoutes.js
// ═══════════════════════════════════════════════════════════════════════════

const reviewsRouter = express.Router();
const { createReview, updateReview, deleteReview, getMyReviews } = require('../controllers/notificationsController');
const { authenticate } = require('../middleware/auth');
const vr = require('../middleware/validate');

reviewsRouter.use(authenticate);
reviewsRouter.post('/',       vr.createReview, createReview);
reviewsRouter.get('/my',                       getMyReviews);
reviewsRouter.patch('/:id',   vr.updateReview, updateReview);
reviewsRouter.delete('/:id',  vr.idParam,      deleteReview);

module.exports = reviewsRouter;


// ═══════════════════════════════════════════════════════════════════════════
// src/routes/adminRoutes.js
// ═══════════════════════════════════════════════════════════════════════════

const adminRouter = express.Router();
const { query } = require('../config/database');
const { authenticate, requireRole } = require('../middleware/auth');

adminRouter.use(authenticate, requireRole('admin'));

// Users management
adminRouter.get('/users', async (req, res) => {
  try {
    const { search, role, page = 1, limit = 30 } = req.query;
    const offset = (page - 1) * limit;
    const params = [];
    const conditions = [];
    if (search) { params.push(`%${search}%`); conditions.push(`(full_name ILIKE $${params.length} OR email ILIKE $${params.length} OR student_id ILIKE $${params.length})`); }
    if (role)   { params.push(role);           conditions.push(`role = $${params.length}`); }
    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
    const result = await query(
      `SELECT id, student_id, full_name, email, role, department, is_active, is_verified, created_at, last_login_at
       FROM users ${where} ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset]
    );
    const count = await query(`SELECT COUNT(*) FROM users ${where}`, params);
    res.json({ success: true, data: result.rows, meta: { total: parseInt(count.rows[0].count) } });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch users' });
  }
});

adminRouter.patch('/users/:id/toggle-active', async (req, res) => {
  try {
    const result = await query(
      `UPDATE users SET is_active = NOT is_active WHERE id = $1 RETURNING id, is_active, full_name`,
      [req.params.id]
    );
    if (!result.rowCount) return res.status(404).json({ success: false, message: 'User not found' });
    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Update failed' });
  }
});

adminRouter.patch('/users/:id/role', async (req, res) => {
  const { role } = req.body;
  if (!['student','staff','admin'].includes(role))
    return res.status(400).json({ success: false, message: 'Invalid role' });
  try {
    const result = await query(
      `UPDATE users SET role = $1 WHERE id = $2 RETURNING id, full_name, role`,
      [role, req.params.id]
    );
    if (!result.rowCount) return res.status(404).json({ success: false, message: 'User not found' });
    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Update failed' });
  }
});

// Analytics
adminRouter.get('/analytics', async (req, res) => {
  try {
    const [
      bookingsByDay, bookingsBySpace, bookingsByStatus,
      peakHours, reviewStats, userGrowth
    ] = await Promise.all([
      query(`SELECT booking_date, COUNT(*) FROM bookings WHERE booking_date >= CURRENT_DATE - 30 GROUP BY booking_date ORDER BY booking_date`),
      query(`SELECT ss.name, ss.emoji, COUNT(b.id) AS bookings FROM bookings b JOIN study_spaces ss ON b.space_id = ss.id WHERE b.booking_date >= CURRENT_DATE - 30 GROUP BY ss.id ORDER BY bookings DESC`),
      query(`SELECT status, COUNT(*) FROM bookings GROUP BY status`),
      query(`SELECT start_time, COUNT(*) FROM bookings WHERE booking_date >= CURRENT_DATE - 30 GROUP BY start_time ORDER BY start_time`),
      query(`SELECT ss.name, ROUND(AVG(r.rating)::NUMERIC, 2) AS avg, COUNT(r.id) AS count FROM reviews r JOIN study_spaces ss ON r.space_id = ss.id GROUP BY ss.id ORDER BY avg DESC`),
      query(`SELECT DATE_TRUNC('week', created_at) AS week, COUNT(*) FROM users WHERE created_at >= NOW() - INTERVAL '90 days' GROUP BY week ORDER BY week`),
    ]);
    res.json({
      success: true,
      data: {
        bookings_by_day:    bookingsByDay.rows,
        bookings_by_space:  bookingsBySpace.rows,
        bookings_by_status: bookingsByStatus.rows,
        peak_hours:         peakHours.rows,
        review_stats:       reviewStats.rows,
        user_growth:        userGrowth.rows,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Analytics query failed' });
  }
});

// Broadcast announcement to all users
adminRouter.post('/announce', async (req, res) => {
  const { title, message } = req.body;
  if (!title || !message) return res.status(400).json({ success: false, message: 'title and message required' });
  try {
    const users = await query('SELECT id FROM users WHERE is_active = TRUE');
    const notifService = require('../services/notificationService');
    for (const u of users.rows) {
      await notifService.createNotification({ userId: u.id, type: 'announcement', title, message });
    }
    res.json({ success: true, message: `Announcement sent to ${users.rowCount} users` });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to send announcement' });
  }
});

module.exports = adminRouter;
