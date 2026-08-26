# ✈️ KDMW Flight Tracker

A real-time flight tracking web app centered on **Carroll County Regional Airport / Jack B Poage Field (KDMW)** in Westminster, Maryland.

![Aviation light-mode UI](https://img.shields.io/badge/UI-Aviation%20Light-0077cc)

It supports **two data sources**: the free OpenSky Network (default, no setup) or **FlightAware AeroAPI** (far better coverage, needs a free key + a tiny serverless proxy — see below).

## Features

- 🗺️ **Live interactive map** (Leaflet) with satellite & street basemaps, centered on KDMW with a 150 nm range ring
- ✈️ **Real-time aircraft positions** with heading-rotated plane icons that update every 30 seconds
- 🎯 **KDMW filter tabs** — toggle between **All** traffic, **KDMW** arrivals/departures only, and surrounding **Area** traffic. Flights tied to KDMW are highlighted in amber with a 🛫/🛬 tag and real departure→arrival airports.
- 📋 **Aircraft list panel** — searchable by callsign, aircraft type, or registration
- 🔍 **Detail panel** showing per-flight:
  - **Aircraft type** & registration (via hexdb.io)
  - **Departure / Arrival** route
  - **Altitude** (ft MSL)
  - **Airspeed** (knots)
  - **Ground speed** (knots)
  - **Heading**, vertical rate (climb/descend/level), squawk, origin country, position
- 📊 **Live stats bar**: total aircraft, climbing/descending/level counts, max speed & altitude
- 🕐 UTC + local clocks and an auto-refresh countdown
- 🔄 Manual refresh button

## Data Sources

| Data | Source | Auth |
|------|--------|------|
| Live aircraft (default) | [OpenSky Network REST API](https://openskynetwork.github.io/opensky-api/rest.html) | None (anonymous, rate-limited) |
| Live aircraft (optional, better) | [FlightAware AeroAPI](https://www.flightaware.com/commercial/aeroapi/) | API key (via Cloudflare Worker) |
| Aircraft type & registration (OpenSky mode) | [hexdb.io](https://hexdb.io) | None |
| Basemap tiles | OpenStreetMap / Esri World Imagery | None |

## Using FlightAware AeroAPI (recommended for full coverage)

OpenSky misses a lot of low-altitude general-aviation traffic around a small field like KDMW. FlightAware sees far more. Because an AeroAPI key is **secret and billable**, it must never live in the browser — so a tiny free **Cloudflare Worker** (`worker.js`) holds the key and relays requests:

```
browser  →  Cloudflare Worker (holds key)  →  FlightAware AeroAPI
```

**One-time setup (~5 min, free):**

1. Create a free [Cloudflare account](https://dash.cloudflare.com/sign-up).
2. Get an AeroAPI key: [FlightAware → My AeroAPI](https://www.flightaware.com/commercial/aeroapi/) (a free "Personal" tier is available).
3. Install the CLI: `npm install -g wrangler`
4. `wrangler login`
5. From this folder: `wrangler deploy`
6. Store your key as a **secret** (never in code): `wrangler secret put AEROAPI_KEY`
7. Copy the deployed Worker URL and paste it into **`app.js` → `CONFIG.WORKER_URL`**, then push.

When `WORKER_URL` is set, the app automatically switches to FlightAware; leave it blank to stay on OpenSky. Full steps are also commented at the top of `worker.js`.

> **AeroAPI billing:** the free tier includes a monthly allowance, then charges per query. The Worker caches responses ~20s and the app refreshes every 60s to conserve quota. Keep an eye on your FlightAware usage dashboard.

> **Note on ground speed:** OpenSky's ADS-B `velocity` field represents ground speed derived from the aircraft's velocity vector, so airspeed and ground speed are shown from the same source. True indicated airspeed is not broadcast over ADS-B.

## Running It

No build step, no dependencies to install — it's plain HTML/CSS/JS.

```bash
# Option 1: open directly
open index.html

# Option 2: serve locally (recommended, avoids any CORS quirks)
python3 -m http.server 8000
# then visit http://localhost:8000
```

## Airport Reference — KDMW

- **Name:** Carroll County Regional Airport / Jack B Poage Field
- **Location:** Westminster, MD
- **Coordinates:** 39.6083° N, 77.0077° W
- **Elevation:** 789 ft MSL
- **Runway:** 16/34 (5,100 × 100 ft)

## Notes & Limitations

- OpenSky anonymous access is rate-limited; the app refreshes every 30 s to stay well within limits.
- Aircraft type lookups are throttled (top 20 aircraft per cycle) to be polite to the free hexdb.io service.
- **How KDMW flights are identified:** live positions (`states/all`) don't include origin/destination. The app separately queries OpenSky's `flights/arrival` and `flights/departure` endpoints for KDMW over the last 24h, then cross-references those aircraft (by ICAO24 hex) against the live traffic. Matches are tagged as KDMW arrivals/departures with real airport codes; everything else is shown as area traffic.
- **KDMW is a small GA field** with limited ADS-B receiver coverage, so there may be periods with **zero** recorded arrivals/departures — the "KDMW" tab will be empty then, while "All"/"Area" still show surrounding traffic.
- **Proximity tagging:** because OpenSky only associates a plane with KDMW *after* a completed arrival/departure, aircraft currently **circling or in the pattern** won't appear in those records. To catch them, the app also tags any live aircraft within **12 nm of the field and below 6,000 ft** as `🔄 Local / pattern` traffic.
- **Why FlightAware shows more aircraft:** FlightAware combines FAA data with a much denser private receiver network, so it sees traffic — especially low-altitude general aviation — that the free OpenSky network misses entirely. This is a fundamental data-source limitation, not an app bug. Independent comparisons have found OpenSky has notably less coverage than FlightAware/Flightradar24.
- "Departure/Arrival" airports are only shown for KDMW-associated flights; for pure area traffic they display `—`.
- If OpenSky is temporarily unreachable, the app keeps the last known data and shows a toast.

## Files

```
kdmw-tracker/
├── index.html      # markup + layout
├── style.css       # aviation light-mode theme
├── app.js          # map, data fetching, rendering (OpenSky + AeroAPI)
├── worker.js       # Cloudflare Worker proxy for FlightAware AeroAPI
├── wrangler.toml   # Worker deploy config
└── README.md
```
