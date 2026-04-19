// tests/auth.test.js
const request = require('supertest');
const app     = require('../src/app');
const { query, pool } = require('../src/config/database');

let accessToken;
let refreshToken;
let testUserId;

const TEST_USER = {
  full_name:  'Test Student',
  email:      'test.student@mahe.edu',
  password:   'TestPass1',
  student_id: 'TEST001',
  department: 'Computer Science',
};

afterAll(async () => {
  await query('DELETE FROM users WHERE email = $1', [TEST_USER.email]).catch(() => {});
  await pool.end();
});

describe('POST /api/v1/auth/register', () => {
  it('registers a new user successfully', async () => {
    const res = await request(app).post('/api/v1/auth/register').send(TEST_USER);
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.email).toBe(TEST_USER.email);
  });

  it('rejects duplicate email', async () => {
    const res = await request(app).post('/api/v1/auth/register').send(TEST_USER);
    expect(res.status).toBe(409);
  });

  it('rejects non-MAHE email', async () => {
    const res = await request(app).post('/api/v1/auth/register').send({ ...TEST_USER, email: 'foo@gmail.com' });
    expect(res.status).toBe(422);
    expect(res.body.errors[0].field).toBe('email');
  });

  it('rejects weak password', async () => {
    const res = await request(app).post('/api/v1/auth/register').send({ ...TEST_USER, email: 'a@mahe.edu', password: '123' });
    expect(res.status).toBe(422);
  });
});

describe('POST /api/v1/auth/login', () => {
  beforeAll(async () => {
    // Manually verify the test user
    await query('UPDATE users SET is_verified = TRUE WHERE email = $1', [TEST_USER.email]);
  });

  it('logs in successfully', async () => {
    const res = await request(app).post('/api/v1/auth/login').send({ email: TEST_USER.email, password: TEST_USER.password });
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('access_token');
    expect(res.body.data).toHaveProperty('refresh_token');
    accessToken  = res.body.data.access_token;
    refreshToken = res.body.data.refresh_token;
    testUserId   = res.body.data.user.id;
  });

  it('rejects wrong password', async () => {
    const res = await request(app).post('/api/v1/auth/login').send({ email: TEST_USER.email, password: 'WrongPass1' });
    expect(res.status).toBe(401);
  });

  it('rejects unknown email', async () => {
    const res = await request(app).post('/api/v1/auth/login').send({ email: 'nobody@mahe.edu', password: 'Test1234' });
    expect(res.status).toBe(401);
  });
});

describe('GET /api/v1/auth/me', () => {
  it('returns current user with valid token', async () => {
    const res = await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.email).toBe(TEST_USER.email);
  });

  it('returns 401 without token', async () => {
    const res = await request(app).get('/api/v1/auth/me');
    expect(res.status).toBe(401);
  });
});

describe('POST /api/v1/auth/refresh', () => {
  it('issues new tokens', async () => {
    const res = await request(app).post('/api/v1/auth/refresh').send({ refresh_token: refreshToken });
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('access_token');
    accessToken  = res.body.data.access_token;
    refreshToken = res.body.data.refresh_token;
  });

  it('rejects used/invalid refresh token', async () => {
    const res = await request(app).post('/api/v1/auth/refresh').send({ refresh_token: 'invalid-token' });
    expect(res.status).toBe(401);
  });
});

describe('POST /api/v1/auth/logout', () => {
  it('logs out successfully', async () => {
    const res = await request(app)
      .post('/api/v1/auth/logout')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ refresh_token: refreshToken });
    expect(res.status).toBe(200);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// tests/spaces.test.js
// ═══════════════════════════════════════════════════════════════════════════

describe('Spaces API', () => {
  let token;

  beforeAll(async () => {
    await query('UPDATE users SET is_verified = TRUE WHERE email = $1', [TEST_USER.email]).catch(() => {});
    const res = await request(app).post('/api/v1/auth/login').send({ email: TEST_USER.email, password: TEST_USER.password });
    token = res.body.data?.access_token;
  });

  describe('GET /api/v1/spaces', () => {
    it('returns list of spaces', async () => {
      const res = await request(app).get('/api/v1/spaces');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.meta).toHaveProperty('total');
    });

    it('filters by type', async () => {
      const res = await request(app).get('/api/v1/spaces?type=library');
      expect(res.status).toBe(200);
      res.body.data.forEach(s => expect(s.space_type).toBe('library'));
    });

    it('searches by name', async () => {
      const res = await request(app).get('/api/v1/spaces?search=library');
      expect(res.status).toBe(200);
    });

    it('paginates results', async () => {
      const res = await request(app).get('/api/v1/spaces?page=1&limit=2');
      expect(res.status).toBe(200);
      expect(res.body.data.length).toBeLessThanOrEqual(2);
    });
  });

  describe('GET /api/v1/spaces/:id', () => {
    it('returns a specific space', async () => {
      const list = await request(app).get('/api/v1/spaces');
      const spaceId = list.body.data[0]?.id;
      if (!spaceId) return;
      const res = await request(app).get(`/api/v1/spaces/${spaceId}`);
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveProperty('amenities');
      expect(res.body.data).toHaveProperty('avg_rating');
    });

    it('returns 404 for unknown space', async () => {
      const res = await request(app).get('/api/v1/spaces/00000000-0000-0000-0000-000000000000');
      expect(res.status).toBe(404);
    });
  });

  describe('GET /api/v1/spaces/:id/availability', () => {
    it('requires date param', async () => {
      const list = await request(app).get('/api/v1/spaces');
      const spaceId = list.body.data[0]?.id;
      if (!spaceId) return;
      const res = await request(app).get(`/api/v1/spaces/${spaceId}/availability`);
      expect(res.status).toBe(422);
    });

    it('returns slot availability', async () => {
      const list = await request(app).get('/api/v1/spaces');
      const spaceId = list.body.data[0]?.id;
      if (!spaceId) return;
      const today = new Date().toISOString().split('T')[0];
      const res   = await request(app).get(`/api/v1/spaces/${spaceId}/availability?date=${today}`);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data.slots)).toBe(true);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// tests/bookings.test.js
// ═══════════════════════════════════════════════════════════════════════════

describe('Bookings API', () => {
  let token;
  let spaceId;
  let bookingId;

  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const bookingDate = tomorrow.toISOString().split('T')[0];

  beforeAll(async () => {
    await query('UPDATE users SET is_verified = TRUE WHERE email = $1', [TEST_USER.email]).catch(() => {});
    const loginRes = await request(app).post('/api/v1/auth/login').send({ email: TEST_USER.email, password: TEST_USER.password });
    token = loginRes.body.data?.access_token;

    const spacesRes = await request(app).get('/api/v1/spaces?type=library');
    spaceId = spacesRes.body.data[0]?.id;
  });

  describe('POST /api/v1/bookings', () => {
    it('creates a booking', async () => {
      if (!spaceId) return;
      const res = await request(app)
        .post('/api/v1/bookings')
        .set('Authorization', `Bearer ${token}`)
        .send({ space_id: spaceId, booking_date: bookingDate, start_time: '10:00', end_time: '11:00', purpose: 'Study session' });
      expect(res.status).toBe(201);
      expect(res.body.data).toHaveProperty('booking_ref');
      bookingId = res.body.data.id;
    });

    it('rejects booking in the past', async () => {
      const res = await request(app)
        .post('/api/v1/bookings')
        .set('Authorization', `Bearer ${token}`)
        .send({ space_id: spaceId, booking_date: '2020-01-01', start_time: '10:00', end_time: '11:00' });
      expect(res.status).toBe(400);
    });

    it('rejects duplicate slot', async () => {
      if (!spaceId) return;
      const res = await request(app)
        .post('/api/v1/bookings')
        .set('Authorization', `Bearer ${token}`)
        .send({ space_id: spaceId, booking_date: bookingDate, start_time: '10:00', end_time: '11:00' });
      expect([409, 400]).toContain(res.status);
    });

    it('requires authentication', async () => {
      const res = await request(app).post('/api/v1/bookings').send({});
      expect(res.status).toBe(401);
    });
  });

  describe('GET /api/v1/bookings/my', () => {
    it('returns user bookings', async () => {
      const res = await request(app).get('/api/v1/bookings/my').set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
    });
  });

  describe('GET /api/v1/bookings/:id', () => {
    it('returns specific booking', async () => {
      if (!bookingId) return;
      const res = await request(app).get(`/api/v1/bookings/${bookingId}`).set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body.data.id).toBe(bookingId);
    });
  });

  describe('POST /api/v1/bookings/:id/cancel', () => {
    it('cancels a booking', async () => {
      if (!bookingId) return;
      // Set start time far in future so cancellation is allowed
      await query(`UPDATE bookings SET start_time = '23:00', end_time = '23:59' WHERE id = $1`, [bookingId]);
      const res = await request(app)
        .post(`/api/v1/bookings/${bookingId}/cancel`)
        .set('Authorization', `Bearer ${token}`)
        .send({ reason: 'Test cancel' });
      expect(res.status).toBe(200);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// tests/notifications.test.js
// ═══════════════════════════════════════════════════════════════════════════

describe('Notifications API', () => {
  let token;

  beforeAll(async () => {
    await query('UPDATE users SET is_verified = TRUE WHERE email = $1', [TEST_USER.email]).catch(() => {});
    const res = await request(app).post('/api/v1/auth/login').send({ email: TEST_USER.email, password: TEST_USER.password });
    token = res.body.data?.access_token;
  });

  it('GET /api/v1/notifications returns list', async () => {
    const res = await request(app).get('/api/v1/notifications').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.meta).toHaveProperty('unread');
  });

  it('POST /api/v1/notifications/mark-all-read marks all read', async () => {
    const res = await request(app).post('/api/v1/notifications/mark-all-read').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// tests/health.test.js
// ═══════════════════════════════════════════════════════════════════════════

describe('Health Check', () => {
  it('GET /api/v1/health returns 200', async () => {
    const res = await request(app).get('/api/v1/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('healthy');
  });

  it('unknown route returns 404', async () => {
    const res = await request(app).get('/api/v1/does-not-exist');
    expect(res.status).toBe(404);
  });
});
