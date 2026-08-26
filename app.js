/* ============================================================
   KDMW Flight Tracker — app.js
   Carroll County Regional Airport | Westminster, MD
   ============================================================ */

'use strict';

// ── CONFIG ────────────────────────────────────────────────────
const AIRPORT = {
  name:  'Carroll County Regional Airport',
  icao:  'KDMW',
  iata:  'DMW',
  lat:   39.6083,
  lon:  -77.0077,
  elev:  789,           // ft MSL
};

// Bounding box ≈ 150 nm radius around KDMW
const BBOX = {
  lamin:  37.17,   // lat min  (~150 nm south)
  lomin: -79.50,   // lon min  (~150 nm west)
  lamax:  42.05,   // lat max  (~150 nm north)
  lomax: -74.50,   // lon max  (~150 nm east)
};

const REFRESH_INTERVAL = 30_000;   // 30 s
const OPENSKY_URL =
  `https://opensky-network.org/api/states/all` +
  `?lamin=${BBOX.lamin}&lomin=${BBOX.lomin}` +
  `&lamax=${BBOX.lamax}&lomax=${BBOX.lomax}`;

// Optional CORS proxy fallback (used only if the direct fetch is blocked).
// allorigins wraps the response, so we detect and unwrap it.
const CORS_PROXY = 'https://api.allorigins.win/raw?url=';

// Hexdb gives free aircraft type lookups by ICAO24 hex code
const HEXDB_URL = (hex) => `https://hexdb.io/api/v1/aircraft/${hex}`;

// OpenSky state vector indices
const F = {
  icao24:    0,  callsign:  1,  origin:    2,
  time_pos:  3,  last_seen: 4,
  lon:       5,  lat:       6,  baro_alt:  7,
  on_ground: 8,  velocity:  9,  heading:   10,
  vert_rate: 11, sensors:   12, geo_alt:   13,
  squawk:    14, spi:       15, pos_src:   16,
};

// ── STATE ─────────────────────────────────────────────────────
let map, tileStreet, tileSatellite, airportMarker, rangeCircle;
let markers   = {};          // icao24 → Leaflet marker
let aircraftDB = {};         // icao24 → {type, reg, …} from hexdb cache
let flights   = [];          // current filtered flight list
let selected  = null;        // currently selected icao24
let countdownVal = REFRESH_INTERVAL / 1000;
let countdownTimer, refreshTimer;

// ── INIT ──────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  initMap();
  initClock();
  initControls();
  fetchFlights();
  startAutoRefresh();
});

// ── MAP ───────────────────────────────────────────────────────
function initMap() {
  map = L.map('map', {
    center:    [AIRPORT.lat, AIRPORT.lon],
    zoom:      8,
    zoomControl: false,
    attributionControl: true,
  });

  tileStreet = L.tileLayer(
    'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    { attribution: '© OpenStreetMap contributors', maxZoom: 18 }
  );

  tileSatellite = L.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    { attribution: '© Esri, Maxar, Earthstar Geographics', maxZoom: 18 }
  );

  // Default to satellite
  tileSatellite.addTo(map);

  // Add zoom control to bottom-right
  L.control.zoom({ position: 'bottomright' }).addTo(map);

  // Airport marker
  const airportIcon = L.divIcon({
    className: '',
    html: `<div style="
      width:14px;height:14px;
      background:${getComputedStyle(document.documentElement).getPropertyValue('--amber') || '#ffab40'};
      border:2px solid #fff;
      border-radius:50%;
      box-shadow:0 0 12px #ffab40,0 0 4px #fff;
    "></div>`,
    iconSize: [14, 14],
    iconAnchor: [7, 7],
  });
  airportMarker = L.marker([AIRPORT.lat, AIRPORT.lon], { icon: airportIcon, zIndexOffset: 1000 })
    .addTo(map)
    .bindTooltip(`<strong>${AIRPORT.icao}</strong> ${AIRPORT.name}`, {
      permanent: false, direction: 'right', className: 'leaflet-tooltip',
    });

  // Range circle (~150 nm = 278 km)
  rangeCircle = L.circle([AIRPORT.lat, AIRPORT.lon], {
    radius:    278_000,
    color:     '#00c8ff',
    weight:    1,
    opacity:   0.25,
    fillColor: '#00c8ff',
    fillOpacity: 0.03,
    dashArray: '6 4',
  }).addTo(map);
}

// ── CONTROLS ─────────────────────────────────────────────────
function initControls() {
  document.getElementById('btnSatellite').addEventListener('click', () => {
    map.removeLayer(tileStreet);
    tileSatellite.addTo(map);
    document.getElementById('btnSatellite').classList.add('active');
    document.getElementById('btnStreet').classList.remove('active');
  });
  document.getElementById('btnStreet').addEventListener('click', () => {
    map.removeLayer(tileSatellite);
    tileStreet.addTo(map);
    document.getElementById('btnStreet').classList.add('active');
    document.getElementById('btnSatellite').classList.remove('active');
  });
  document.getElementById('btnCenter').addEventListener('click', () => {
    map.flyTo([AIRPORT.lat, AIRPORT.lon], 8, { duration: 1.2 });
  });
  document.getElementById('btnRefresh').addEventListener('click', () => {
    resetCountdown();
    fetchFlights();
  });
  document.getElementById('searchInput').addEventListener('input', (e) => {
    renderFlightList(e.target.value.trim().toUpperCase());
  });
}

// ── CLOCK ─────────────────────────────────────────────────────
function initClock() {
  function tick() {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    document.getElementById('clockUTC').textContent =
      `${pad(now.getUTCHours())}:${pad(now.getUTCMinutes())}:${pad(now.getUTCSeconds())}`;
    document.getElementById('clockLocal').textContent =
      `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
  }
  tick();
  setInterval(tick, 1000);
}

// ── AUTO REFRESH ──────────────────────────────────────────────
function startAutoRefresh() {
  refreshTimer = setInterval(() => {
    fetchFlights();
    resetCountdown();
  }, REFRESH_INTERVAL);

  countdownTimer = setInterval(() => {
    countdownVal = Math.max(0, countdownVal - 1);
    document.getElementById('countdown').textContent = countdownVal;
  }, 1000);
}

function resetCountdown() {
  countdownVal = REFRESH_INTERVAL / 1000;
  document.getElementById('countdown').textContent = countdownVal;
}

// ── DATA FETCH ────────────────────────────────────────────────
async function fetchFlights() {
  const btn = document.getElementById('btnRefresh');
  btn.classList.add('spinning');
  setStatus('connecting', 'Fetching data…');

  try {
    const data = await fetchWithFallback(OPENSKY_URL);
    const states = data.states || [];

    // Filter: must have lat/lon
    const valid = states.filter(s => s[F.lat] !== null && s[F.lon] !== null);
    flights = valid.map(parseState);

    renderAll();
    setStatus('ok', `${flights.length} aircraft — ${new Date().toLocaleTimeString()}`);
    document.getElementById('lastUpdate').textContent =
      `Updated ${new Date().toLocaleTimeString()}`;

    // Enrich type info for visible aircraft (async, non-blocking)
    enrichTypes(flights.slice(0, 20)); // top 20 to stay within free limits

  } catch (err) {
    console.error(err);
    setStatus('error', `Error: ${err.message}`);
    showToast('⚠️ Could not reach OpenSky API — showing last data');
  } finally {
    btn.classList.remove('spinning');
  }
}

// ── FETCH WITH CORS FALLBACK ──────────────────────────────────
async function fetchWithFallback(url) {
  // 1) Try a direct browser request (OpenSky sends Access-Control-Allow-Origin: *)
  try {
    const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
    if (res.ok) return await res.json();
    throw new Error(`HTTP ${res.status}`);
  } catch (directErr) {
    console.warn('Direct fetch failed, trying CORS proxy…', directErr.message);
    // 2) Fall back to a public CORS proxy
    const res = await fetch(CORS_PROXY + encodeURIComponent(url));
    if (!res.ok) throw new Error(`Proxy HTTP ${res.status}`);
    return await res.json();
  }
}

// ── PARSE STATE VECTOR ────────────────────────────────────────
function parseState(s) {
  const callsign = (s[F.callsign] || '').trim() || s[F.icao24].toUpperCase();
  const vertRate = s[F.vert_rate] || 0;
  const baroAlt  = s[F.baro_alt]  !== null ? s[F.baro_alt]  : s[F.geo_alt];
  const altFt    = baroAlt !== null ? Math.round(baroAlt * 3.28084) : null;
  const speedKts = s[F.velocity]  !== null ? Math.round(s[F.velocity] * 1.94384) : null;
  const heading  = s[F.heading]   !== null ? Math.round(s[F.heading]) : 0;

  // Approximate ground speed = velocity (OpenSky doesn't separate them; velocity IS ground speed from ADS-B)
  const gsKts = speedKts;

  let vertLabel = 'LVL';
  let vertClass = 'vr-level';
  if (vertRate >  1.5) { vertLabel = '▲ CLB'; vertClass = 'vr-climb'; }
  if (vertRate < -1.5) { vertLabel = '▼ DSC'; vertClass = 'vr-descend'; }

  return {
    icao24:    s[F.icao24],
    callsign,
    origin:    s[F.origin] || '??',
    lat:       s[F.lat],
    lon:       s[F.lon],
    altFt,
    speedKts,
    gsKts,
    heading,
    vertRate:  Math.round(vertRate * 196.85), // m/s → fpm
    vertLabel,
    vertClass,
    onGround:  s[F.on_ground],
    squawk:    s[F.squawk] || '----',
    type:      aircraftDB[s[F.icao24]]?.type  || '…',
    reg:       aircraftDB[s[F.icao24]]?.reg   || '…',
    dep:       aircraftDB[s[F.icao24]]?.dep   || '—',
    arr:       aircraftDB[s[F.icao24]]?.arr   || '—',
  };
}

// ── TYPE ENRICHMENT via hexdb.io ──────────────────────────────
const enrichQueue = new Set();

async function enrichTypes(list) {
  for (const ac of list) {
    if (aircraftDB[ac.icao24]?.type && aircraftDB[ac.icao24].type !== '…') continue;
    if (enrichQueue.has(ac.icao24)) continue;
    enrichQueue.add(ac.icao24);

    try {
      const res = await fetch(HEXDB_URL(ac.icao24));
      if (res.ok) {
        const d = await res.json();
        aircraftDB[ac.icao24] = {
          type: d.ICAOTypeCode || d.Type || 'N/A',
          reg:  d.Registration || 'N/A',
          dep:  '—',
          arr:  '—',
        };
        // Patch the live flight object
        const f = flights.find(x => x.icao24 === ac.icao24);
        if (f) {
          f.type = aircraftDB[ac.icao24].type;
          f.reg  = aircraftDB[ac.icao24].reg;
        }
        // If this is the selected one, refresh detail
        if (selected === ac.icao24) renderDetail(f || ac);
      }
    } catch (_) { /* silent */ }

    // Small delay to be polite to free API
    await sleep(150);
  }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── RENDER ALL ────────────────────────────────────────────────
function renderAll() {
  updateMarkers();
  renderFlightList(document.getElementById('searchInput').value.trim().toUpperCase());
  updateStats();
  document.getElementById('acCount').textContent = flights.length;
}

// ── MAP MARKERS ───────────────────────────────────────────────
function updateMarkers() {
  const seen = new Set();

  for (const ac of flights) {
    seen.add(ac.icao24);
    if (markers[ac.icao24]) {
      // Update position + rotation
      const m = markers[ac.icao24];
      m.setLatLng([ac.lat, ac.lon]);
      updatePlaneIcon(m, ac);
    } else {
      // Create marker
      const icon = makePlaneIcon(ac);
      const m = L.marker([ac.lat, ac.lon], { icon, zIndexOffset: 0 })
        .addTo(map)
        .bindPopup(() => makePopupHTML(ac), { maxWidth: 220 });
      m.on('click', () => selectAircraft(ac.icao24));
      markers[ac.icao24] = m;
    }
  }

  // Remove stale markers
  for (const [id, m] of Object.entries(markers)) {
    if (!seen.has(id)) {
      map.removeLayer(m);
      delete markers[id];
    }
  }
}

function makePlaneIcon(ac) {
  return L.divIcon({
    className: 'ac-marker',
    html: planeIconHTML(ac),
    iconSize:   [28, 28],
    iconAnchor: [14, 14],
    popupAnchor:[0, -14],
  });
}

function planeIconHTML(ac) {
  const cls = ac.onGround ? 'grounded' : (ac.icao24 === selected ? 'selected' : '');
  const rot = ac.heading || 0;
  return `<div class="plane-icon ${cls}" style="transform:rotate(${rot}deg)">
    <svg viewBox="0 0 24 24" fill="currentColor" width="22" height="22">
      <path d="M21 16v-2l-8-5V3.5A1.5 1.5 0 0 0 11.5 2A1.5 1.5 0 0 0 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5z"/>
    </svg>
  </div>`;
}

function updatePlaneIcon(marker, ac) {
  marker.setIcon(makePlaneIcon(ac));
  // Update popup content lazily
  marker.off('click').on('click', () => selectAircraft(ac.icao24));
}

function makePopupHTML(ac) {
  return `
    <div class="popup-call">${ac.callsign}</div>
    <div class="popup-type">${ac.type !== '…' ? ac.type : 'Type loading…'} ${ac.reg !== '…' ? '· '+ac.reg : ''}</div>
    <div class="popup-grid">
      <span class="lbl">ALT</span><span class="val">${fmt(ac.altFt, 'ft')}</span>
      <span class="lbl">SPD</span><span class="val">${fmt(ac.speedKts, 'kts')}</span>
      <span class="lbl">HDG</span><span class="val">${ac.heading}°</span>
      <span class="lbl">VERT</span><span class="val">${ac.vertLabel} ${ac.vertRate !== 0 ? ac.vertRate+' fpm' : ''}</span>
      <span class="lbl">SQWK</span><span class="val">${ac.squawk}</span>
      <span class="lbl">ORIG</span><span class="val">${ac.origin}</span>
    </div>`;
}

// ── FLIGHT LIST ───────────────────────────────────────────────
function renderFlightList(query = '') {
  const list = document.getElementById('flightList');
  const filtered = query
    ? flights.filter(a =>
        a.callsign.includes(query) ||
        (a.type && a.type.toUpperCase().includes(query)) ||
        (a.reg  && a.reg.toUpperCase().includes(query))
      )
    : flights;

  if (filtered.length === 0) {
    list.innerHTML = `<div class="empty-state">
      <i class="fa-solid fa-satellite-dish fa-2x"></i>
      <p>${query ? 'No matches for "'+query+'"' : 'No aircraft in range'}</p>
    </div>`;
    return;
  }

  // Sort: selected first, then by altitude desc
  const sorted = [...filtered].sort((a, b) => {
    if (a.icao24 === selected) return -1;
    if (b.icao24 === selected) return  1;
    return (b.altFt || 0) - (a.altFt || 0);
  });

  list.innerHTML = sorted.map(ac => `
    <div class="flight-card ${ac.icao24 === selected ? 'active' : ''}"
         data-id="${ac.icao24}" onclick="selectAircraft('${ac.icao24}')">
      <div class="fc-top">
        <span class="fc-callsign">${ac.callsign}</span>
        <span class="fc-type">${ac.type}</span>
      </div>
      <div class="fc-route">
        <strong>${ac.dep}</strong>
        <span class="arrow">→</span>
        <strong>${ac.arr}</strong>
        <span style="margin-left:auto;font-size:10px;color:var(--text-dim)">${ac.origin}</span>
      </div>
      <div class="fc-stats">
        <span class="${ac.vertClass}">
          <i class="fa-solid fa-${vertIcon(ac.vertRate)}"></i>
          ${ac.vertLabel}
        </span>
        <span><i class="fa-solid fa-gauge-high"></i>${fmt(ac.speedKts,'kts')}</span>
        <span><i class="fa-solid fa-mountain"></i>${fmt(ac.altFt,'ft')}</span>
      </div>
    </div>`).join('');
}

function vertIcon(vr) {
  if (vr >  100) return 'arrow-up';
  if (vr < -100) return 'arrow-down';
  return 'minus';
}

// ── SELECT AIRCRAFT ───────────────────────────────────────────
function selectAircraft(icao24) {
  selected = icao24;
  const ac = flights.find(f => f.icao24 === icao24);
  if (!ac) return;

  // Pan map
  map.flyTo([ac.lat, ac.lon], Math.max(map.getZoom(), 9), { duration: 1 });

  // Open popup
  if (markers[icao24]) {
    markers[icao24].openPopup();
    updatePlaneIcon(markers[icao24], ac); // refresh icon (selected style)
  }

  renderDetail(ac);
  renderFlightList(document.getElementById('searchInput').value.trim().toUpperCase());
}

// ── DETAIL PANEL ──────────────────────────────────────────────
function renderDetail(ac) {
  const panel = document.getElementById('detailContent');

  const altBar   = altitudeBar(ac.altFt);
  const spdBar   = speedBar(ac.speedKts);
  const vrClass  = ac.vertRate > 100 ? 'climb' : ac.vertRate < -100 ? 'descend' : 'level';
  const vrPct    = Math.min(100, Math.abs(ac.vertRate) / 30);

  panel.className = 'detail-content';
  panel.innerHTML = `
    <div class="detail-header">
      <div class="detail-callsign">${ac.callsign}</div>
      <div class="detail-type-badge">${ac.type !== '…' ? ac.type : '⌛ Loading type…'}</div>
      <div class="detail-icao">ICAO24: ${ac.icao24.toUpperCase()} &nbsp;|&nbsp; REG: ${ac.reg}</div>
    </div>

    <div class="route-row">
      <div class="route-airport">
        <div class="iata">${ac.dep}</div>
        <div class="name">Departure</div>
      </div>
      <div class="route-arrow"><i class="fa-solid fa-plane"></i></div>
      <div class="route-airport">
        <div class="iata">${ac.arr}</div>
        <div class="name">Arrival</div>
      </div>
    </div>

    <div class="metrics-grid">
      <div class="metric-card">
        <div class="m-label"><i class="fa-solid fa-mountain"></i>Altitude</div>
        <div class="m-value">${ac.altFt !== null ? ac.altFt.toLocaleString() : '—'}</div>
        <div class="m-unit">feet MSL</div>
      </div>
      <div class="metric-card">
        <div class="m-label"><i class="fa-solid fa-gauge-high"></i>Airspeed</div>
        <div class="m-value">${ac.speedKts !== null ? ac.speedKts : '—'}</div>
        <div class="m-unit">knots IAS</div>
      </div>
      <div class="metric-card">
        <div class="m-label"><i class="fa-solid fa-wind"></i>Ground Speed</div>
        <div class="m-value">${ac.gsKts !== null ? ac.gsKts : '—'}</div>
        <div class="m-unit">knots GS</div>
      </div>
      <div class="metric-card">
        <div class="m-label"><i class="fa-solid fa-compass"></i>Heading</div>
        <div class="m-value">${ac.heading}</div>
        <div class="m-unit">degrees true</div>
      </div>
    </div>

    <div class="detail-section-title">Vertical Rate</div>
    <div class="vert-bar-wrap">
      <div class="vert-bar-label">${ac.vertLabel}</div>
      <div class="vert-bar-outer">
        <div class="vert-bar-inner ${vrClass}" style="width:${vrPct}%"></div>
      </div>
      <div class="vert-bar-val">${ac.vertRate > 0 ? '+' : ''}${ac.vertRate} fpm</div>
    </div>

    <div class="detail-section-title" style="margin-top:14px">Flight Info</div>
    <div class="info-row">
      <span class="ir-label">Squawk</span>
      <span class="ir-value">${ac.squawk}</span>
    </div>
    <div class="info-row">
      <span class="ir-label">Origin Country</span>
      <span class="ir-value">${ac.origin}</span>
    </div>
    <div class="info-row">
      <span class="ir-label">On Ground</span>
      <span class="ir-value">${ac.onGround ? '✔ Yes' : '✖ No'}</span>
    </div>
    <div class="info-row">
      <span class="ir-label">Position</span>
      <span class="ir-value">${ac.lat.toFixed(4)}°, ${ac.lon.toFixed(4)}°</span>
    </div>

    <div style="margin-top:14px;padding:10px;background:var(--bg-card);border-radius:8px;border:1px solid var(--border);">
      <div class="detail-section-title" style="margin-bottom:6px">KDMW Info</div>
      <div class="info-row">
        <span class="ir-label">Airport</span>
        <span class="ir-value">KDMW / DMW</span>
      </div>
      <div class="info-row">
        <span class="ir-label">Location</span>
        <span class="ir-value">Westminster, MD</span>
      </div>
      <div class="info-row">
        <span class="ir-label">Elevation</span>
        <span class="ir-value">789 ft MSL</span>
      </div>
      <div class="info-row">
        <span class="ir-label">Runways</span>
        <span class="ir-value">16/34 (5100×100 ft)</span>
      </div>
    </div>
  `;
}

// ── STATS ─────────────────────────────────────────────────────
function updateStats() {
  const climbing   = flights.filter(f => f.vertRate >  100).length;
  const descending = flights.filter(f => f.vertRate < -100).length;
  const level      = flights.length - climbing - descending;
  const maxSpd     = flights.reduce((m, f) => Math.max(m, f.speedKts || 0), 0);
  const maxAlt     = flights.reduce((m, f) => Math.max(m, f.altFt   || 0), 0);

  document.getElementById('statTotal').textContent     = flights.length;
  document.getElementById('statClimbing').textContent  = climbing;
  document.getElementById('statDescending').textContent= descending;
  document.getElementById('statLevel').textContent     = level;
  document.getElementById('statMaxSpeed').textContent  = maxSpd;
  document.getElementById('statMaxAlt').textContent    = maxAlt.toLocaleString();
}

// ── STATUS ────────────────────────────────────────────────────
function setStatus(type, text) {
  const pill = document.getElementById('statusPill');
  const span = document.getElementById('statusText');
  pill.className = 'status-pill';
  if (type === 'ok')         pill.classList.add('ok');
  else if (type === 'error') pill.classList.add('error');
  span.textContent = text;
}

// ── TOAST ─────────────────────────────────────────────────────
function showToast(msg, duration = 3500) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  setTimeout(() => t.classList.add('hidden'), duration);
}

// ── HELPERS ───────────────────────────────────────────────────
function fmt(val, unit) {
  if (val === null || val === undefined) return '—';
  return `${val.toLocaleString()} ${unit}`;
}

function altitudeBar(altFt) {
  // 0–45000 ft range
  return Math.min(100, ((altFt || 0) / 45000) * 100);
}

function speedBar(kts) {
  // 0–600 kts range
  return Math.min(100, ((kts || 0) / 600) * 100);
}
