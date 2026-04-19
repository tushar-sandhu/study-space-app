// scripts/seed.js
require('dotenv').config();
const bcrypt = require('bcryptjs');
const { query, withTransaction } = require('../src/config/database');
const logger = require('../src/config/logger');

const SPACES = [
  { name: 'Central Library – Level 2', code: 'LIB-L2',   type: 'library',       capacity: 40, floor: 'Level 2', building: 'Central Library',    map_x: 52, map_y: 38, emoji: '📚', open_from: '08:00', open_until: '21:00',
    amenities: ['wifi','ac','power_outlets','quiet_zone'] },
  { name: 'Innovation Hub – Pod A',    code: 'IH-PA',    type: 'collaborative', capacity: 8,  floor: 'Ground',  building: 'Innovation Hub',      map_x: 30, map_y: 55, emoji: '💡', open_from: '08:00', open_until: '20:00',
    amenities: ['wifi','whiteboard','tv_screen','ac'] },
  { name: 'Innovation Hub – Pod B',    code: 'IH-PB',    type: 'collaborative', capacity: 8,  floor: 'Ground',  building: 'Innovation Hub',      map_x: 38, map_y: 55, emoji: '💡', open_from: '08:00', open_until: '20:00',
    amenities: ['wifi','whiteboard','tv_screen','ac'] },
  { name: 'Engineering Block – Study Hall', code: 'ENG-SH', type: 'study_hall', capacity: 60, floor: 'Level 1', building: 'Engineering Block',   map_x: 68, map_y: 30, emoji: '⚙️', open_from: '08:00', open_until: '22:00',
    amenities: ['wifi','ac','power_outlets'] },
  { name: 'MBA Block – Reading Room',  code: 'MBA-RR',   type: 'reading_room',  capacity: 25, floor: 'Ground',  building: 'MBA Block',           map_x: 22, map_y: 35, emoji: '📖', open_from: '09:00', open_until: '20:00',
    amenities: ['wifi','ac','quiet_zone','coffee_machine'] },
  { name: 'Open Terrace Lounge',       code: 'OTL-01',   type: 'outdoor',       capacity: 20, floor: 'Rooftop', building: 'Student Centre',      map_x: 75, map_y: 60, emoji: '🌿', open_from: '08:00', open_until: '19:00',
    amenities: ['wifi','natural_light','casual_seating'] },
  { name: 'Research Block – Seminar Room', code: 'RES-SR', type: 'seminar',     capacity: 30, floor: 'Level 2', building: 'Research Block',      map_x: 55, map_y: 65, emoji: '🔬', open_from: '09:00', open_until: '18:00',
    amenities: ['wifi','projector','ac','whiteboard'], requires_approval: true },
  { name: 'Student Centre – Group Room', code: 'SC-GR',  type: 'collaborative', capacity: 12, floor: 'Ground',  building: 'Student Centre',      map_x: 42, map_y: 72, emoji: '🤝', open_from: '08:00', open_until: '21:00',
    amenities: ['wifi','ac','whiteboard','tv_screen'] },
];

const USERS = [
  { student_id: '231040120', full_name: 'Arjun Mehta',   email: 'arjun.mehta@mahe.edu',   password: 'Student@123', role: 'student', department: 'Computer Science' },
  { student_id: '231040121', full_name: 'Priya Sharma',  email: 'priya.sharma@mahe.edu',  password: 'Student@123', role: 'student', department: 'MBA' },
  { student_id: '231040122', full_name: 'Kiran Reddy',   email: 'kiran.reddy@mahe.edu',   password: 'Student@123', role: 'student', department: 'Engineering' },
  { student_id: null,        full_name: 'Admin MAHE',    email: 'admin@mahe.edu',          password: 'Admin@Mahe2024', role: 'admin', department: 'Administration' },
  { student_id: 'STF001',    full_name: 'Dr. Ananya Rao',email: 'ananya.rao@mahe.edu',     password: 'Staff@123', role: 'staff', department: 'Library' },
];

const TIME_SLOT_HOURS = ['08:00','09:00','10:00','11:00','12:00','13:00','14:00','15:00','16:00','17:00','18:00','19:00','20:00'];

async function seed() {
  logger.info('🌱 Starting database seed...');

  await withTransaction(async (client) => {
    // Truncate in reverse dependency order
    await client.query(`TRUNCATE TABLE
      audit_log, notifications, reviews, bookings, time_slots,
      space_closures, space_amenities, study_spaces,
      password_reset_tokens, email_verification_tokens,
      refresh_tokens, users CASCADE`);
    logger.info('Cleared existing data');

    // ── Users ────────────────────────────────────────────────────────────────
    const userIds = {};
    for (const u of USERS) {
      const hash = await bcrypt.hash(u.password, 12);
      const res = await client.query(
        `INSERT INTO users (student_id, full_name, email, password_hash, role, department, is_verified, is_active)
         VALUES ($1,$2,$3,$4,$5,$6,TRUE,TRUE) RETURNING id`,
        [u.student_id, u.full_name, u.email, hash, u.role, u.department]
      );
      userIds[u.email] = res.rows[0].id;
      logger.info(`  User: ${u.full_name} (${u.role})`);
    }

    // ── Study Spaces ─────────────────────────────────────────────────────────
    const spaceIds = {};
    for (const s of SPACES) {
      const res = await client.query(
        `INSERT INTO study_spaces (name, code, space_type, capacity, floor, building, map_x, map_y, emoji, open_from, open_until, requires_approval)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
        [s.name, s.code, s.type, s.capacity, s.floor, s.building, s.map_x, s.map_y, s.emoji, s.open_from, s.open_until, s.requires_approval || false]
      );
      spaceIds[s.code] = res.rows[0].id;
      for (const amenity of s.amenities) {
        await client.query(`INSERT INTO space_amenities (space_id, amenity) VALUES ($1,$2)`, [res.rows[0].id, amenity]);
      }
      await client.query(`INSERT INTO space_rating_cache (space_id, avg_rating, review_count) VALUES ($1,0,0)`, [res.rows[0].id]);
      logger.info(`  Space: ${s.name}`);
    }

    // ── Time Slots (next 7 days) ──────────────────────────────────────────────
    let slotCount = 0;
    for (const [code, spaceId] of Object.entries(spaceIds)) {
      const space = SPACES.find(s => s.code === code);
      for (let d = 0; d < 7; d++) {
        const date = new Date();
        date.setDate(date.getDate() + d);
        const dateStr = date.toISOString().split('T')[0];
        for (const hour of TIME_SLOT_HOURS) {
          const [h] = hour.split(':').map(Number);
          const endH = String(h + 1).padStart(2, '0') + ':00';
          const openH = parseInt(space.open_from);
          const closeH = parseInt(space.open_until);
          if (h < openH || h >= closeH) continue;
          const isAvail = Math.random() > 0.3;
          await client.query(
            `INSERT INTO time_slots (space_id, slot_date, start_time, end_time, is_available) VALUES ($1,$2,$3,$4,$5)`,
            [spaceId, dateStr, hour, endH, isAvail]
          );
          slotCount++;
        }
      }
    }
    logger.info(`  Generated ${slotCount} time slots`);

    // ── Sample Bookings ───────────────────────────────────────────────────────
    const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
    const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1);
    const sampleBookings = [
      { user: 'arjun.mehta@mahe.edu', code: 'LIB-L2', date: yesterday.toISOString().split('T')[0], start: '10:00', end: '11:00', status: 'completed' },
      { user: 'arjun.mehta@mahe.edu', code: 'MBA-RR', date: tomorrow.toISOString().split('T')[0],   start: '14:00', end: '15:00', status: 'confirmed' },
      { user: 'priya.sharma@mahe.edu', code: 'IH-PA', date: tomorrow.toISOString().split('T')[0],   start: '11:00', end: '12:00', status: 'confirmed' },
    ];
    for (const b of sampleBookings) {
      await client.query(
        `INSERT INTO bookings (user_id, space_id, booking_date, start_time, end_time, status, purpose)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [userIds[b.user], spaceIds[b.code], b.date, b.start, b.end, b.status, 'Study session']
      );
    }
    logger.info(`  Created ${sampleBookings.length} sample bookings`);

    // ── Sample Reviews ─────────────────────────────────────────────────────────
    const sampleReviews = [
      { user: 'arjun.mehta@mahe.edu', code: 'LIB-L2', rating: 5, comment: 'Perfect quiet zone. Best library on campus!' },
      { user: 'priya.sharma@mahe.edu', code: 'IH-PA', rating: 4, comment: 'Great for group projects, whiteboard is huge.' },
      { user: 'kiran.reddy@mahe.edu',  code: 'MBA-RR', rating: 5, comment: 'Love the coffee machine! Very calm space.' },
      { user: 'arjun.mehta@mahe.edu', code: 'ENG-SH',  rating: 4, comment: 'Spacious and always has seats available.' },
    ];
    for (const r of sampleReviews) {
      await client.query(
        `INSERT INTO reviews (user_id, space_id, rating, comment) VALUES ($1,$2,$3,$4)`,
        [userIds[r.user], spaceIds[r.code], r.rating, r.comment]
      );
    }
    logger.info(`  Created ${sampleReviews.length} sample reviews`);

    // ── Notifications ──────────────────────────────────────────────────────────
    const arjunId = userIds['arjun.mehta@mahe.edu'];
    await client.query(
      `INSERT INTO notifications (user_id, type, title, message, is_read) VALUES
        ($1,'booking_confirmed','Booking Confirmed! ✅','Your booking for MBA Block – Reading Room is confirmed.',FALSE),
        ($1,'booking_reminder','Upcoming Session ⏰','You have a study session in 30 minutes.',FALSE),
        ($1,'announcement','New Space Available 🆕','The Research Block – Seminar Room is now open for bookings.',TRUE)`,
      [arjunId]
    );
    logger.info('  Created sample notifications');
  });

  logger.info('✅ Seed complete!');
  process.exit(0);
}

seed().catch((err) => { logger.error('Seed failed', { error: err.message }); process.exit(1); });
