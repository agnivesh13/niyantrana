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

## Priority 1 — one more push (RAG retrieval was silently ungrounded)

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

## Known gaps I could not close

Honest list. None of these block a deploy; all belong in the README's limitations section, where they already are.

| Gap | Why it's open |
|---|---|
| **Model is US-calibrated** | Needs NFHS-5 / LASI (above). The most significant scientific limitation |
| **Self-report vs sensor mismatch unquantified** | NHANES measures sleep/activity by questionnaire; the app uses sensors. NHANES `PAXDAY` accelerometry could quantify it — it's paired within-person |
| **GGT is unpredictable** (R² −0.001) | Genuinely not learnable from lifestyle features. Reported as a negative result |
| **High probabilities are overconfident** | Dysglycaemia predicts 0.88 where 0.64 are observed. Thin bins (n=22), partly noise |
| **Trajectory driven by wearable change only** | The profile is held constant across the window walk, so it understates improvement for someone also losing weight. Needs historical profile snapshots |
| **No live wearable OAuth** | Every API a solo developer could register for has closed (Fitbit sunset this month; Google Health API gated behind restricted-scope review). Withings and Oura remain open if you want one |

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
