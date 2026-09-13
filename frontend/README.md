# Niyantrana web client

React 18 + Vite + Tailwind. Seven screens, no mock data, no secrets in the bundle.

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
| `/signin` | Sign in with Google, or email and password, against Passport **session cookies** |
| `/onboarding` | Profile, then wearable history — connect Google Health, upload a Samsung Health archive, import a device export, or seed a demo |
| `/dashboard` | Four risk cards, the trajectory chart, estimated biomarkers, and what the assessment was computed from |
| `/log` | Meal logging against the Indian food database, and measured vitals |
| `/assistant` | Server-proxied Gemini chat, with grounding shown per reply |
| `/profile` | The eight values the model scores you on, editable; where your history came from, by source; and account deletion |

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

## Google

Two separate features behind one OAuth client, with very different reach:

- **Sign in with Google** uses only `openid email profile` — non-sensitive
  scopes, no review, works for everyone. The button is rendered by Google
  Identity Services; the ID token it returns is verified server-side against
  Google's public keys, so nothing about the signed-in user is taken from the
  browser's word. Set `VITE_GOOGLE_CLIENT_ID` to enable it; leave it unset and
  the button does not render and the password form still works.
- **Connect Google Health** reads real wearable data. Every Health API scope is
  Restricted, so it works for accounts added as test users in the Google Cloud
  console until the app passes OAuth verification. The onboarding card says so
  before you click it rather than leaving you to discover it at Google's consent
  screen.

A client ID is not a secret — Google's own documentation puts it in page source.
The client *secret* exists only on the server.

## Cold starts

Both backend services spin down after fifteen minutes idle on their free tier,
and the inference container needs the best part of a minute to come back — so
without handling, the first visit after a quiet spell lands on "the model is
not answering", which describes a working system as a broken one.

Two things handle it, and the detail that makes them work is the timeout:

- **`GET /api/inference/health?wake=1`** holds the request open for the whole
  cold-start window. Without `wake=1` the same endpoint is a 5-second monitoring
  probe — and a spun-down container measured **34.9 seconds** just to answer, so
  the probe aborted seven times too early and reported the service unreachable
  at exactly the moment it was booting. It woke nothing.
- The landing and sign-in screens fire that wake call on mount, so the container
  starts while the visitor reads and types. On a 503 the dashboard runs up to
  **three wake-and-retry rounds**, showing elapsed seconds and the attempt
  number. If a wake call gives up, the next round waits again rather than
  spending an assessment attempt on a container that has not finished starting.

Bounded at three rounds, not an endless poll: a service that will not start is a
real fault, and hiding it behind an indefinite spinner is the other failure
mode. Both paths were verified with a stubbed slow container — first wake gives
up, second succeeds, dashboard loads with no error shown.

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
