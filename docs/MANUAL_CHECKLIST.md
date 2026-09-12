# Manual checklist — what only you can do

Everything in the 15-day plan that cannot be completed from a terminal, grouped by why it is blocked. **Nothing here is a code task.** Each item names the day it came from, what it unblocks, and roughly how long it takes.

**Total on the critical path: about 45 minutes of account setup.** Everything else is optional or waits on the frontend rebuild.

---

## ✅ Deployed — verified live 2026-09-12

Both services are up and answering:

| | |
|---|---|
| API | `https://niyantrana-api.onrender.com/health` → `status: ok`, `database: connected` |
| Inference | `https://niyantrana-inference.onrender.com/health` → `status: ok`, `functional: true` |

Confirmed working in production: register → login (**cookie issued, so `TRUST_PROXY` is right**) → authenticated request → food search returning *Mutton biryani/biriyani* (**foods seeded**) → 90 days of demo data → `v2.0.0` tagged, preflight clean.

---

## ✅ Priority 0 — both production bugs fixed and verified

You pushed; production picked it up. Verified live:

| Check | Result |
|---|---|
| `/api/inference/health` | `reachable: true`, url reported |
| `/api/predict` | **`provenance: "model"`**, 4 risks, 4 trajectories |
| `/api/chat` | **`source: gemini`, `grounded: true`** — and the reply quoted the user's own 57/100 score |
| `/api/recommend` | `source: rag` |

That closes the last Definition-of-done item. `/api/chat` and `/api/recommend`
had never once succeeded before this point.

---

## Priority 1 — one push, now covering three fixes

**Deploy both services together.** The cold-start fix is split across them: the
frontend asks for `?wake=1`, and only the new backend honours it. Rebuild the
client without redeploying the API and the wake call still aborts after 5
seconds, which is the bug.

### Fix 3 — the cold-start wake-up call never woke anything

`GET /api/inference/health` used a **5-second** timeout. A spun-down Render
container measured **34.9 seconds** just to answer it, so the call aborted seven
times too early, reported `reachable: false`, and started nothing. The dashboard
then tried once and stopped — which is why twenty minutes of waiting produced no
further requests, while a `curl -m 120` woke the service immediately.

Fixed with `?wake=1`, which waits out the full cold-start window, plus up to
three wake-and-retry rounds in the dashboard with the elapsed time on screen.

### Fix 1 and 2 — RAG retrieval was silently ungrounded

`/api/recommend` worked but returned `alternatives_considered: []` every time,
so Gemini was improvising while being told "do not invent new dishes".

**Cause: a units mismatch making the filter unsatisfiable.** The caller sends a
whole portion (650 kcal, 24 g protein); the database stores per-100 g rows
(median 4.0 g protein, **max 21.6 g**). The floor `protein >= 0.9 x 24 = 21.6 g`
could not be met by **any** of the 1,014 foods.

Fixed by comparing macronutrient **ratios** (grams per kcal), which are
unit-invariant. Retrieval now returns real suggestions:

| Meal | Retrieved |
|---|---|
| Mutton Biryani | Spinach mutton, Mutton seekh kebab, Kashmiri mutton koftas |
| Paneer Butter Masala | Paneer soup, Spinach paneer, Paneer shaslik/tikka |
| Chicken (fried) | Chicken stock, Chicken curry, **Tandoori chicken** |

Two further fixes on top:

- **It used to suggest the dish you just ate.** Per-100 g rows beat a whole
  portion on fat-per-calorie, so "Mutton Biryani" retrieved "Mutton biryani".
  Now excluded by word-set comparison.
- **Near-misses are labelled.** When nothing clears both thresholds the
  retriever returns the leanest options rather than nothing, but tags them
  `strictly_better: False` and the prompt heading changes to "Similar Dishes
  (none were strictly leaner)". Calling a near-miss "healthier" would push an
  overstatement through the model and on to the user.

18 new tests. **Deploy with one push:**

```bash
git add -A && git commit -m "Fix RAG retrieval units mismatch"
git push
```

Then confirm `alternatives_considered` is no longer empty:

```bash
curl -s -b j -X POST https://niyantrana-api.onrender.com/api/recommend   -H 'Content-Type: application/json'   -d '{"meal":{"name":"Paneer Butter Masala","calories":480,"fat":36,"protein":14}}'   | jq '.alternatives_considered'
```

---

## Priority 2 — Optional, improves the portfolio

### ☐ GitHub Student Developer Pack — ~1 day approval

DigitalOcean $200 + Azure $100. Buys always-on hosting if the 15-minute cold starts annoy you. Apply early because of the queue.

### ☐ NFHS-5 / DHS Program registration *(Day 4)* — 1–2 day approval

`dhsprogram.com`, free, short project description. ~700,000 Indians with BP, blood glucose and BMI.

**What it unblocks:** the model is currently **US-calibrated** (NHANES). South Asians develop metabolic disease at lower BMI and waist thresholds, so every score is systematically off for the target population. This is the single biggest scientific gap remaining.

**LASI** (`g2aging.org`, ~72,000 Indians **with HbA1c and BP biomarkers**) is the stronger option if you only do one — it has actual biomarkers, which NFHS-5 lacks.

### ☐ Update the pitch decks *(Day 15)*

Both `Main-idea.pptx` and `PU-idea.pptx` slide 8 still literally read `RMSE = __, R² = __`. Fill in:

```
Hypertension  AUROC 0.802   sensitivity 91%
Dysglycaemia  AUROC 0.799   sensitivity 93%
Diabetes      AUROC 0.799   sensitivity 90%
Fatty liver   AUROC 0.958   sensitivity 92%   (see caveat below)

Trained on NHANES 2013-2018, n = 17,961 adults.
Reported on a cycle holdout: train 2013-16, test 2017-18.
```

Two edits that matter more than the numbers:

- **Remove UK Biobank** from the data-sources slide. It costs £3,000–9,000 and takes months; it was never realistic. Replace with NHANES (free, no application) and NFHS-5 / LASI.
- **Caveat the fatty-liver figure.** 0.958 is close to a tautology: `bmi + waist` alone scores 0.9548, so the other 14 features add +0.003. Quoting it bare is the same category of error as v1's fake 0.974.

I can't edit .pptx reliably, so this one is genuinely manual.

### ☐ Final commit and tag *(Day 15)*

Deliberately left to you — I don't commit without being asked.

```bash
git add -A && git commit -m "Niyantrana v2: real-data risk engine, honest provenance"
git tag -a v2.0.0 -m "v2.0.0"
```

---

## Frontend — built; three items left for you

The client is rebuilt: landing, sign in, onboarding, dashboard, logging and the
assistant. It was verified against the **deployed** API, not against fixtures --
a real assessment was fetched from production and rendered through the real
dashboard component, so the field names match what the server actually sends.

Done, so these are off your list:

| Item | Day | Evidence |
|---|---|---|
| Loading / error / empty states | 14 | Every screen has all four: skeletons, a not-enough-data refusal, a model-unavailable state with a retry, and empty states that say what is missing |
| Mobile responsiveness pass | 14 | Checked in a browser at 390px; the nav collapses to icons and the chart drops its label rail and reclaims the width |
| Bundle-size check | 14 | 24.6 kB gzip entry + 77.7 kB React; the 107.7 kB chart chunk loads only on the dashboard |
| Render smoke check | — | `npm run smoke` mounts all nine trees through react-dom/server |
| Cold-start handling | — | `?wake=1` holds a request open for the whole cold-start window (the plain 5s probe aborted 7x too early and woke nothing); landing and sign-in prewarm with it, and a 503 on the dashboard runs up to three wake-and-retry rounds with elapsed seconds shown |

Still yours, because they need accounts or a device:

### ☐ Deploy the client to Cloudflare Pages *(Day 12)* — ~15 minutes

Full steps, including the `CORS_ORIGIN` change that is easy to miss, are in
[DEPLOYMENT.md](DEPLOYMENT.md#4b-deploy-the-web-client-cloudflare-pages).

### ☐ Verify cookies across origins, from a phone *(Day 12)*

The definition-of-done item. After the client is hosted: sign up, complete
onboarding, load the demo history, and confirm the dashboard shows model-derived
scores — on mobile data, not wifi. Then **reload the page** and confirm you are
still signed in; that is the check that catches a cross-site cookie problem.

### ☐ Screenshots and a short GIF for the README *(Day 14)*

Now possible. The dashboard with 90 days of demo history is the one to capture;
the trajectory chart is the screen that shows this is not a CRUD app.

Also worth running once the client is hosted: **Lighthouse** (Chrome devtools ->
Lighthouse -> Analyze). Nothing in the build is knowingly failing it, but I have
not run it against a real deployment.

## Google sign-in and Google Health — console setup is yours

The code is built and tested; none of it does anything until the Google Cloud
project is configured, and only you can do that. Project `niyantrana-backend`
already exists, so this is configuration, not creation.

### ☐ 1. One OAuth client, for both features — ~10 minutes

`console.cloud.google.com`, project **niyantrana-backend**:

1. **APIs & Services → Library →** enable **Google Health API**.
2. **APIs & Services → OAuth consent screen** (Branding / Audience in the new
   console): app name, support email, and a **privacy policy URL and terms URL**.
   The Health scopes will not pass verification without those two, and the
   consent screen looks untrustworthy without them even in testing.
3. **Audience → Test users → Add users.** Add your own Google account, plus
   anyone who should be able to connect. **This is the gate that matters:** every
   Health API scope is Restricted, so until the app passes OAuth verification
   only these accounts can complete the flow. Up to 100.
4. **Credentials → Create credentials → OAuth client ID → Web application:**

   | Field | Value |
   |---|---|
   | Authorised JavaScript origins | `http://localhost:5173` and your Pages URL |
   | Authorised redirect URIs | `http://localhost:8080/auth/google/health/callback` and `https://niyantrana-api.onrender.com/auth/google/health/callback` |

   The redirect URI must match **exactly** — scheme, host, port, path, no
   trailing slash. A mismatch is Google's most common `redirect_uri_mismatch`.

### ☐ 2. Set five environment variables — ~5 minutes

Backend (`.env` locally, Environment on Render):

```
GOOGLE_CLIENT_ID=<client id>
GOOGLE_CLIENT_SECRET=<client secret>
GOOGLE_HEALTH_REDIRECT_URI=https://niyantrana-api.onrender.com/auth/google/health/callback
GOOGLE_HEALTH_RETURN_URL=https://<your-pages-url>/onboarding
```

Frontend (`.env`, or the Pages build environment):

```
VITE_GOOGLE_CLIENT_ID=<the same client id>
```

The client ID is public by design; the **secret** goes only in the backend. If
`VITE_GOOGLE_CLIENT_ID` is unset the Google button simply does not render, and
the password form still works — so a half-configured deployment degrades
instead of breaking.

### ☐ 3. Put some data in the account — ~5 minutes

A brand-new Google account has no health data, so a sync will correctly return
nothing. Either pair a device, or install the **Google Health** app and log a
few entries by hand — Google's own codelab uses exactly that method, so **no
Fitbit or Pixel Watch is required**.

### ☐ 4. Verify, and read the field report

Sign in → onboarding → **Connect Google Health** → grant access. The app syncs
automatically on return and prints a per-feature report:

```
daily steps              84 days
active minutes           84 days
sleep                    79 days
resting heart rate       84 days
heart rate variability   61 days
```

**Read that report rather than assuming.** The published API reference names
some value fields exactly and describes others only as "interval data", so the
adapter resolves each feature against candidate field paths. A feature showing
`none` means its field name differs from every candidate — tell me what the
report says and I will correct the mapping. It never writes a zero to cover a
gap, so a wrong guess shows up as a missing feature, not as bad data.

### ☐ 4b. Branding verification — fixing the two rejections

Both errors from the verification attempt are configuration, and the pages they
need now exist in the build (`/privacy` and `/terms`, static HTML).

**Error 1: "The website of your homepage URL is not registered to you."**

Google checks domain ownership in Search Console at the **top private domain**
level, not the subdomain — so verifying `niyantrana.agnivesh.dev` is not enough,
you must verify **`agnivesh.dev`**.

1. `search.google.com/search-console`, signed in as the **same Google account
   that owns the Cloud project** (agniveshshaga@gmail.com). A different account
   is the most common reason this keeps failing after "successful" verification.
2. Add property → **Domain** (not URL prefix) → `agnivesh.dev`.
3. Add the TXT record it gives you at your DNS provider, then Verify. A Domain
   property covers every subdomain, including this app's.

**Error 2: "Your privacy policy page does not have sufficient content."**

The cause is visible in the Branding form: the home page, privacy policy and
terms fields all point at `https://niyantrana.agnivesh.dev` — the same page,
which contains no policy. Set them to three distinct URLs:

| Field | Value |
|---|---|
| Application home page | `https://niyantrana.agnivesh.dev` |
| Application privacy policy link | `https://niyantrana.agnivesh.dev/privacy` |
| Application Terms of Service link | `https://niyantrana.agnivesh.dev/terms` |
| Authorised domain 1 | `agnivesh.dev` (already correct) |

**Deploy the new build first**, or those two URLs will 404 and the rejection
repeats. Then confirm the content is readable **without JavaScript**, which is
how the crawler sees it:

```bash
curl -s https://niyantrana.agnivesh.dev/privacy | grep -c "Limited Use"   # expect 2
curl -s https://niyantrana.agnivesh.dev/terms   | grep -c "Terms of Service"
```

Those two pages are deliberately static HTML rather than app routes: a
client-rendered route returns an empty shell to anything that does not run
JavaScript, which reads to a reviewer as exactly the "insufficient content"
failure above.

The homepage requirements are also now met in code — the landing page explains
what Google data is requested and why, and links the privacy policy in its
footer, both of which Google's homepage rules require.

Then reopen the issues dialog, choose **I have fixed the issues**, and Proceed.

**What passing branding does and does not buy you.** Branding verification makes
your name and logo show on the consent screen and lets you publish. It is *not*
the restricted-scope review. Expect:

- **Sign in with Google** — works for everyone once published, because
  `openid email profile` are non-sensitive.
- **Connect Google Health** — still test-users-only, because those scopes are
  Restricted and need the separate security assessment. The onboarding card
  already says so on screen, so this degrades honestly rather than erroring.

### ☐ 5. Optional: OAuth verification, for anyone beyond your test users

Only needed if strangers should be able to connect their own health data.
Requires the privacy policy and terms from step 1, a demo video, and a
**third-party security review**. For a portfolio project this is usually not
worth it: sign-in with Google works for everyone regardless, and reviewers can
use the demo history. Decide deliberately rather than by default.

---

## Known gaps I could not close

Honest list. None of these block a deploy; all belong in the README's limitations section, where they already are.

| Gap | Why it's open |
|---|---|
| **Model is US-calibrated** | Needs NFHS-5 / LASI (above). The most significant scientific limitation |
| **Self-report vs sensor mismatch unquantified** | NHANES measures sleep/activity by questionnaire; the app uses sensors. NHANES `PAXDAY` accelerometry could quantify it — it's paired within-person |
| **GGT is unpredictable** (R² −0.001) | Genuinely not learnable from lifestyle features. Reported as a negative result |
| **High probabilities are overconfident** | Dysglycaemia predicts 0.88 where 0.64 are observed. Thin bins (n=22), partly noise |
| **Trajectory driven by wearable change only** | The profile is held constant across the window walk, so it understates improvement for someone also losing weight. Needs historical profile snapshots |
| **Google Health is limited to test users** | The integration is built and tested, but every Health scope is Restricted, so only accounts added in the Google Cloud console can connect until the app passes OAuth verification (which needs a third-party security review). Not a code limitation |

---

## Quick status

| | |
|---|---|
| Tests | **185** — 102 Python, 83 Node |
| npm vulnerabilities | 0 |
| Inference image | 627 MB, runs at 145 MiB of a 512 MiB cap |
| `/predict` latency | 54–66 ms in-container |
| Fabricated health values in any `src/` tree | **0** |
| npm vulnerabilities (frontend) | 0 |
| Frontend entry bundle | 24.6 kB gzip; chart chunk lazy-loaded |
| Deployed | ✅ Live and fully working; one push pending for the RAG fix |
