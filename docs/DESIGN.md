# Design

How Niyantrana is built, and why it is built this way.

The domain sets the constraints. This is a screening tool: it reads sparse,
irregular data from devices that disagree with each other, runs it through
models with known limits, and shows the result to someone who may act on it.
Every structural decision below follows from one of those facts.

Patterns are named where they apply, but they are consequences rather than
goals. Applying the rest for completeness would be **Speculative Generality**,
so the ones deliberately absent are recorded at the end.

---

## 1. The rule the architecture enforces

**No number is emitted without declaring where it came from.**

`Provenance` is a required constructor argument on `RiskScore`, a required field
on `AssessmentResponse`, and a required field on the Mongoose health-report
schema. A score cannot be constructed, persisted or returned without one.

This is a type-system decision rather than a convention because conventions are
followed until they are inconvenient. In a health application the inconvenient
moment — the model is unreachable, the history is too short, the biomarker was
never measured — is exactly when a plausible substitute is most tempting and
most harmful. A user cannot act appropriately on a number whose origin they
cannot establish, and neither can the layer above.

Three consequences run through the whole codebase:

**Refusal over fabrication.** `InferenceClient` throws rather than returning a
value when the model service is unreachable. `fattyLiverIndex()` returns `null`
when its inputs are insufficient, and the scorer abstains. An assessment with
fewer than 14 wearable days raises a `ValidationError` naming how many exist.
Every one of these is a place where returning something would have been easier
and would have been a lie.

**Absence is a value, not zero.** Diet fields, wearable fields and biomarkers are
all nullable end to end. "Did not log a meal" and "ate nothing" are different
facts; so are "no pedometer" and "did not move". The estimators are
gradient-boosted trees that take NaN natively, which is what lets absence travel
all the way from an import to a prediction instead of being flattened at the
boundary.

**Derivation is labelled.** Where a value is computed rather than read — a
resting heart rate taken as the daily minimum of intraday samples, a sleep
efficiency weighted across fragments — the response says so, because it is not
the same quantity the platform would have reported.

---

## 2. Layering: dependencies point inward

```
ml/src/        domain → features → inference → risk → api
backend2/src/  config → domain → models → repositories → services → controllers → routes
frontend/src/  lib → ui → components → pages
```

`domain/` in both services has no I/O and no framework imports. It holds the
value objects, the clinical constants and the error hierarchy, and it is the
only layer that every other layer may depend on.

The payoff is testability without infrastructure. Clinical rules are exercised
without a web server, services without a database, and the whole inference
pipeline against a fake backend that never touches the filesystem. Collaborators
arrive through constructors with production defaults, so a test substitutes one
by passing it rather than by monkey-patching a module.

---

## 3. Typed values at the boundary

A profile is a `UserProfile`; a run of wearable days is a `WearableWindow`;
results are `Biomarkers`, `RiskScore`, `RiskAssessment`. All are frozen.

Passing an untyped dict of eleven keys through five layers means every layer
re-checks the same things and none of them owns the invariant. A value object
validates once, at construction, and is then trusted everywhere — and being
frozen, the value that was validated is the value that gets scored.

Factory methods (`UserProfile.from_dict`, `WearableWindow.from_records`) absorb
vocabulary differences at that boundary. The Node service speaks
`calorie_intake` and `gender`; the domain speaks `energy_kcal` and `sex`. One
translation point means neither vocabulary leaks into the other, and the two
services can change independently.

`WearableWindow` also owns the aggregates the feature bridge reads, so no caller
averages raw days itself — including the rule that a mean covers only the days
that carry a measurement, rather than counting gaps as zero.

---

## 4. One definition per clinical constant

The Fatty Liver Index, Mifflin-St Jeor, and the thresholds for steatosis,
dysglycaemia and hypertension exist once each.

These are published equations with fixed coefficients, and they are quoted to
users in scorer rationales. A second copy is a second place for a coefficient to
be mistyped, and the failure would be invisible: the output would still be a
plausible number in the right range. The Python and JavaScript implementations
of BMR mirror each other deliberately and are covered by tests on both sides.

The same reasoning drives `config/env.js` and `schema.py`: one place that knows
the environment, one place that knows feature order. A feature-order mismatch
between training and serving does not raise — it silently scores the wrong
column.

---

## 5. A new condition is a new class

`RiskScorer` is a Strategy hierarchy with a Template Method at its centre.
`score()` fixes the skeleton — obtain a value, clamp it, band it, package it
with provenance and basis — and subclasses vary only how the value is computed
and how it is explained.

Four conditions ship. Adding a fifth adds a class and a registry entry and edits
nothing, which is the property that matters: the alternative is a conditional
that grows every time the clinical scope does, in a function that also handles
HTTP. Keeping the skeleton in the base class is also what makes the provenance
rule unavoidable rather than remembered.

---

## 6. The serving path names no framework

`InferenceBackend` is a Strategy selected at load time, with ONNX, Keras and
scikit-learn implementations. Callers program to the interface.

This exists because of a measured constraint: importing TensorFlow costs ~358 MB
RSS against onnxruntime's ~33 MB, and the deployment target is a 512 MB
instance. Training is free to use whichever framework suits it; serving must not
import one it does not need. The container runs at 145 MiB with predictions at
54–66 ms, which is what makes a free tier viable at all.

Artifacts load lazily behind a locked registry rather than at import. Loading at
import would make every unit test pay the model-load cost, and would turn a
missing artifact into a crash loop instead of a 503 — a service that cannot
start cannot report *why* it cannot start.

---

## 7. Errors are types, translated once

Both services have an error hierarchy where each class carries the status code
it deserves, and exactly one place — the Express error middleware, the FastAPI
exception handlers — turns one into a response.

A route signals failure by throwing, not by assembling a response, so no handler
can accidentally return 200 for a request that failed. It also means the
translation table is readable in one screen instead of being distributed across
every handler as copy-pasted try/catch.

Where a dependency is optional, it reports itself unavailable rather than taking
the process down: a recommendation engine with no API key answers "not
configured", and `/predict` is unaffected.

---

## 8. The client asserts nothing

Two rules hold across the API boundary.

**Nutrition is resolved server-side.** The browser sends a food code and a
serving count; the server looks up the macros. A client able to send its own
totals could claim any intake it liked, and the model would treat it as
observed.

**Imports are parsed server-side.** The Samsung Health path is the sharpest
case: the browser unzips a 23 MB archive and selects four files out of 14,507,
because uploading the rest would cost the user their mobile data for bytes
nothing reads. But it extracts and filters only — every value is derived by the
server, so no health number originates in a place the user could edit.

The frontend follows the same principle internally. There is no client-side
scoring, no placeholder value, and no fallback: when `/api/predict` fails, the
dashboard shows why and shows no score.

---

## 9. SOLID, as applied here

| Principle | Where it shows |
|---|---|
| **Single Responsibility** | Domain validates, `FeatureBridge` assembles, `InferenceBackend` runs, `BiomarkerPredictor` orchestrates. Each is testable alone |
| **Open/Closed** | A fifth condition is one new `RiskScorer` subclass and one registry entry; no existing class changes |
| **Liskov Substitution** | Every backend honours the same contract, including raising `InferenceError` rather than returning a sentinel |
| **Interface Segregation** | `InferenceBackend` has one method; consumers of the food database depend on `FoodRepository`, not on pandas |
| **Dependency Inversion** | Collaborators are constructor-injected with production defaults; `domain/` imports nothing from the layers above it |

---

## 10. Patterns deliberately absent

Recording these matters as much as the ones used: reaching for a pattern without
a problem is Speculative Generality, and the cost is paid by every reader after
you.

| Pattern | Why not |
|---|---|
| **Abstract Factory** | One product family. Factory Method suffices |
| **Builder** | `UserProfile` has sensible defaults; a fluent builder adds ceremony over a dataclass |
| **Prototype** | Frozen dataclasses; nothing needs cloning |
| **Bridge** | Strategy already decouples execution, and a second axis of variation does not exist |
| **Composite** | The scorer collection is a flat tuple, not a tree |
| **Decorator** | Considered for provenance; a required field on the value object is simpler and unavoidable |
| **Proxy** | The registry handles lazy loading; a proxy would duplicate it |
| **Observer** | The system is request/response. Warranted if push alerts are built |
| **Command / Memento / Visitor / Mediator / State** | No undo, no snapshots, no varying operations over a stable structure, no many-to-many coordination, no state machine |

---

## 11. Verification

```bash
cd ml        && python -m pytest tests/ -q              # 104 passed, 1 skipped
cd backend2  && node --test --test-concurrency=1 tests/*.test.js   # 138 passed
cd frontend  && npm run build && npm run smoke          # 10 screens render
```

242 tests, with no test-framework dependency on the Node side.

Two properties are pinned by tests rather than by convention: that a failed
inference raises instead of substituting a value, and that a wearable day
missing a measurement is scored with that feature absent rather than zeroed.
Those are the two ways this design would most plausibly decay.
