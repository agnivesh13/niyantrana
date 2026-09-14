# Niyantrana

Metabolic risk screening for an Indian user base — fatty liver, dysglycaemia and hypertension — estimated from what a person eats, how they move and how they sleep.

> **Live:** [niyantrana.agnivesh.dev](https://niyantrana.agnivesh.dev) · [API health](https://niyantrana-api.onrender.com/health) · [inference health](https://niyantrana-inference.onrender.com/health)
>
> Both services run on Render's free tier and spin down after 15 minutes idle. The app wakes them itself — the landing page starts the model container while you read, and the dashboard retries around a cold start — so the first visit of the day takes about 40 seconds rather than failing.
>
> **242 tests** (138 Node, 104 Python). Setup that needs your own accounts is in [docs/SETUP.md](docs/SETUP.md).
>
> **Not a medical device.** Screening and education only. Every risk score carries this disclaimer in the API response.

---

## The problem

About 1 in 3 Indians has fatty liver, ~16% of adults have type-2 diabetes, ~25% have hypertension — and these cluster: over 70% of diabetics also have fatty liver. Blood tests catch them late and episodically.

Diet, steps, sleep and heart rate, by contrast, are continuous. So: **estimate metabolic risk from behaviour, and show how it moves.**

## What it actually does

```
profile + meal logs + wearable history
        ↓
Risk Engine  (gradient boosting, trained on 17,961 real NHANES adults)
        ↓
4 calibrated risks + estimated biomarkers + a trajectory over time
        ↓
RAG meal recommendations from 1,014 Indian foods (Anuvaad INDB)
```

| Output | Source |
|---|---|
| Condition probability | Calibrated classifier |
| Biomarker levels (HbA1c, BP, TG, GGT, FLI) | Regression engine |
| Why the score is what it is | Clinical scorers + SHAP |
| Risk over time | The same model over rolling 14-day windows |
| Anything you measured | **Overrides every estimate** |

---

## Honest results

Trained on NHANES 2013–2018. Reported on a **cycle holdout** — train 2013–16, test 2017–18 — because "does this survive a survey wave collected years later" is the question that matters.

### Classification

| Condition | Prevalence | AUROC | Sensitivity | Specificity | PPV |
|---|---|---|---|---|---|
| Hypertension | 49.8% | **0.802** | 91% | 0.53 | 0.66 |
| Dysglycaemia | 41.2% | **0.799** | 93% | 0.43 | 0.54 |
| Diabetes | 16.9% | **0.799** | 90% | 0.55 | 0.29 |
| Fatty liver | 42.7% | 0.958 | 92% | 0.83 | 0.80 |

Operating points target **90% sensitivity**, not accuracy. This is screening: missing an at-risk person costs more than a false alarm that resolves with a blood test. The consequence is low PPV — at the diabetes threshold, roughly 7 of 10 flagged people don't have it. The product wording says *get tested*, never *you have this*.

### Two numbers that need an asterisk

**Fatty liver's 0.958 is close to a tautology.** FLI is a formula whose four terms include BMI and waist — which we *measure*, not estimate. A classifier on `bmi + waist_cm` alone scores **0.9548**; the other 14 features add **+0.003**. A test keeps that baseline recorded so the headline can never be quoted bare.

**GGT is unpredictable from lifestyle** (R² −0.001). It's driven by alcohol, medication and genetics. Reported as a negative result.

Full write-up, including the ablation and every limitation: **[ml/RESULTS.md](ml/RESULTS.md)**

---

## Validating the model before trusting it

An LSTM over 14-day synthetic windows reported **R² 0.900 (triglycerides) / 0.974 (GGT)**. Numbers that good on a problem this hard are a reason to audit the split, not to celebrate it. Both figures were artifacts:

| | |
|---|---|
| Leak 1 | `MinMaxScaler.fit_transform` ran on all 5,475 rows **before** the train/test split |
| Leak 2 | The split was random over 14-day sliding windows overlapping by **13 of 14 days**, same 15 users on both sides |
| Corrected | Split by **disjoint user**, scalers fit on train only → **R² −0.89 / −0.87** — worse than predicting the mean |

The serving path had the same character. Concatenating a 1-row profile with a 14-row window on `axis=1` left the tabular branch all-NaN, so every user received a bit-identical prediction — a healthy 20-year-old and a high-risk 73-year-old both returned `153.47 / 34.44`. It never raised. It returned a confident number, which is the failure mode the provenance rule below exists to make impossible. A regression test now asserts that two different profiles produce two different predictions.

Fifteen synthetic personas is **nine training examples at the person level**, and no architecture recovers from that. Hence real data.

### And the one that mattered most

While building the trajectory feature, a mid-range profile showed **hypertension risk rising (+0.79/week) as activity and sleep improved.** Gradient boosting fits non-monotonic relationships freely, and it did. Every aggregate metric looked fine — AUROC 0.80, calibration within 0.05. Only walking a trajectory exposed it.

Fixed with monotonic constraints on activity and sedentary time, at a cost of **≤0.005 AUROC**. Sleep is deliberately left unconstrained: it's U-shaped clinically. A test now asserts that improving behaviour never raises any risk, across four profiles.

---

## The rule the architecture enforces

**No layer ever invents a number.**

Every risk value carries a `provenance` (`model` / `simulation` / `heuristic` / `unavailable`) and a `basis` (`calibrated_classifier` / `clinical_formula`). Provenance is a **required** field on `RiskScore`, on the API response, and on the Mongoose schema — so a score cannot be returned or persisted without declaring where it came from.

The rule is a type rather than a convention because the moment a substituted value is most tempting is the moment it is most harmful — and a caller cannot distinguish a fabricated number from a real one when both arrive as HTTP 200.

| Situation | Response |
|---|---|
| Inference service unreachable | **503**, `provenance: "unavailable"`, no scores |
| Wearable history too short to score | **400** naming how many days exist |
| FLI inputs incomplete | `null` — the scorer abstains |
| A biomarker the user never had measured | Absent, never zero |

Each is a point where returning something plausible would have been easier. Locked by tests in both services.

---

## Architecture

```mermaid
flowchart LR
    WEB["React 18 + Vite<br/>Cloudflare Pages"] -->|"fetch, credentials: include"| API
    API["Node / Express 5<br/>Passport sessions"] --> DB[("MongoDB Atlas M0")]
    API -->|"POST /predict"| INF["FastAPI + scikit-learn<br/>onnxruntime-free, 627 MB image"]
    API -->|"proxied — key never in browser"| GEM["Gemini API"]
    INF --> ENG["Risk Engine<br/>NHANES, real"]
    INF --> RAG["RAG recommender<br/>1,014 Indian foods"]
```

Layered, dependencies pointing inward:

```
ml/src/        domain → features → inference → risk → api   (+ training, data, recommendation)
backend2/src/  config → domain → models → repositories → services → controllers → routes
```

`domain/` holds no I/O and no framework imports in either service. Full design rationale, and the principle behind each structural decision: **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** · **[docs/DESIGN.md](docs/DESIGN.md)**

### Why the inference image excludes TensorFlow

Measured: importing TensorFlow costs **358 MB RSS**; onnxruntime costs 33 MB; the shipped models are scikit-learn estimators needing neither. The container runs at **145 MiB of a 512 MiB cap** with `/predict` at **54–66 ms**. That is what makes a free tier viable.

---

## Stack

| | |
|---|---|
| ML | Python 3.13, scikit-learn `HistGradientBoosting`, SHAP |
| Data | NHANES 2013–2018 (CDC, public domain), Anuvaad INDB 2024.11 |
| API | Node 22, Express 5, Mongoose, Passport (session cookies), Google Identity Services for sign-in |
| Inference | FastAPI, Pydantic, uvicorn |
| Web | React 18, Vite 6, Tailwind, Recharts, fflate (client-side unzip) |
| Tests | pytest (104) + `node:test` (138) — **242 total, zero test-framework dependencies on the Node side** |
| Deploy | Render × 2 + MongoDB Atlas M0 (`render.yaml` blueprint), Cloudflare Pages |

---

## Run it locally

Both dependencies are containers. On Windows with a user-level Docker install, see [ml/DOCKER.md](ml/DOCKER.md) for the PATH export.

```bash
# 1. Database + inference service
docker run -d --name niy-mongo -p 27017:27017 mongo:7
cd ml && docker build -t niyantrana-inference . \
  && docker run -d --name niy-ml --memory=512m --cpus=0.5 -p 8000:8000 niyantrana-inference

# 2. API
cd ../backend2 && npm install && npm run seed     # loads 1,014 Indian foods
MONGO_URI=mongodb://127.0.0.1:27017/niyantrana \
SESSION_SECRET=a-long-enough-dev-secret \
ML_SERVICE_URL=http://127.0.0.1:8000 npm start

# 3. Try it
curl -s -c j -X POST localhost:8080/auth/register -H 'Content-Type: application/json' \
  -d '{"email":"you@example.com","password":"a-long-enough-password"}'
curl -s -c j -X POST localhost:8080/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"you@example.com","password":"a-long-enough-password"}'
curl -s -b j -X POST localhost:8080/api/wearable/demo -H 'Content-Type: application/json' -d '{"days":90}'
curl -s -b j -X POST localhost:8080/api/predict -H 'Content-Type: application/json' -d '{}'
```

`--memory=512m --cpus=0.5` mirrors the free tier, so an OOM shows up locally rather than in production.

### Reproduce the models from scratch

```bash
cd ml
python -m src.data.nhanes.download        # ~25 MB from the CDC, no registration needed
python -m src.data.nhanes.build_dataset   # → 17,961 adults
python -m src.training.train_risk_engine  # regression heads + metrics
python -m src.training.train_classifiers  # calibrated classifiers + SHAP
python -m pytest tests/ -q
```

### Tests

```bash
cd ml       && python -m pytest tests/ -q     # 104 passed, 1 skipped
cd backend2 && npm test                       # 138 (needs Mongo + inference running)
```

### Try the live API

```bash
API=https://niyantrana-api.onrender.com
curl -s -c j -X POST $API/auth/register -H 'Content-Type: application/json' \
  -d '{"email":"you@example.com","password":"a-long-enough-password"}'
curl -s -c j -X POST $API/auth/login    -H 'Content-Type: application/json' \
  -d '{"email":"you@example.com","password":"a-long-enough-password"}'
curl -s -b j -X POST $API/api/wearable/demo -H 'Content-Type: application/json' -d '{"days":90}'
curl -s -b j -X POST $API/api/predict       -H 'Content-Type: application/json' -d '{}'
```

---

## Wearable data

Four ways in, because no single one reaches everybody. The consumer API landscape as of September 2026:

| Provider | Status |
|---|---|
| Google Health API | ✅ implemented. Successor to both below. Every scope is Restricted, so connecting is limited to accounts added as test users until the app passes OAuth verification |
| Google Fit | New signups closed 1 May 2024; APIs deprecating |
| Fitbit Web API | New signups closed 1 May 2024; sunset September 2026 |
| Garmin | Requires a legal entity; rejects personal-use applications |
| Withings, Oura | Still open to individual developers; not implemented |

**Google Health** — `POST /api/wearable/google-health/sync` reads steps and active minutes from the daily roll-up endpoints, assembles sleep hours and efficiency from session stages, and lists daily resting heart rate and HRV. Where the platform has no derived daily record — a Samsung-fed account supplies raw samples instead — resting heart rate falls back to the daily *minimum* of intraday heart rate, never the mean, and the report says the value was derived. Every sync returns a per-feature report naming the field path it resolved, because the published reference does not name every value field. A feature it cannot find stays **absent rather than zero**: a zero reads to the model as "did not move".

**Samsung Health** — `POST /api/wearable/import/samsung` takes the export archive as Samsung produces it. The browser unzips it, extracts the four files this reads out of 14,507 entries and trims them to the window the model uses; the server parses and derives every value. The format needs a dedicated parser: the header is on line 2 under a metadata line, rows carry a trailing comma, `active_time` is milliseconds while `sleep_duration` is minutes, and a night arrives as several fragments whose efficiency has to be weighted by duration. Days recorded by more than one device use the highest-reporting device, which matches Samsung's own daily aggregate.

**Generic import** — `POST /api/wearable/import` accepts CSV, a JSON array, or the per-metric shape Google Takeout produces, normalising ~40 field aliases across Fitbit / Apple Health / Oura / Withings. It needs no device and no API registration, so it cannot be deprecated out from under the project.

**Demo** — `POST /api/wearable/demo` seeds 90 days of correlated, deterministic history, every row stored with `source: "demo"`. It refuses to overwrite real days unless the overwrite is confirmed.

---

## Limitations

1. **NHANES is a US population.** South Asians develop metabolic disease at lower BMI and waist thresholds; an India-deployed model needs recalibration against NFHS-5 / LASI.
2. **Cross-sectional.** One blood draw per person, so the model estimates a current level rather than observing response to change.
3. **Fatty liver is largely an anthropometric restatement** (see above).
4. **GGT is not predictable** here, which caps how far the fatty-liver estimate can improve.
5. **High predicted probabilities are overconfident** — dysglycaemia predicts 0.88 where 0.64 are observed (thin bins).
6. **Diet is one 24-hour recall** in NHANES: noisy, self-reported, not habitual intake.
7. **Sleep and activity are self-reported in NHANES but sensor-measured in the app.** The instrument mismatch is unquantified.
8. **The trajectory is a trajectory of estimates**, produced by a model fitted across people rather than within one.

## What I'd do next

- Recalibrate on **LASI** (~72,000 Indians with HbA1c and BP) for India-appropriate thresholds
- Pass Google OAuth restricted-scope verification, so anyone — not only console test users — can connect their own Google Health data
- Quantify the self-report vs sensor gap using NHANES `PAXDAY` accelerometry, which is paired within-person with the questionnaire
- Capture profile snapshots over time, so a trajectory reflects weight change as well as behaviour change

---

## Repository

| Path | |
|---|---|
| [ml/](ml/) | Training, inference, FastAPI service, 104 tests |
| [backend2/](backend2/) | Node API, 138 tests |
| [frontend/](frontend/) | React 18 + Vite + Tailwind client — seven screens, no mock data, no secrets in the bundle |
| [docs/](docs/) | Architecture, design notes, data sources, deployment, setup |
| [ml/RESULTS.md](ml/RESULTS.md) | Every metric, ablation and negative result |
| [PROJECT_PLAN.md](PROJECT_PLAN.md) | Day-by-day build log |

Originally built for **NEXOVATE'25** (*CodeCure — Healthcare & Wellbeing Tech*) by Team Basement — Swami Agnivesh, Vamshidhar Reddy, Sushanth Kartikeya, Shri Krushna Vardhan (VNR VJIET, Hyderabad). Rebuilt since as a portfolio project.

## Licence

MIT. NHANES is US public domain. Anuvaad INDB 2024.11 is credited to its authors.
