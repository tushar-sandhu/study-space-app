import { useState, useEffect, useRef } from "react";
import './app.css';

// ─── DATA ───────────────────────────────────────────────────────────────────

const SPACES = [
  { id: 1, name: "Central Library – Level 2", type: "Library", capacity: 40, x: 52, y: 38, amenities: ["WiFi", "AC", "Power Outlets", "Quiet Zone"], rating: 4.7, reviews: 128, image: "📚" },
  { id: 2, name: "Innovation Hub – Pod A", type: "Collaborative", capacity: 8, x: 30, y: 55, amenities: ["WiFi", "Whiteboard", "TV Screen", "AC"], rating: 4.5, reviews: 64, image: "💡" },
  { id: 3, name: "Innovation Hub – Pod B", type: "Collaborative", capacity: 8, x: 38, y: 55, amenities: ["WiFi", "Whiteboard", "TV Screen", "AC"], rating: 4.3, reviews: 47, image: "💡" },
  { id: 4, name: "Engineering Block – Study Hall", type: "Study Hall", capacity: 60, x: 68, y: 30, amenities: ["WiFi", "AC", "Power Outlets"], rating: 4.2, reviews: 89, image: "⚙️" },
  { id: 5, name: "MBA Block – Reading Room", type: "Reading Room", capacity: 25, x: 22, y: 35, amenities: ["WiFi", "AC", "Quiet Zone", "Coffee Machine"], rating: 4.6, reviews: 73, image: "📖" },
  { id: 6, name: "Open Terrace Lounge", type: "Outdoor", capacity: 20, x: 75, y: 60, amenities: ["WiFi", "Natural Light", "Casual Seating"], rating: 4.0, reviews: 55, image: "🌿" },
  { id: 7, name: "Research Block – Seminar Room", type: "Seminar", capacity: 30, x: 55, y: 65, amenities: ["WiFi", "Projector", "AC", "Whiteboard"], rating: 4.4, reviews: 41, image: "🔬" },
  { id: 8, name: "Student Centre – Group Room", type: "Collaborative", capacity: 12, x: 42, y: 72, amenities: ["WiFi", "AC", "Whiteboard", "TV Screen"], rating: 4.1, reviews: 62, image: "🤝" },
];

const TIME_SLOTS = ["08:00", "09:00", "10:00", "11:00", "12:00", "13:00", "14:00", "15:00", "16:00", "17:00", "18:00", "19:00", "20:00"];

const generateAvailability = () => {
  const availability = {};
  SPACES.forEach(space => {
    availability[space.id] = {};
    const today = new Date();
    for (let d = 0; d < 7; d++) {
      const date = new Date(today);
      date.setDate(today.getDate() + d);
      const key = date.toISOString().split("T")[0];
      availability[space.id][key] = {};
      TIME_SLOTS.forEach(slot => {
        availability[space.id][key][slot] = Math.random() > 0.35 ? "available" : "booked";
      });
    }
  });
  return availability;
};

const INITIAL_AVAILABILITY = generateAvailability();

const INITIAL_USER = { name: "Tushar Sandhu", email: "tushar.sandhu@mahe.edu", id: "235811120", dept: "Information Technology" };

const INITIAL_BOOKINGS = [
  { id: "BK001", spaceId: 1, spaceName: "Central Library – Level 2", date: new Date(Date.now() - 86400000 * 2).toISOString().split("T")[0], slot: "10:00", status: "completed", bookedAt: "2 days ago" },
  { id: "BK002", spaceId: 5, spaceName: "MBA Block – Reading Room", date: new Date(Date.now() + 86400000).toISOString().split("T")[0], slot: "14:00", status: "upcoming", bookedAt: "1 day ago" },
];

const SAMPLE_REVIEWS = {
  1: [{ user: "Priya S.", rating: 5, comment: "Perfect quiet zone. Best library on campus!", time: "2 days ago" }, { user: "Kiran T.", rating: 4, comment: "Great ambience, power outlets everywhere.", time: "1 week ago" }],
  5: [{ user: "Ananya R.", rating: 5, comment: "Love the coffee machine! Very calm space.", time: "3 days ago" }],
  2: [{ user: "Dev M.", rating: 4, comment: "Great for group projects, whiteboard is huge.", time: "5 days ago" }],
};

// ─── ICONS ───────────────────────────────────────────────────────────────────

const Icon = ({ name, size = 18, className = "" }) => {
  const icons = {
    map: <svg width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"/><line x1="8" y1="2" x2="8" y2="18"/><line x1="16" y1="6" x2="16" y2="22"/></svg>,
    calendar: <svg width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>,
    user: <svg width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>,
    bell: <svg width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>,
    star: <svg width={size} height={size} fill="currentColor" viewBox="0 0 24 24"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>,
    check: <svg width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>,
    x: <svg width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>,
    search: <svg width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>,
    wifi: <svg width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M5 12.55a11 11 0 0 1 14.08 0"/><path d="M1.42 9a16 16 0 0 1 21.16 0"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><line x1="12" y1="20" x2="12.01" y2="20"/></svg>,
    zap: <svg width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>,
    trash: <svg width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>,
    clock: <svg width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>,
    home: <svg width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>,
    filter: <svg width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>,
    pin: <svg width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>,
    send: <svg width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>,
  };
  return <span className={className} style={{ display: "inline-flex", alignItems: "center", justifyContent: "center" }}>{icons[name] || null}</span>;
};

// ─── APP ─────────────────────────────────────────────────────────────────────

export default function App() {
  const [page, setPage] = useState("map");
  const [availability, setAvailability] = useState(INITIAL_AVAILABILITY);
  const [bookings, setBookings] = useState(INITIAL_BOOKINGS);
  const [notifications, setNotifications] = useState([
    { id: 1, type: "confirm", title: "Booking Confirmed!", msg: "Your booking for MBA Block – Reading Room on tomorrow at 2:00 PM is confirmed.", time: "1 hour ago", read: false, icon: "✅" },
    { id: 2, type: "reminder", title: "Upcoming Session Reminder", msg: "You have a study session at MBA Block – Reading Room in 30 minutes.", time: "30 min ago", read: false, icon: "⏰" },
    { id: 3, type: "info", title: "New Space Available", msg: "The Research Block – Seminar Room is now available for booking.", time: "2 hours ago", read: true, icon: "🆕" },
  ]);
  const [selectedSpace, setSelectedSpace] = useState(null);
  const [showSuccess, setShowSuccess] = useState(null);
  const [user] = useState(INITIAL_USER);

  const unreadCount = notifications.filter(n => !n.read).length;

  const handleBook = (booking) => {
    const newBooking = {
      id: "BK" + String(Date.now()).slice(-5),
      spaceId: booking.spaceId,
      spaceName: booking.spaceName,
      date: booking.date,
      slot: booking.slot,
      status: "upcoming",
      bookedAt: "just now",
    };
    setBookings(prev => [newBooking, ...prev]);
    const newAvail = { ...availability };
    newAvail[booking.spaceId][booking.date][booking.slot] = "booked";
    setAvailability(newAvail);
    setShowSuccess(newBooking);
    setNotifications(prev => [{
      id: Date.now(), type: "confirm",
      title: "Booking Confirmed! 🎉",
      msg: `Your booking for ${booking.spaceName} on ${booking.date} at ${booking.slot} is confirmed.`,
      time: "just now", read: false, icon: "✅",
    }, ...prev]);
  };

  const handleCancel = (bookingId) => {
    setBookings(prev => prev.map(b => b.id === bookingId ? { ...b, status: "cancelled" } : b));
  };

  return (
    <div className="app">
      <TopBar user={user} unreadCount={unreadCount} onNotif={() => setPage("notifications")} />
      <NavBar page={page} setPage={setPage} />
      <main className="main">
        {page === "map" && <MapPage spaces={SPACES} availability={availability} selectedSpace={selectedSpace} setSelectedSpace={setSelectedSpace} onBook={() => setPage("booking")} />}
        {page === "booking" && <BookingPage spaces={SPACES} availability={availability} onBook={handleBook} />}
        {page === "mybookings" && <MyBookingsPage bookings={bookings} spaces={SPACES} onCancel={handleCancel} />}
        {page === "notifications" && <NotificationsPage notifications={notifications} setNotifications={setNotifications} />}
        {page === "feedback" && <FeedbackPage spaces={SPACES} />}
        {page === "profile" && <ProfilePage user={user} bookings={bookings} />}
      </main>
      {showSuccess && (
        <SuccessModal booking={showSuccess} onClose={() => { setShowSuccess(null); setPage("mybookings"); }} />
      )}
    </div>
  );
}

// ─── TOPBAR ──────────────────────────────────────────────────────────────────

function TopBar({ user, unreadCount, onNotif }) {
  return (
    <header className="topbar">
      <div className="topbar-logo">
        <div className="topbar-logo-badge">🎓</div>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700, letterSpacing: "-0.3px" }}>StudySpace</div>
          <div style={{ fontSize: 10, color: "var(--text3)", fontWeight: 500 }}>MAHE Bengaluru</div>
        </div>
      </div>
      <div className="topbar-spacer" />
      <div className="topbar-notif" onClick={onNotif}>
        <Icon name="bell" size={18} />
        {unreadCount > 0 && <span className="notif-dot" />}
      </div>
      <div className="topbar-avatar">{user.name[0]}</div>
    </header>
  );
}

// ─── NAVBAR ──────────────────────────────────────────────────────────────────

function NavBar({ page, setPage }) {
  const items = [
    { id: "map", icon: "map", label: "Campus Map" },
    { id: "booking", icon: "calendar", label: "Book Space" },
    { id: "mybookings", icon: "clock", label: "My Bookings" },
    { id: "notifications", icon: "bell", label: "Notifications" },
    { id: "feedback", icon: "star", label: "Feedback" },
    { id: "profile", icon: "user", label: "Profile" },
  ];
  return (
    <nav className="nav">
      {items.map(item => (
        <div key={item.id} className={`nav-item ${page === item.id ? "active" : ""}`} onClick={() => setPage(item.id)}>
          <Icon name={item.icon} size={20} />
          <span className="nav-tooltip">{item.label}</span>
        </div>
      ))}
    </nav>
  );
}

// ─── MAP PAGE ────────────────────────────────────────────────────────────────

function MapPage({ spaces, availability, selectedSpace, setSelectedSpace, onBook }) {
  const today = new Date().toISOString().split("T")[0];

  const getSpaceStatus = (spaceId) => {
    const slots = availability[spaceId]?.[today] || {};
    const values = Object.values(slots);
    const booked = values.filter(v => v === "booked").length;
    const ratio = booked / values.length;
    if (ratio >= 0.8) return "full";
    if (ratio >= 0.4) return "partial";
    return "available";
  };

  const buildings = [
    { label: "Central Library", x: 42, y: 28, w: 18, h: 12 },
    { label: "Engineering Block", x: 60, y: 22, w: 16, h: 14 },
    { label: "MBA Block", x: 14, y: 26, w: 14, h: 12 },
    { label: "Innovation Hub", x: 22, y: 47, w: 22, h: 14 },
    { label: "Research Block", x: 46, y: 57, w: 18, h: 12 },
    { label: "Student Centre", x: 32, y: 65, w: 18, h: 12 },
    { label: "Admin Block", x: 70, y: 45, w: 14, h: 10 },
    { label: "Sports Complex", x: 10, y: 68, w: 16, h: 14 },
  ];

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-title">Campus Map</div>
        <div className="page-sub">Manipal Academy of Higher Education, Bengaluru · {spaces.length} study spaces</div>
      </div>

      <div className="stats-row">
        <div className="stat-card blue">
          <div className="stat-label">Available Now</div>
          <div className="stat-val blue">{spaces.filter(s => getSpaceStatus(s.id) === "available").length}</div>
          <div className="stat-sub">spaces open</div>
        </div>
        <div className="stat-card teal">
          <div className="stat-label">Partially Full</div>
          <div className="stat-val teal">{spaces.filter(s => getSpaceStatus(s.id) === "partial").length}</div>
          <div className="stat-sub">limited slots</div>
        </div>
        <div className="stat-card red">
          <div className="stat-label">Fully Booked</div>
          <div className="stat-val red">{spaces.filter(s => getSpaceStatus(s.id) === "full").length}</div>
          <div className="stat-sub">no slots</div>
        </div>
        <div className="stat-card gold">
          <div className="stat-label">Total Capacity</div>
          <div className="stat-val gold">{spaces.reduce((a, b) => a + b.capacity, 0)}</div>
          <div className="stat-sub">seats campus-wide</div>
        </div>
      </div>

      <div className="map-container">
        <div className="map-bg">
          <div className="map-grid" />

          {/* Campus SVG roads */}
          <svg className="campus-svg" viewBox="0 0 100 100" preserveAspectRatio="none">
            <path d="M50,10 L50,90" stroke="rgba(99,120,180,0.12)" strokeWidth="0.8" fill="none" />
            <path d="M10,50 L90,50" stroke="rgba(99,120,180,0.12)" strokeWidth="0.8" fill="none" />
            <path d="M20,20 Q50,40 80,20" stroke="rgba(99,120,180,0.08)" strokeWidth="0.5" fill="none" />
            <path d="M20,80 Q50,60 80,80" stroke="rgba(99,120,180,0.08)" strokeWidth="0.5" fill="none" />
            <ellipse cx="50" cy="50" rx="25" ry="18" stroke="rgba(59,126,255,0.08)" strokeWidth="0.6" fill="rgba(59,126,255,0.02)" />
          </svg>

          {/* Buildings */}
          {buildings.map((b, i) => (
            <div key={i} className="building" style={{
              left: `${b.x}%`, top: `${b.y}%`, width: `${b.w}%`, height: `${b.h}%`,
              background: `rgba(20,27,45,0.85)`,
            }}>
              {b.label}
            </div>
          ))}

          {/* Space Pins */}
          {spaces.map(space => {
            const status = getSpaceStatus(space.id);
            return (
              <div key={space.id} className="space-pin" style={{ left: `${space.x}%`, top: `${space.y}%` }}
                onClick={() => setSelectedSpace(selectedSpace?.id === space.id ? null : space)}>
                <div className={`pin-outer pin-${status}`}>{space.image}</div>
                <div className="pin-label">{space.name.split("–")[0].trim()}</div>
              </div>
            );
          })}

          {/* Selected Space Panel */}
          {selectedSpace && (
            <div className="space-panel">
              <div className="panel-close" onClick={() => setSelectedSpace(null)}><Icon name="x" size={12} /></div>
              <div className="panel-emoji">{selectedSpace.image}</div>
              <div className="panel-name">{selectedSpace.name}</div>
              <div className="panel-type">{selectedSpace.type}</div>
              <div className="panel-rating">
                <Icon name="star" size={12} />
                {selectedSpace.rating}
                <span>({selectedSpace.reviews} reviews)</span>
              </div>
              <div className="panel-tags">
                {selectedSpace.amenities.map(a => <span key={a} className="tag">{a}</span>)}
              </div>
              <div className="panel-cap">👥 Capacity: {selectedSpace.capacity} seats</div>
              <button className="btn btn-primary btn-full" onClick={onBook}>
                <Icon name="calendar" size={14} /> Book This Space
              </button>
            </div>
          )}

          {/* Legend */}
          <div className="map-legend">
            <div className="legend-item"><div className="legend-dot" style={{ background: "var(--success)" }} />Available</div>
            <div className="legend-item"><div className="legend-dot" style={{ background: "var(--warning)" }} />Limited</div>
            <div className="legend-item"><div className="legend-dot" style={{ background: "var(--danger)" }} />Full</div>
          </div>

          {/* Map Controls */}
          <div className="map-controls">
            <div className="map-btn" title="North"><span className="compass">🧭</span></div>
            <div className="map-btn" style={{ fontSize: 20 }}>+</div>
            <div className="map-btn" style={{ fontSize: 20 }}>−</div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── BOOKING PAGE ─────────────────────────────────────────────────────────────

function BookingPage({ spaces, availability, onBook }) {
  const [selectedSpace, setSelectedSpace] = useState(null);
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split("T")[0]);
  const [selectedSlot, setSelectedSlot] = useState(null);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("All");
  const [step, setStep] = useState(1); // 1=select space, 2=select slot, 3=confirm

  const types = ["All", ...new Set(spaces.map(s => s.type))];

  const dates = Array.from({ length: 7 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() + i);
    return d;
  });

  const filtered = spaces.filter(s => {
    const matchSearch = s.name.toLowerCase().includes(search.toLowerCase());
    const matchType = typeFilter === "All" || s.type === typeFilter;
    return matchSearch && matchType;
  });

  const slots = availability[selectedSpace?.id]?.[selectedDate] || {};

  const getSpaceAvailCount = (spaceId) => {
    const s = availability[spaceId]?.[selectedDate] || {};
    return Object.values(s).filter(v => v === "available").length;
  };

  const handleConfirm = () => {
    onBook({ spaceId: selectedSpace.id, spaceName: selectedSpace.name, date: selectedDate, slot: selectedSlot });
    setSelectedSpace(null); setSelectedSlot(null); setStep(1);
  };

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-title">Book a Study Space</div>
        <div className="page-sub">Select a space, pick your date and time slot</div>
      </div>

      {/* Step indicator */}
      <div className="flex-row mb16" style={{ gap: 0 }}>
        {["Select Space", "Choose Slot", "Confirm"].map((s, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{ width: 28, height: 28, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700,
                background: step > i + 1 ? "var(--success)" : step === i + 1 ? "var(--accent)" : "var(--surface3)",
                color: step >= i + 1 ? "#fff" : "var(--text3)" }}>
                {step > i + 1 ? <Icon name="check" size={12} /> : i + 1}
              </div>
              <span style={{ fontSize: 12, color: step === i + 1 ? "var(--text)" : "var(--text3)", fontWeight: step === i + 1 ? 600 : 400 }}>{s}</span>
            </div>
            {i < 2 && <div style={{ width: 40, height: 1, background: step > i + 1 ? "var(--success)" : "var(--border)", margin: "0 10px" }} />}
          </div>
        ))}
      </div>

      {step === 1 && (
        <div>
          <div className="search-bar">
            <Icon name="search" size={16} className="" style={{ color: "var(--text3)" }} />
            <input placeholder="Search spaces..." value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <div className="filter-tabs">
            {types.map(t => <div key={t} className={`filter-tab ${typeFilter === t ? "active" : ""}`} onClick={() => setTypeFilter(t)}>{t}</div>)}
          </div>
          <div className="space-list">
            {filtered.map(space => {
              const avail = getSpaceAvailCount(space.id);
              return (
                <div key={space.id} className={`space-row ${selectedSpace?.id === space.id ? "selected" : ""}`} onClick={() => setSelectedSpace(space)}>
                  <div className="space-emoji">{space.image}</div>
                  <div className="space-info">
                    <div className="space-name">{space.name}</div>
                    <div className="space-meta">{space.type} · {space.capacity} seats · ⭐ {space.rating}</div>
                    <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 5 }}>
                      {space.amenities.slice(0, 3).map(a => <span key={a} className="tag">{a}</span>)}
                    </div>
                  </div>
                  <span className={`avail-badge ${avail > 4 ? "green" : avail > 1 ? "yellow" : "red"}`}>
                    {avail} slots
                  </span>
                </div>
              );
            })}
          </div>
          <div className="mt16" style={{ display: "flex", justifyContent: "flex-end" }}>
            <button className="btn btn-primary" disabled={!selectedSpace} onClick={() => selectedSpace && setStep(2)}
              style={{ opacity: selectedSpace ? 1 : 0.4 }}>
              Continue <Icon name="calendar" size={14} />
            </button>
          </div>
        </div>
      )}

      {step === 2 && (
        <div>
          <div className="flex-between mb16">
            <div>
              <div style={{ fontSize: 16, fontWeight: 700 }}>{selectedSpace?.image} {selectedSpace?.name}</div>
              <div style={{ fontSize: 12, color: "var(--text3)", marginTop: 3 }}>Pick a date and time slot</div>
            </div>
            <button className="btn btn-outline btn-sm" onClick={() => setStep(1)}>← Back</button>
          </div>

          <p className="section-title">Select Date</p>
          <div className="date-strip">
            {dates.map(d => {
              const key = d.toISOString().split("T")[0];
              const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
              const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
              return (
                <div key={key} className={`date-chip ${selectedDate === key ? "active" : ""}`} onClick={() => { setSelectedDate(key); setSelectedSlot(null); }}>
                  <div className="date-day">{days[d.getDay()]}</div>
                  <div className="date-num">{d.getDate()}</div>
                  <div className="date-month">{months[d.getMonth()]}</div>
                </div>
              );
            })}
          </div>

          <p className="section-title">Available Time Slots</p>
          <div className="slots-grid">
            {TIME_SLOTS.map(slot => {
              const status = slots[slot];
              return (
                <div key={slot} className={`slot ${status === "booked" ? "booked" : "available"} ${selectedSlot === slot ? "selected" : ""}`}
                  onClick={() => status !== "booked" && setSelectedSlot(slot)}>
                  {slot}
                </div>
              );
            })}
          </div>

          <div className="mt16" style={{ display: "flex", justifyContent: "flex-end" }}>
            <button className="btn btn-primary" disabled={!selectedSlot} onClick={() => selectedSlot && setStep(3)}
              style={{ opacity: selectedSlot ? 1 : 0.4 }}>
              Review Booking <Icon name="check" size={14} />
            </button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div style={{ maxWidth: 500 }}>
          <div className="flex-between mb16">
            <div style={{ fontSize: 16, fontWeight: 700 }}>Confirm Booking</div>
            <button className="btn btn-outline btn-sm" onClick={() => setStep(2)}>← Back</button>
          </div>
          <div className="booking-summary">
            {[
              ["Space", selectedSpace?.name],
              ["Type", selectedSpace?.type],
              ["Date", selectedDate],
              ["Time", `${selectedSlot} – ${TIME_SLOTS[TIME_SLOTS.indexOf(selectedSlot) + 1] || "end"}`],
              ["Capacity", `${selectedSpace?.capacity} seats`],
              ["Duration", "1 hour"],
            ].map(([label, val]) => (
              <div key={label} className="bs-row">
                <span className="bs-label">{label}</span>
                <span className="bs-val">{val}</span>
              </div>
            ))}
          </div>
          <div style={{ padding: "12px 16px", background: "rgba(0,200,150,0.07)", border: "1px solid rgba(0,200,150,0.2)", borderRadius: 10, marginBottom: 18, fontSize: 12, color: "var(--accent2)", lineHeight: 1.6 }}>
            📌 Please arrive on time. Spaces not occupied within 15 minutes may be released.
          </div>
          <button className="btn btn-primary btn-full" style={{ padding: "14px", fontSize: 14 }} onClick={handleConfirm}>
            <Icon name="check" size={16} /> Confirm Booking
          </button>
        </div>
      )}
    </div>
  );
}

// ─── MY BOOKINGS ──────────────────────────────────────────────────────────────

function MyBookingsPage({ bookings, spaces, onCancel }) {
  const [tab, setTab] = useState("upcoming");
  const filtered = bookings.filter(b => {
    if (tab === "upcoming") return b.status === "upcoming";
    if (tab === "completed") return b.status === "completed";
    if (tab === "cancelled") return b.status === "cancelled";
    return true;
  });

  const getEmoji = (spaceId) => spaces.find(s => s.id === spaceId)?.image || "📌";

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-title">My Bookings</div>
        <div className="page-sub">{bookings.length} total bookings</div>
      </div>

      <div className="filter-tabs mb16">
        {["upcoming", "completed", "cancelled"].map(t => (
          <div key={t} className={`filter-tab ${tab === t ? "active" : ""}`} onClick={() => setTab(t)}>
            {t.charAt(0).toUpperCase() + t.slice(1)}
            <span style={{ marginLeft: 6, background: "rgba(255,255,255,0.15)", borderRadius: "10px", padding: "1px 6px", fontSize: 10 }}>
              {bookings.filter(b => b.status === t).length}
            </span>
          </div>
        ))}
      </div>

      {filtered.length === 0 && (
        <div style={{ textAlign: "center", padding: "60px 20px", color: "var(--text3)" }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>📭</div>
          <div style={{ fontSize: 15, fontWeight: 600, color: "var(--text2)", marginBottom: 8 }}>No {tab} bookings</div>
          <div style={{ fontSize: 13 }}>Your {tab} bookings will appear here.</div>
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {filtered.map(b => (
          <div key={b.id} className="booking-card">
            <div className="bk-emoji">{getEmoji(b.spaceId)}</div>
            <div className="bk-info">
              <div className="flex-between">
                <div className="bk-name">{b.spaceName}</div>
                <span className={`status-pill status-${b.status}`}>{b.status}</span>
              </div>
              <div className="bk-meta mt8">
                <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
                  <span>📅 {b.date}</span>
                  <span>🕐 {b.slot}</span>
                  <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: "var(--accent)" }}>#{b.id}</span>
                </div>
                <div style={{ marginTop: 6, fontSize: 11, color: "var(--text3)" }}>Booked {b.bookedAt}</div>
              </div>
              {b.status === "upcoming" && (
                <div className="mt12">
                  <button className="btn btn-danger btn-sm" onClick={() => onCancel(b.id)}>
                    <Icon name="trash" size={12} /> Cancel Booking
                  </button>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── NOTIFICATIONS ────────────────────────────────────────────────────────────

function NotificationsPage({ notifications, setNotifications }) {
  const markAll = () => setNotifications(prev => prev.map(n => ({ ...n, read: true })));

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="flex-between">
          <div>
            <div className="page-title">Notifications</div>
            <div className="page-sub">{notifications.filter(n => !n.read).length} unread</div>
          </div>
          <button className="btn btn-outline btn-sm" onClick={markAll}>Mark all read</button>
        </div>
      </div>

      {notifications.map(n => (
        <div key={n.id} className={`notif-item ${!n.read ? "unread" : ""}`}
          onClick={() => setNotifications(prev => prev.map(x => x.id === n.id ? { ...x, read: true } : x))}>
          <div className="notif-icon" style={{
            background: n.type === "confirm" ? "rgba(0,200,150,0.15)" : n.type === "reminder" ? "rgba(59,126,255,0.15)" : "rgba(245,166,35,0.15)"
          }}>
            {n.icon}
          </div>
          <div className="notif-body">
            <div className="notif-title">{n.title}</div>
            <div className="notif-msg">{n.msg}</div>
            <div className="notif-time">{n.time}</div>
          </div>
          {!n.read && <div style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--accent)", flexShrink: 0, marginTop: 6 }} />}
        </div>
      ))}
    </div>
  );
}

// ─── FEEDBACK ─────────────────────────────────────────────────────────────────

function FeedbackPage({ spaces }) {
  const [selectedSpace, setSelectedSpace] = useState(spaces[0]);
  const [rating, setRating] = useState(0);
  const [hoverRating, setHoverRating] = useState(0);
  const [comment, setComment] = useState("");
  const [reviews, setReviews] = useState(SAMPLE_REVIEWS);
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = () => {
    if (!rating || !comment.trim()) return;
    const newReview = { user: "Arjun M.", rating, comment, time: "just now" };
    setReviews(prev => ({ ...prev, [selectedSpace.id]: [newReview, ...(prev[selectedSpace.id] || [])] }));
    setRating(0); setComment(""); setSubmitted(true);
    setTimeout(() => setSubmitted(false), 3000);
  };

  const spaceReviews = reviews[selectedSpace.id] || [];

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-title">Rate & Review</div>
        <div className="page-sub">Share your experience to help fellow students</div>
      </div>

      <div className="grid2">
        <div>
          <p className="section-title">Select Space to Review</p>
          <div className="space-list" style={{ maxHeight: 360 }}>
            {spaces.map(space => (
              <div key={space.id} className={`space-row ${selectedSpace.id === space.id ? "selected" : ""}`} onClick={() => setSelectedSpace(space)}>
                <div className="space-emoji">{space.image}</div>
                <div className="space-info">
                  <div className="space-name">{space.name}</div>
                  <div className="space-meta">⭐ {space.rating} · {space.reviews} reviews</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div>
          <div className="card mb16">
            <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>{selectedSpace.image} {selectedSpace.name}</div>
            <div style={{ fontSize: 12, color: "var(--text3)", marginBottom: 14 }}>{selectedSpace.type} · ⭐ {selectedSpace.rating} average</div>

            <label className="label">Your Rating</label>
            <div className="star-select">
              {[1, 2, 3, 4, 5].map(i => (
                <span key={i} className={`star-btn ${(hoverRating || rating) >= i ? "on" : ""}`}
                  onMouseEnter={() => setHoverRating(i)} onMouseLeave={() => setHoverRating(0)} onClick={() => setRating(i)}>⭐</span>
              ))}
            </div>
            <div style={{ marginBottom: 14 }}>
              <label className="label">Your Review</label>
              <textarea className="input" placeholder="Share your experience — cleanliness, quietness, facilities..." value={comment} onChange={e => setComment(e.target.value)} />
            </div>
            {submitted && (
              <div style={{ padding: "10px 14px", background: "rgba(0,200,150,0.1)", border: "1px solid rgba(0,200,150,0.3)", borderRadius: 10, fontSize: 13, color: "var(--success)", marginBottom: 14 }}>
                ✅ Review submitted! Thank you.
              </div>
            )}
            <button className="btn btn-primary btn-full" onClick={handleSubmit}>
              <Icon name="send" size={14} /> Submit Review
            </button>
          </div>

          <p className="section-title">Recent Reviews ({spaceReviews.length})</p>
          {spaceReviews.length === 0 && <div style={{ color: "var(--text3)", fontSize: 13 }}>No reviews yet. Be the first!</div>}
          {spaceReviews.map((r, i) => (
            <div key={i} className="review-card">
              <div className="review-head">
                <div className="review-user">{r.user}</div>
                <div className="review-stars">{Array.from({ length: r.rating }, (_, i) => <span key={i}>⭐</span>)}</div>
              </div>
              <div className="review-text">{r.comment}</div>
              <div className="review-time">{r.time}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── PROFILE ──────────────────────────────────────────────────────────────────

function ProfilePage({ user, bookings }) {
  const upcoming = bookings.filter(b => b.status === "upcoming").length;
  const completed = bookings.filter(b => b.status === "completed").length;

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-title">My Profile</div>
      </div>

      <div className="profile-header">
        <div className="profile-avatar">{user.name[0]}</div>
        <div>
          <div className="profile-name">{user.name}</div>
          <div className="profile-meta">{user.email}</div>
          <div className="profile-meta" style={{ marginTop: 2 }}>🎓 {user.dept} · ID: {user.id}</div>
          <div className="profile-badges">
            <span className="profile-badge">📚 Active Student</span>
            <span className="profile-badge">⭐ Regular Bookee</span>
          </div>
        </div>
      </div>

      <div className="stats-row">
        <div className="stat-card blue">
          <div className="stat-label">Total Bookings</div>
          <div className="stat-val blue">{bookings.length}</div>
          <div className="stat-sub">all time</div>
        </div>
        <div className="stat-card teal">
          <div className="stat-label">Upcoming</div>
          <div className="stat-val teal">{upcoming}</div>
          <div className="stat-sub">scheduled</div>
        </div>
        <div className="stat-card gold">
          <div className="stat-label">Completed</div>
          <div className="stat-val gold">{completed}</div>
          <div className="stat-sub">sessions done</div>
        </div>
        <div className="stat-card red">
          <div className="stat-label">Cancelled</div>
          <div className="stat-val red">{bookings.filter(b => b.status === "cancelled").length}</div>
          <div className="stat-sub">not attended</div>
        </div>
      </div>

      <div className="grid2">
        <div className="card">
          <p className="section-title">Account Details</p>
          {[["Full Name", user.name], ["Email", user.email], ["Student ID", user.id], ["Department", user.dept], ["Campus", "MAHE Bengaluru"], ["Membership", "Student – Active"]].map(([k, v]) => (
            <div key={k} className="bs-row">
              <span className="bs-label">{k}</span>
              <span className="bs-val" style={{ fontSize: 12 }}>{v}</span>
            </div>
          ))}
        </div>
        <div className="card">
          <p className="section-title">Preferences</p>
          {[["Default Space Type", "Library"], ["Preferred Time", "Morning (08–12)"], ["Email Notifications", "Enabled"], ["SMS Reminders", "Enabled"], ["Reminder Advance", "30 minutes"], ["Language", "English"]].map(([k, v]) => (
            <div key={k} className="bs-row">
              <span className="bs-label">{k}</span>
              <span className="bs-val" style={{ fontSize: 12, color: "var(--accent2)" }}>{v}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── SUCCESS MODAL ────────────────────────────────────────────────────────────

function SuccessModal({ booking, onClose }) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-icon" style={{ background: "rgba(0,200,150,0.15)" }}>🎉</div>
        <div className="modal-title">Booking Confirmed!</div>
        <div className="modal-sub">Your study space has been successfully reserved. A confirmation has been sent to your email.</div>
        <div className="modal-id">{booking.id}</div>
        <div style={{ fontSize: 13, color: "var(--text2)", marginBottom: 20, lineHeight: 1.7 }}>
          📍 {booking.spaceName}<br />
          📅 {booking.date} at {booking.slot}<br />
          ⏱ Duration: 1 hour
        </div>
        <button className="btn btn-primary btn-full" onClick={onClose}>View My Bookings</button>
      </div>
    </div>
  );
}