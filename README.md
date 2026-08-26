# ✈️ KDMW Flight Tracker

A real-time flight tracking web app centered on **Carroll County Regional Airport / Jack B Poage Field (KDMW)** in Westminster, Maryland.

![Aviation dark-mode UI](https://img.shields.io/badge/UI-Aviation%20Dark-00c8ff)

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
| Live aircraft state vectors | [OpenSky Network REST API](https://openskynetwork.github.io/opensky-api/rest.html) | None (anonymous, 10s+ rate limit) |
| Aircraft type & registration | [hexdb.io](https://hexdb.io) | None |
| Basemap tiles | OpenStreetMap / Esri World Imagery | None |

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
- "Departure/Arrival" airports are only shown for KDMW-associated flights; for pure area traffic they display `—`.
- If OpenSky is temporarily unreachable, the app keeps the last known data and shows a toast.

## Files

```
kdmw-tracker/
├── index.html   # markup + layout
├── style.css    # aviation dark-mode theme
├── app.js       # map, data fetching, rendering logic
└── README.md
```
