"""Retrieval-augmented meal recommendation over the Anuvaad INDB database.

Structure:

* `GeminiClient` wraps the vendor API behind a two-method interface, so swapping
  providers or injecting a fake in tests touches one class, and no credential is
  read at import time.
* **Facade** -- `RecommendationEngine` is the one public entry point; retrieval,
  prompt construction and generation are collaborators.
* **Flyweight** (in spirit) -- `FoodRepository` loads the 1,014-row database
  once per process and shares it, instead of re-reading the spreadsheet.
* **Introduce Null Object** -- a missing API key yields a disabled engine that
  reports itself unavailable, rather than `exit()`-ing at import and taking the
  prediction endpoint down with it.

Bugs fixed while porting from `rag_engine/`:
1. the database path resolved against the process CWD, so it loaded only when
   launched from one specific directory;
2. the meal name was interpolated straight into `str.contains`, which treats it
   as a regex -- a meal named "Chicken (fried)" raised instead of searching;
3. rows with a NaN food_name produced a non-boolean mask and crashed the filter;
4. NaN nutrient values reached `int()` and raised while formatting the prompt;
5. a missing GOOGLE_API_KEY called `exit()` at import.

The LLM call was later moved off the google-generativeai SDK onto the REST
endpoint, removing about 162 MB from the container image. See `GeminiClient`.
"""
from __future__ import annotations

import json
import os
import re
import threading
import urllib.error
import urllib.request

import pandas as pd

from ..domain.errors import RecommenderUnavailableError, ValidationError

_ML_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# CSV is the deployment format: 58x faster to load, 5.3x smaller, and it removes
# openpyxl from the serving image entirely. The source spreadsheet stays as the
# fallback so a fresh checkout still works before the build step has run.
# Regenerate with: python -m src.data.build_food_csv
DEFAULT_FOOD_CSV = os.path.join(_ML_ROOT, "data", "raw", "anuvaad_indb_2024.11.csv")
DEFAULT_FOOD_XLSX = os.path.join(_ML_ROOT, "data", "raw", "Anuvaad_INDB_2024.11.xlsx")

REQUIRED_COLUMNS = ("food_name", "energy_kcal", "fat_g", "protein_g")

# Preparation words carry no retrieval signal as a "primary ingredient".
_STOPWORDS = frozenset({"hot", "cold", "fried", "boiled", "roasted", "grilled",
                        "steamed", "plain", "sweet", "spicy", "fresh", "mixed",
                        "the", "a", "an", "with", "and"})


class FoodRepository:
    """Shared, lazily-loaded access to the Indian food composition database."""

    _instance: "FoodRepository | None" = None
    _lock = threading.Lock()

    def __init__(self, path: str | None = None):
        configured = path or os.environ.get("FOOD_DB_PATH")
        if configured:
            self._path = configured
        else:
            self._path = (DEFAULT_FOOD_CSV if os.path.exists(DEFAULT_FOOD_CSV)
                          else DEFAULT_FOOD_XLSX)
        self._frame: pd.DataFrame | None = None

    @classmethod
    def instance(cls) -> "FoodRepository":
        if cls._instance is None:
            with cls._lock:
                if cls._instance is None:
                    cls._instance = cls()
        return cls._instance

    @property
    def frame(self) -> pd.DataFrame:
        if self._frame is None:
            with self._lock:
                if self._frame is None:
                    self._frame = self._load()
        return self._frame

    def _load(self) -> pd.DataFrame:
        try:
            frame = (pd.read_csv(self._path) if self._path.lower().endswith(".csv")
                     else pd.read_excel(self._path))
        except FileNotFoundError:
            print(f"WARNING: food database not found at {self._path}; retrieval disabled.")
            return pd.DataFrame(columns=list(REQUIRED_COLUMNS))
        # dropna covers food_name too -- a NaN name would produce a
        # non-boolean mask and crashed the filter.
        frame = frame.dropna(subset=list(REQUIRED_COLUMNS))
        frame["_name_lower"] = frame["food_name"].astype(str).str.lower()
        print(f"Food database loaded: {len(frame)} items")
        return frame

    @property
    def is_available(self) -> bool:
        return not self.frame.empty


class AlternativeRetriever:
    """Finds nutritionally better alternatives with a similar main ingredient.

    Compares macronutrient RATIOS, not absolute grams, because the two sides are
    measured on different bases: the caller sends a whole portion (a plate of
    biryani at 650 kcal with 24 g protein) while the database stores per-100 g
    rows (median 175 kcal, median 4.0 g protein).

    The ported original filtered on absolutes -- `protein_g >= 0.9 * meal
    protein`. For that 650 kcal meal the floor was 21.6 g, and the highest
    protein figure anywhere in the 1,014-row database is 21.6 g. The condition
    was mathematically unsatisfiable, so retrieval returned an empty set for
    every realistic meal and the prompt fell back to "No direct alternatives
    found in our database" while still instructing the model not to invent
    dishes. The feature looked like it worked and was not grounded in anything.

    Ratios (grams per kcal) are unit-invariant, so a per-100 g row and a whole
    portion are directly comparable.
    """

    FAT_RATIO_FACTOR = 1.0      # no more fat per calorie than the original
    PROTEIN_RATIO_FACTOR = 0.9  # at least comparable protein per calorie
    MIN_MEAL_KCAL = 50          # below this the ratios are noise

    def __init__(self, repository: FoodRepository | None = None):
        self._repository = repository or FoodRepository.instance()

    @staticmethod
    def primary_ingredient(meal_name: str) -> str:
        """Pick the most informative token from a meal name."""
        tokens = [t for t in re.split(r"[^A-Za-z]+", str(meal_name).lower()) if t]
        meaningful = [t for t in tokens if t not in _STOPWORDS and len(t) > 2]
        return (meaningful or tokens or [""])[0]

    @staticmethod
    def _is_same_dish(candidate: str, meal_name: str) -> bool:
        """Whether a candidate is effectively the dish the user just ate.

        Per-100 g rows often beat a whole portion on fat-per-calorie, so the
        database happily recommends "Mutton biryani" to someone who just ate
        mutton biryani. Technically defensible, useless as advice.

        Compared on word sets so punctuation and word order do not matter --
        "Mutton biryani/biriyani" matches "Mutton Biryani".
        """
        strip = lambda text: {  # noqa: E731
            word for word in re.split(r"[^a-z]+", str(text).lower())
            if word and word not in _STOPWORDS and len(word) > 2
        }
        query, other = strip(meal_name), strip(candidate)
        if not query or not other:
            return False
        # Every meaningful word of the query appears in the candidate.
        return query <= other

    def retrieve(self, meal_name: str, meal: dict, top_n: int = 3) -> pd.DataFrame:
        frame = self._repository.frame
        empty = pd.DataFrame(columns=list(REQUIRED_COLUMNS))
        if frame.empty:
            return empty

        ingredient = self.primary_ingredient(meal_name)
        if not ingredient:
            return empty

        # re.escape: the meal name is user input, not a pattern.
        by_name = frame[frame["_name_lower"].str.contains(re.escape(ingredient), na=False)]
        by_name = by_name[~by_name["_name_lower"].map(
            lambda name: self._is_same_dish(name, meal_name))]
        if by_name.empty:
            return empty

        calories = float(meal.get("calories") or 0)
        if calories < self.MIN_MEAL_KCAL:
            # Not enough information to compare ratios; fall back to the
            # lowest-energy-density options with the same main ingredient.
            return by_name.nsmallest(top_n, "energy_kcal")

        candidates = by_name[by_name["energy_kcal"] > 0]
        if candidates.empty:
            return empty

        mask = pd.Series(True, index=candidates.index)

        fat = float(meal.get("fat") or 0)
        if fat > 0:
            meal_fat_ratio = fat / calories
            mask &= (candidates["fat_g"] / candidates["energy_kcal"]
                     <= meal_fat_ratio * self.FAT_RATIO_FACTOR)

        protein = float(meal.get("protein") or 0)
        if protein > 0:
            meal_protein_ratio = protein / calories
            mask &= (candidates["protein_g"] / candidates["energy_kcal"]
                     >= meal_protein_ratio * self.PROTEIN_RATIO_FACTOR)

        matched = candidates[mask]
        if matched.empty:
            # Nothing with the same ingredient is better on BOTH ratios. Return
            # the leanest options by fat-per-calorie rather than an empty set:
            # a weaker suggestion the model can reason about beats telling it
            # there is nothing and then forbidding it to invent a dish.
            #
            # But it must be LABELLED as a near-miss. Calling these "healthier
            # alternatives" in the prompt would overstate what was found, and
            # the model would pass that overstatement on to the user.
            leanest = candidates.assign(
                _fat_ratio=candidates["fat_g"] / candidates["energy_kcal"])
            result = leanest.nsmallest(top_n, "_fat_ratio").drop(columns="_fat_ratio")
            result.attrs["strictly_better"] = False
            return result

        result = matched.nsmallest(top_n, "energy_kcal")
        result.attrs["strictly_better"] = True
        return result


class PromptBuilder:
    """Builds the generation prompt. Pure formatting, no I/O."""

    @staticmethod
    def _nutrient(value, suffix: str = "") -> str:
        """Format a nutrient, tolerating NaN (which used to crash `int()`)."""
        if value is None or pd.isna(value):
            return "n/a"
        return f"{round(float(value))}{suffix}"

    def build(self, user_context: dict, meal: dict, alternatives: pd.DataFrame) -> str:
        if alternatives.empty:
            options = "No direct alternatives found in our database."
            heading = "Alternatives from our Database"
        else:
            # attrs defaults to strict when absent, e.g. the density fallback.
            strictly_better = alternatives.attrs.get("strictly_better", True)
            heading = ("Healthier Alternatives from our Database" if strictly_better
                       else "Similar Dishes from our Database "
                            "(none were strictly leaner -- say so honestly)")
            options = "".join(
                f"- {row['food_name']}: {self._nutrient(row['energy_kcal'])} kcal, "
                f"{self._nutrient(row['fat_g'], 'g')} fat, "
                f"{self._nutrient(row['protein_g'], 'g')} protein\n"
                for _, row in alternatives.iterrows()
            )

        return f"""
You are a friendly, expert nutritionist for a user in India whose goal is to reduce their risk of fatty liver disease.

**User's Health Context:**
- Estimated triglycerides: {user_context.get('predicted_tg', 'unknown')} mg/dL (high is > 150)
- Daily calorie target: {user_context.get('calorie_target', 'unknown')} kcal

**User's Recent Meal:**
- They just ate: {meal.get('name')} ({meal.get('calories')} kcal, {meal.get('fat')}g fat)

**Task:**
Write a short, encouraging, conversational message. Acknowledge the meal, then suggest a
healthier but similar alternative for their next meal. Use one of the options below as the
primary suggestion and briefly explain why it is a better choice. Do not invent new dishes.
Keep it under 120 words.

**{heading}:**
{options}
"""


class GeminiClient:
    """Adapter over the Gemini REST API, using only the standard library.

    Deliberately NOT the `google-generativeai` SDK. That package pulls in
    googleapiclient (103 MB), google (25 MB), grpc (18 MB) and cryptography
    (16 MB) -- roughly 162 MB of container image -- in order to make a single
    text-generation POST. The REST endpoint needs no dependency at all, and a
    smaller image means faster cold starts on a tier that spins down after
    15 minutes of inactivity.

    Keeping this behind the same two-method interface is what made the swap a
    one-class change (Adapter).
    """

    # Candidate models, newest first. Google pulled gemini-2.5-flash from new
    # users BEFORE its published October 2026 date, so production 404'd on a
    # name that was current when it was written. The first that answers is
    # cached; GEMINI_MODEL pins one and disables the chain.
    MODEL_CANDIDATES = ("gemini-3.5-flash", "gemini-3.5-flash-lite", "gemini-2.5-flash")
    ENDPOINT = ("https://generativelanguage.googleapis.com/v1beta/"
                "models/{model}:generateContent")
    DEFAULT_TIMEOUT = 20.0

    def __init__(self, api_key: str | None = None, model_name: str | None = None,
                 timeout: float | None = None):
        self._api_key = (api_key or os.environ.get("GEMINI_API_KEY")
                         or os.environ.get("GOOGLE_API_KEY"))
        pinned = model_name or os.environ.get("GEMINI_MODEL")
        self._candidates = (pinned,) if pinned else self.MODEL_CANDIDATES
        self._resolved_model = None
        self._timeout = timeout or float(os.environ.get("GEMINI_TIMEOUT", self.DEFAULT_TIMEOUT))

    @property
    def model_name(self) -> str:
        """The model in use, or the next one to be tried."""
        return self._resolved_model or self._candidates[0]

    @property
    def is_configured(self) -> bool:
        return bool(self._api_key)

    def _request_body(self, prompt: str) -> bytes:
        return json.dumps({
            "contents": [{"parts": [{"text": prompt}]}],
            "generationConfig": {"temperature": 0.7, "maxOutputTokens": 400},
        }).encode("utf-8")

    @staticmethod
    def _extract_text(payload: dict) -> str:
        """Pull the generated text out, distinguishing empty from blocked."""
        candidates = payload.get("candidates") or []
        if not candidates:
            blocked = (payload.get("promptFeedback") or {}).get("blockReason")
            raise RecommenderUnavailableError(
                f"Gemini returned no candidates (blockReason={blocked or 'none'})")

        parts = (candidates[0].get("content") or {}).get("parts") or []
        text = "".join(part.get("text", "") for part in parts).strip()
        if not text:
            reason = candidates[0].get("finishReason", "unknown")
            raise RecommenderUnavailableError(
                f"Gemini returned an empty response (finishReason={reason})")
        return text

    def generate(self, prompt: str) -> str:
        if not self.is_configured:
            raise RecommenderUnavailableError(
                "GEMINI_API_KEY is not set; /recommend is disabled. "
                "Prediction endpoints are unaffected."
            )

        order = (self._resolved_model,) if self._resolved_model else self._candidates
        last_problem = "no candidate models configured"

        for model in order:
            request = urllib.request.Request(
                self.ENDPOINT.format(model=model),
                data=self._request_body(prompt),
                headers={"Content-Type": "application/json",
                         "x-goog-api-key": self._api_key},
                method="POST",
            )
            try:
                with urllib.request.urlopen(request, timeout=self._timeout) as response:
                    payload = json.load(response)
            except urllib.error.HTTPError as exc:
                detail = exc.read().decode("utf-8", "replace")[:300]
                last_problem = f"HTTP {exc.code}: {detail}"
                # 400/404 on the model path means that name is gone; try the
                # next. Anything else (401 bad key, 429 quota, 5xx) is not
                # model-specific, so stop.
                if exc.code not in (400, 404):
                    break
                print(f"Gemini model {model} rejected ({exc.code}); trying the next candidate")
                continue
            except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
                # A network failure is not the model's fault.
                raise RecommenderUnavailableError(f"Gemini request failed: {exc}") from exc

            if self._resolved_model != model:
                self._resolved_model = model
                print(f"Gemini using {model}")
            return self._extract_text(payload)

        raise RecommenderUnavailableError(f"Gemini request failed: {last_problem}")


class RecommendationEngine:
    """Facade over retrieve -> prompt -> generate."""

    def __init__(self, retriever: AlternativeRetriever | None = None,
                 prompt_builder: PromptBuilder | None = None,
                 client: GeminiClient | None = None):
        self._retriever = retriever or AlternativeRetriever()
        self._prompts = prompt_builder or PromptBuilder()
        self._client = client or GeminiClient()

    @staticmethod
    def is_configured() -> bool:
        """Whether generation is available. Used by /health."""
        return GeminiClient().is_configured

    def recommend(self, user_context: dict, meal: dict) -> dict:
        name = (meal or {}).get("name")
        if not name:
            raise ValidationError("A meal name is required")

        alternatives = self._retriever.retrieve(name, meal)
        prompt = self._prompts.build(user_context or {}, meal, alternatives)
        return {
            "recommendation": self._client.generate(prompt),
            "alternatives_considered": (
                alternatives["food_name"].tolist() if not alternatives.empty else []
            ),
            "source": "rag",
        }
