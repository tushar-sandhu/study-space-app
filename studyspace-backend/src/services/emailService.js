// src/services/emailService.js
const nodemailer = require('nodemailer');
const logger = require('../config/logger');

let transporter;

const getTransporter = () => {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host:   process.env.SMTP_HOST || 'smtp.gmail.com',
      port:   parseInt(process.env.SMTP_PORT) || 587,
      secure: process.env.SMTP_SECURE === 'true',
      auth:   { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
      pool:   true,
      maxConnections: 5,
    });
  }
  return transporter;
};

const FROM = process.env.EMAIL_FROM || 'StudySpace MAHE <noreply@mahe.edu>';
const FRONTEND = process.env.FRONTEND_URL || 'http://localhost:3000';

// ── Base template ─────────────────────────────────────────────────────────────

const baseTemplate = (content) => `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0">
  <style>
    body { margin: 0; padding: 0; background: #f0f4f8; font-family: 'Segoe UI', Arial, sans-serif; }
    .wrap { max-width: 600px; margin: 30px auto; background: #fff; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 24px rgba(0,0,0,.08); }
    .header { background: linear-gradient(135deg, #3b7eff, #00d4b4); padding: 32px 40px; text-align: center; }
    .header h1 { color: #fff; margin: 0; font-size: 22px; letter-spacing: -0.5px; }
    .header p  { color: rgba(255,255,255,.8); margin: 6px 0 0; font-size: 13px; }
    .body   { padding: 36px 40px; color: #2d3748; }
    .body p { font-size: 15px; line-height: 1.7; color: #4a5568; margin: 0 0 14px; }
    .card   { background: #f7fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 20px 24px; margin: 20px 0; }
    .row    { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #e2e8f0; font-size: 14px; }
    .row:last-child { border-bottom: none; }
    .row .label { color: #718096; }
    .row .value { font-weight: 600; color: #2d3748; }
    .btn    { display: inline-block; margin: 20px 0; padding: 14px 32px; background: linear-gradient(135deg,#3b7eff,#2563e0); color: #fff; text-decoration: none; border-radius: 10px; font-size: 15px; font-weight: 600; }
    .ref    { font-family: monospace; font-size: 16px; font-weight: 700; color: #3b7eff; background: #ebf4ff; border: 1px solid #bee3f8; border-radius: 8px; padding: 8px 16px; display: inline-block; }
    .footer { background: #f7fafc; padding: 20px 40px; text-align: center; font-size: 12px; color: #a0aec0; border-top: 1px solid #e2e8f0; }
    .badge  { display: inline-block; padding: 4px 12px; border-radius: 20px; font-size: 12px; font-weight: 600; }
    .badge-green  { background: #c6f6d5; color: #276749; }
    .badge-yellow { background: #fefcbf; color: #744210; }
    .badge-red    { background: #fed7d7; color: #9b2c2c; }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="header">
      <h1>🎓 StudySpace MAHE</h1>
      <p>Manipal Academy of Higher Education, Bengaluru</p>
    </div>
    <div class="body">${content}</div>
    <div class="footer">
      © ${new Date().getFullYear()} MAHE Bengaluru · <a href="${FRONTEND}" style="color:#3b7eff">StudySpace Portal</a><br>
      This is an automated message, please do not reply.
    </div>
  </div>
</body>
</html>`;

// ── Send helper ───────────────────────────────────────────────────────────────

const send = async ({ to, subject, html }) => {
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
    logger.debug('Email (no SMTP configured):', { to, subject });
    return;
  }
  try {
    const info = await getTransporter().sendMail({ from: FROM, to, subject, html });
    logger.info('Email sent', { to, subject, messageId: info.messageId });
  } catch (err) {
    logger.error('Email send failed', { to, subject, error: err.message });
  }
};

// ── Templates ─────────────────────────────────────────────────────────────────

exports.sendVerificationEmail = (email, name, token) =>
  send({
    to: email, subject: '✅ Verify your StudySpace account',
    html: baseTemplate(`
      <p>Hi <strong>${name}</strong>,</p>
      <p>Welcome to StudySpace at MAHE Bengaluru! Please verify your email address to get started.</p>
      <div style="text-align:center">
        <a href="${FRONTEND}/verify-email/${token}" class="btn">Verify Email Address</a>
      </div>
      <p style="font-size:13px;color:#718096">This link expires in 24 hours. If you didn't register, ignore this email.</p>
    `),
  });

exports.sendBookingConfirmation = (email, name, booking) =>
  send({
    to: email, subject: `✅ Booking Confirmed – ${booking.booking_ref}`,
    html: baseTemplate(`
      <p>Hi <strong>${name}</strong>,</p>
      <p>Your study space booking has been confirmed. Here are your details:</p>
      <div class="card">
        <div style="text-align:center;margin-bottom:16px"><span class="ref">${booking.booking_ref}</span></div>
        <table style="width:100%;border-collapse:collapse">
          ${[
            ['Space', `${booking.space_emoji || '📚'} ${booking.space_name}`],
            ['Date', booking.booking_date],
            ['Time', `${booking.start_time} – ${booking.end_time}`],
            ['Status', `<span class="badge badge-green">${booking.status?.toUpperCase()}</span>`],
          ].map(([l, v]) => `<tr class="row"><td class="label">${l}</td><td class="value">${v}</td></tr>`).join('')}
        </table>
      </div>
      <p>📌 <strong>Reminder:</strong> Please arrive on time. Spaces are automatically released after a 15-minute no-show window.</p>
      <div style="text-align:center">
        <a href="${FRONTEND}/bookings/${booking.id}" class="btn">View Booking</a>
      </div>
    `),
  });

exports.sendBookingCancellation = (email, name, booking) =>
  send({
    to: email, subject: `❌ Booking Cancelled – ${booking.booking_ref}`,
    html: baseTemplate(`
      <p>Hi <strong>${name}</strong>,</p>
      <p>Your booking <strong>${booking.booking_ref}</strong> for <strong>${booking.space_name}</strong> on ${booking.booking_date} at ${booking.start_time} has been cancelled.</p>
      ${booking.cancel_reason ? `<div class="card"><p style="margin:0"><strong>Reason:</strong> ${booking.cancel_reason}</p></div>` : ''}
      <p>You can book another slot anytime through the portal.</p>
      <div style="text-align:center"><a href="${FRONTEND}/booking" class="btn">Book Another Space</a></div>
    `),
  });

exports.sendBookingReminder = (email, name, booking) =>
  send({
    to: email, subject: `⏰ Reminder: Study session in 30 minutes`,
    html: baseTemplate(`
      <p>Hi <strong>${name}</strong>,</p>
      <p>This is a reminder that your study session starts in <strong>30 minutes</strong>.</p>
      <div class="card">
        <table style="width:100%;border-collapse:collapse">
          ${[
            ['Space', `${booking.space_emoji || '📚'} ${booking.space_name}`],
            ['Date',  booking.booking_date],
            ['Time',  `${booking.start_time} – ${booking.end_time}`],
            ['Ref',   booking.booking_ref],
          ].map(([l, v]) => `<tr class="row"><td class="label">${l}</td><td class="value">${v}</td></tr>`).join('')}
        </table>
      </div>
    `),
  });

exports.sendPasswordResetEmail = (email, name, token) =>
  send({
    to: email, subject: '🔐 Reset your StudySpace password',
    html: baseTemplate(`
      <p>Hi <strong>${name}</strong>,</p>
      <p>We received a request to reset your password. Click the button below to proceed:</p>
      <div style="text-align:center">
        <a href="${FRONTEND}/reset-password/${token}" class="btn">Reset Password</a>
      </div>
      <p style="font-size:13px;color:#718096">This link expires in 1 hour. If you didn't request this, please ignore this email. Your password will not be changed.</p>
    `),
  });

exports.sendFeedbackRequest = (email, name, booking) =>
  send({
    to: email, subject: `⭐ How was your session at ${booking.space_name}?`,
    html: baseTemplate(`
      <p>Hi <strong>${name}</strong>,</p>
      <p>Hope your study session at <strong>${booking.space_name}</strong> went well! We'd love to hear your feedback.</p>
      <div style="text-align:center">
        <a href="${FRONTEND}/feedback?space=${booking.space_id}&booking=${booking.id}" class="btn">Leave a Review</a>
      </div>
      <p style="font-size:13px;color:#718096">Your feedback helps other students find the best study spots.</p>
    `),
  });
