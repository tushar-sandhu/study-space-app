# StudySpace MAHE Bengaluru – Backend API Documentation

**Base URL:** `http://localhost:5000/api/v1`
**WebSocket:** `ws://localhost:5000/ws`

---

## Authentication

All protected endpoints require:
```
Authorization: Bearer <access_token>
```

---

## Endpoints

### 🔐 Auth

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/auth/register` | ❌ | Register (MAHE email required) |
| POST | `/auth/login` | ❌ | Login → access + refresh token |
| POST | `/auth/refresh` | ❌ | Rotate refresh token |
| POST | `/auth/logout` | ✅ | Revoke refresh token |
| GET  | `/auth/verify/:token` | ❌ | Verify email |
| POST | `/auth/forgot-password` | ❌ | Send reset email |
| POST | `/auth/reset-password` | ❌ | Reset with token |
| GET  | `/auth/me` | ✅ | Current user profile |
| PATCH | `/auth/me` | ✅ | Update profile |
| POST | `/auth/change-password` | ✅ | Change password |

#### Register
```json
POST /auth/register
{
  "full_name":   "Arjun Mehta",
  "email":       "arjun.mehta@mahe.edu",
  "password":    "SecurePass1",
  "student_id":  "231040120",
  "department":  "Computer Science",
  "phone":       "+91 9876543210"
}
```

#### Login
```json
POST /auth/login
{ "email": "arjun.mehta@mahe.edu", "password": "SecurePass1" }

Response:
{
  "success": true,
  "data": {
    "access_token":  "<jwt>",
    "refresh_token": "<uuid-token>",
    "expires_in":    604800,
    "user": { "id": "...", "full_name": "...", "email": "...", "role": "student" }
  }
}
```

---

### 🏫 Spaces

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET    | `/spaces` | ❌ | List all spaces (paginated) |
| GET    | `/spaces/:id` | ❌ | Get single space |
| GET    | `/spaces/:id/availability?date=YYYY-MM-DD` | ❌ | Get slot availability |
| GET    | `/spaces/:id/availability/week` | ❌ | 7-day availability summary |
| GET    | `/spaces/:id/reviews` | ❌ | Paginated reviews |
| POST   | `/spaces` | ✅ Admin | Create space |
| PATCH  | `/spaces/:id` | ✅ Admin | Update space |
| POST   | `/spaces/:id/closures` | ✅ Admin | Add closure (maintenance) |

#### Query Params (GET /spaces)
| Param | Type | Description |
|-------|------|-------------|
| `type` | string | Filter by space_type |
| `search` | string | Fuzzy name/building search |
| `page` | int | Page number (default: 1) |
| `limit` | int | Results per page (default: 20) |

#### Availability Response
```json
{
  "data": {
    "space_id": "...",
    "date": "2024-12-10",
    "is_closed": false,
    "closures": [],
    "slots": [
      { "id": "...", "start_time": "08:00", "end_time": "09:00", "status": "available" },
      { "id": "...", "start_time": "09:00", "end_time": "10:00", "status": "booked" }
    ]
  }
}
```

---

### 📅 Bookings

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST   | `/bookings` | ✅ | Create booking |
| GET    | `/bookings/my` | ✅ | My bookings (filterable by status) |
| GET    | `/bookings/:id` | ✅ | Get booking detail |
| POST   | `/bookings/:id/cancel` | ✅ | Cancel booking |
| POST   | `/bookings/:id/checkin` | ✅ | Check in (within 15 min of start) |
| GET    | `/bookings` | ✅ Admin | All bookings |
| PATCH  | `/bookings/:id/status` | ✅ Admin | Update status |
| GET    | `/bookings/stats/dashboard` | ✅ Admin | Dashboard statistics |

#### Create Booking
```json
POST /bookings
{
  "space_id":       "uuid",
  "booking_date":   "2024-12-10",
  "start_time":     "14:00",
  "end_time":       "15:00",
  "attendees_count": 1,
  "purpose":        "Exam preparation"
}
```

#### Business Rules
- Max **3** active bookings per user
- Bookings allowed up to **7 days** in advance
- Cannot book in the past
- Cancellation blocked within **30 minutes** of start
- Auto **no-show** mark after **20 minutes** with no check-in
- DB trigger prevents double-booking

---

### 🔔 Notifications

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET    | `/notifications` | ✅ | List (add `?unread_only=true`) |
| POST   | `/notifications/mark-all-read` | ✅ | Mark all as read |
| PATCH  | `/notifications/:id/read` | ✅ | Mark single as read |
| DELETE | `/notifications/:id` | ✅ | Delete notification |

---

### ⭐ Reviews

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST   | `/reviews` | ✅ | Submit review |
| GET    | `/reviews/my` | ✅ | My reviews |
| PATCH  | `/reviews/:id` | ✅ | Edit review |
| DELETE | `/reviews/:id` | ✅ | Delete review |

#### Submit Review
```json
POST /reviews
{
  "space_id":   "uuid",
  "booking_id": "uuid",   // optional – ties review to a booking
  "rating":     5,
  "comment":    "Excellent quiet zone!"
}
```

---

### 🔧 Admin

All `/admin/*` endpoints require `role: admin`.

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET    | `/admin/users` | List users (search, filter by role) |
| PATCH  | `/admin/users/:id/toggle-active` | Suspend / unsuspend |
| PATCH  | `/admin/users/:id/role` | Change role |
| GET    | `/admin/analytics` | Full usage analytics |
| POST   | `/admin/announce` | Broadcast announcement |

---

## WebSocket Protocol

Connect: `ws://localhost:5000/ws?token=<jwt>`

### Message Types (Client → Server)

```json
{ "type": "AUTH",             "token": "<jwt>" }
{ "type": "SUBSCRIBE_SPACE",  "space_id": "uuid" }
{ "type": "UNSUBSCRIBE_SPACE","space_id": "uuid" }
{ "type": "PING" }
```

### Message Types (Server → Client)

```json
{ "type": "CONNECTED",           "userId": "..." }
{ "type": "AUTH_SUCCESS",        "userId": "..." }
{ "type": "AVAILABILITY_UPDATE", "payload": { "space_id":"...", "start_time":"10:00", "status":"booked" } }
{ "type": "NOTIFICATION",        "payload": { "id":"...", "title":"...", "message":"...", "type":"..." } }
{ "type": "PONG",                "time": 1700000000000 }
```

---

## Error Responses

```json
{ "success": false, "message": "Human-readable error message" }
{ "success": false, "message": "Validation failed", "errors": [{ "field": "email", "message": "Valid email required" }] }
```

| Status | Meaning |
|--------|---------|
| 200 | OK |
| 201 | Created |
| 400 | Bad request / business rule violation |
| 401 | Unauthenticated |
| 403 | Forbidden (role check) |
| 404 | Not found |
| 409 | Conflict (duplicate / booking clash) |
| 422 | Validation error |
| 429 | Rate limit exceeded |
| 500 | Server error |

---

## Rate Limits

| Scope | Window | Max |
|-------|--------|-----|
| Global | 15 min | 100 req |
| Auth endpoints | 15 min | 10 req |
| Booking creation | 1 min | 5 req |

---

## Background Jobs

| Job | Interval | Action |
|-----|----------|--------|
| Reminders | Every 2 min | Send email + notification 30 min before session |
| No-show detection | Every 2 min | Mark as `no_show` after 20 min grace period |
| Completion mark | Every 2 min | Mark checked-in sessions as `completed` |
| Slot generation | Every 6 hours | Pre-generate time slots for next 7 days |

---

## Setup & Running

```bash
# 1. Install dependencies
npm install

# 2. Configure environment
cp .env.example .env
# Edit .env with your DB, Redis, SMTP credentials

# 3. Create database
psql -U postgres -c "CREATE DATABASE studyspace_db;"
psql -U postgres -c "CREATE USER studyspace_user WITH PASSWORD 'password';"
psql -U postgres -c "GRANT ALL ON DATABASE studyspace_db TO studyspace_user;"

# 4. Run migrations
npm run db:migrate

# 5. Seed demo data
npm run db:seed

# 6. Start development server
npm run dev

# 7. Run tests
npm test
```

---

## Default Seed Accounts

| Role | Email | Password |
|------|-------|----------|
| Student | arjun.mehta@mahe.edu | Student@123 |
| Student | priya.sharma@mahe.edu | Student@123 |
| Staff | ananya.rao@mahe.edu | Staff@123 |
| Admin | admin@mahe.edu | Admin@Mahe2024 |
