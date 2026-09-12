# Niyantrana web client

React 18 + Vite + Tailwind. Six screens, no mock data, no secrets in the bundle.

```bash
npm install
npm run dev      # http://localhost:5173, proxying /api and /auth to :8080
npm run build    # production bundle into dist/
npm run smoke    # renders every screen through react-dom/server
```

## Screens

| Route | What it does |
|---|---|
| `/` | Overview. Headline metrics, what the model is built on, and the limitations, stated on the page rather than buried |
| `/signin` | Sign in and sign up against Passport **session cookies** |
| `/onboarding` | Profile, then wearable history (device export or seeded demo) |
| `/dashboard` | Four risk cards, the trajectory chart, estimated biomarkers, and what the assessment was computed from |
| `/log` | Meal logging against the Indian food database, and measured vitals |
| `/assistant` | Server-proxied Gemini chat, with grounding shown per reply |

## What this client will not do

These are structural, not conventions:

- **It never invents a health number.** There is no client-side scoring, no
  placeholder score, and no fallback value. When `/api/predict` fails, the
  dashboard shows why — a refusal for too little data, an unavailable state for
  a sleeping model service — and shows no score at all. The version this
  replaces rendered `Math.floor(Math.random() * 100)` as an AI risk assessment.
- **It never asserts nutrition figures.** Meal logging sends a food code and a
  serving count; the server resolves the macros. A browser cannot claim an
  intake the model would then believe.
- **It holds no secrets.** Anything `VITE_`-prefixed is inlined into the bundle,
  so the only such variable is `VITE_API_BASE_URL`. The Gemini key stays on the
  server behind `POST /api/chat`.
- **It shows provenance.** Every score displays where it came from and what it
  was computed from, because the API makes both required fields.

## Configuration

One variable, in `.env`:

```
VITE_API_BASE_URL=https://niyantrana-api.onrender.com
```

Leave it unset in development: the client then calls its own origin and the Vite
proxy forwards to `127.0.0.1:8080`, so the browser and API are same-origin and
the session cookie needs no cross-site handling. In production the two are on
different hosts and the API answers with `SameSite=None; Secure`.

## Design system

Tokens live in [`src/index.css`](src/index.css) as CSS custom properties and are
mapped into Tailwind in [`tailwind.config.js`](tailwind.config.js) — the
shadcn/ui convention, so a component copied from a registry such as
[21st.dev](https://21st.dev) themes itself with no edits. Primitives are in
[`src/ui/primitives.jsx`](src/ui/primitives.jsx).

The four chart series are the first four slots of a validated categorical
palette, checked with a data-viz validator against the white card surface rather
than chosen by eye. Two of the four fall below 3:1 contrast against white, which
is why the trajectory chart ships a legend, direct labels on every line, and a
table view: below 3:1, colour is a hint and the label is the identity. The risk
band ramp is separate from the series ramp so a band can never impersonate a
series, and every band pairs its colour with an icon and the word.

## Layout checks

`npm run smoke` mounts every screen but cannot verify the chart: Recharts
measures its container on mount, so server-rendered markup contains an empty
SVG. The chart and the phone layout were checked in a real browser at 1280px
and 390px, against a response captured from the deployed API.
