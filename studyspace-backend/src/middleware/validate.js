// src/middleware/validate.js
const { body, param, query, validationResult } = require('express-validator');

/** Run validation rules and return 422 on failure */
const validate = (rules) => [
  ...rules,
  (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty())
      return res.status(422).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array().map(e => ({ field: e.path, message: e.msg })),
      });
    next();
  },
];

// ── AUTH ──────────────────────────────────────────────────────────────────────

exports.register = validate([
  body('full_name').trim().notEmpty().isLength({ min: 2, max: 100 }).withMessage('Full name must be 2–100 characters'),
  body('email').isEmail().normalizeEmail().withMessage('Valid email required')
    .matches(/@(mahe|manipal)\.edu$/i).withMessage('Must use a valid MAHE email address'),
  body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters')
    .matches(/[A-Z]/).withMessage('Must contain at least one uppercase letter')
    .matches(/[0-9]/).withMessage('Must contain at least one number'),
  body('student_id').optional().trim().isLength({ max: 20 }),
  body('department').optional().trim().isLength({ max: 100 }),
  body('phone').optional().isMobilePhone().withMessage('Invalid phone number'),
]);

exports.login = validate([
  body('email').isEmail().normalizeEmail().withMessage('Valid email required'),
  body('password').notEmpty().withMessage('Password required'),
]);

exports.forgotPassword = validate([
  body('email').isEmail().normalizeEmail(),
]);

exports.resetPassword = validate([
  body('token').notEmpty(),
  body('new_password').isLength({ min: 8 }).matches(/[A-Z]/).matches(/[0-9]/),
]);

exports.changePassword = validate([
  body('current_password').notEmpty(),
  body('new_password').isLength({ min: 8 }).matches(/[A-Z]/).matches(/[0-9]/),
]);

// ── BOOKINGS ──────────────────────────────────────────────────────────────────

exports.createBooking = validate([
  body('space_id').isUUID().withMessage('Valid space ID required'),
  body('booking_date').isDate({ format: 'YYYY-MM-DD' }).withMessage('Valid date required (YYYY-MM-DD)'),
  body('start_time').matches(/^([01]\d|2[0-3]):[0-5]\d$/).withMessage('Valid start time required (HH:MM)'),
  body('end_time').matches(/^([01]\d|2[0-3]):[0-5]\d$/).withMessage('Valid end time required (HH:MM)')
    .custom((end, { req }) => {
      if (end <= req.body.start_time) throw new Error('End time must be after start time');
      return true;
    }),
  body('attendees_count').optional().isInt({ min: 1, max: 60 }).withMessage('Attendees must be between 1 and 60'),
  body('purpose').optional().trim().isLength({ max: 200 }),
]);

exports.cancelBooking = validate([
  param('id').isUUID().withMessage('Valid booking ID required'),
  body('reason').optional().trim().isLength({ max: 300 }),
]);

// ── REVIEWS ───────────────────────────────────────────────────────────────────

exports.createReview = validate([
  body('space_id').isUUID().withMessage('Valid space ID required'),
  body('booking_id').optional().isUUID(),
  body('rating').isInt({ min: 1, max: 5 }).withMessage('Rating must be 1–5'),
  body('comment').optional().trim().isLength({ max: 1000 }),
]);

exports.updateReview = validate([
  param('id').isUUID(),
  body('rating').optional().isInt({ min: 1, max: 5 }),
  body('comment').optional().trim().isLength({ max: 1000 }),
]);

// ── SPACES ────────────────────────────────────────────────────────────────────

exports.createSpace = validate([
  body('name').trim().notEmpty().isLength({ max: 150 }),
  body('code').trim().notEmpty().isLength({ max: 20 }).matches(/^[A-Z0-9-]+$/i),
  body('space_type').isIn(['library','collaborative','study_hall','reading_room','seminar','outdoor','lab']),
  body('capacity').isInt({ min: 1, max: 500 }),
  body('map_x').isFloat({ min: 0, max: 100 }),
  body('map_y').isFloat({ min: 0, max: 100 }),
  body('open_from').matches(/^([01]\d|2[0-3]):[0-5]\d$/),
  body('open_until').matches(/^([01]\d|2[0-3]):[0-5]\d$/),
  body('amenities').optional().isArray(),
]);

exports.availabilityQuery = validate([
  query('date').isDate({ format: 'YYYY-MM-DD' }).withMessage('date query param required (YYYY-MM-DD)'),
]);

exports.idParam = validate([
  param('id').isUUID().withMessage('Valid ID required'),
]);
