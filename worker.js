/* ============================================================
   KDMW Flight Tracker — Cloudflare Worker proxy for FlightAware AeroAPI
   ------------------------------------------------------------
   WHY THIS EXISTS
   Your AeroAPI key is a *secret*. It must never be placed in the
   browser (app.js) because anyone could copy it from your public
   GitHub Pages site and run up charges on your account. AeroAPI
   also does not allow direct browser (CORS) calls.

   This tiny Worker sits between the browser and AeroAPI:
     browser  ->  this Worker (holds the key)  ->  AeroAPI
   It adds the key server-side and returns CORS-friendly JSON.

   ------------------------------------------------------------
   DEPLOY (free, ~2 minutes)
   1. Create a free Cloudflare account: https://dash.cloudflare.com/sign-up
   2. Get a FlightAware AeroAPI key:
      https://www.flightaware.com/commercial/aeroapi/  -> "My AeroAPI"
   3. Install Wrangler:   npm install -g wrangler
   4. Log in:             wrangler login
   5. From this folder:   wrangler deploy
   6. Store your key as a secret (NOT in code):
                          wrangler secret put AEROAPI_KEY
      (paste your AeroAPI key when prompted)
   7. Copy the deployed Worker URL (e.g. https://kdmw-proxy.<you>.workers.dev)
      and paste it into app.js -> CONFIG.WORKER_URL
   ============================================================ */

const AEROAPI_BASE = 'https://aeroapi.flightaware.com/aeroapi';

// Only allow requests to these AeroAPI paths (prevents the proxy being abused)
const ALLOWED_PREFIXES = [
  '/airports/',   // /airports/KDMW/flights
  '/flights/',    // /flights/search
];

export default {
  async fetch(request, env) {
    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    // Preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: cors });
    }

    const url = new URL(request.url);
    // The path the browser wants to hit on AeroAPI, e.g. "/airports/KDMW/flights"
    const apiPath = url.searchParams.get('path');

    if (!apiPath || !ALLOWED_PREFIXES.some(p => apiPath.startsWith(p))) {
      return json({ error: 'Missing or disallowed "path" query param' }, 400, cors);
    }

    if (!env.AEROAPI_KEY) {
      return json({ error: 'Server missing AEROAPI_KEY secret' }, 500, cors);
    }

    // Forward any extra query params (e.g. max_pages, type) to AeroAPI,
    // except our own "path" control param.
    const forward = new URLSearchParams(url.searchParams);
    forward.delete('path');
    const qs = forward.toString();
    const target = `${AEROAPI_BASE}${apiPath}${qs ? '?' + qs : ''}`;

    try {
      const resp = await fetch(target, {
        headers: {
          'x-apikey': env.AEROAPI_KEY,
          'Accept': 'application/json; charset=UTF-8',
        },
      });
      const body = await resp.text();
      return new Response(body, {
        status: resp.status,
        headers: {
          ...cors,
          'Content-Type': 'application/json; charset=UTF-8',
          // Cache briefly at the edge to conserve your AeroAPI quota
          'Cache-Control': 'public, max-age=20',
        },
      });
    } catch (err) {
      return json({ error: 'Upstream fetch failed', detail: String(err) }, 502, cors);
    }
  },
};

function json(obj, status, cors) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}
