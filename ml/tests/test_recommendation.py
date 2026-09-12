"""Tests for RAG retrieval over the Indian food database.

The bug these exist for: retrieval compared absolute grams, but the caller sends
a whole portion (650 kcal, 24 g protein) while the database stores per-100 g
rows (median 4.0 g protein, max 21.6 g). The floor `protein >= 0.9 * 24 = 21.6`
was mathematically unsatisfiable, so every realistic meal retrieved NOTHING --
and the prompt then said "No direct alternatives found" while also instructing
the model not to invent dishes. The feature appeared to work and was grounded in
nothing.
"""
import pytest

from src.recommendation.engine import (AlternativeRetriever, FoodRepository,
                                       PromptBuilder)

pytestmark = pytest.mark.filterwarnings("ignore")

BIRYANI = {"calories": 650, "fat": 32, "protein": 24}


@pytest.fixture(scope="module")
def retriever():
    return AlternativeRetriever()


@pytest.fixture(scope="module")
def database():
    return FoodRepository.instance().frame


def test_database_loaded(database):
    if database.empty:
        pytest.skip("food database not present")
    assert len(database) > 500


# --- The units bug ----------------------------------------------------------
def test_no_food_could_ever_satisfy_an_absolute_protein_floor(database):
    """Documents why the original filter was unsatisfiable, not merely strict."""
    if database.empty:
        pytest.skip("food database not present")
    floor = BIRYANI["protein"] * 0.9          # 21.6 g
    assert (database["protein_g"] >= floor).sum() == 0, (
        "if any row clears the old floor this test is stale -- but the point is "
        "that comparing a per-portion figure to per-100g rows is a category error")


@pytest.mark.parametrize("name,meal", [
    ("Mutton Biryani", BIRYANI),
    ("Chicken Biryani", {"calories": 600, "fat": 28, "protein": 26}),
    ("Paneer Butter Masala", {"calories": 480, "fat": 36, "protein": 14}),
    ("Masala Dosa", {"calories": 390, "fat": 18, "protein": 8}),
])
def test_realistic_meals_retrieve_alternatives(retriever, database, name, meal):
    """Every one of these returned an empty set before the ratio fix."""
    if database.empty:
        pytest.skip("food database not present")
    alternatives = retriever.retrieve(name, meal)
    assert not alternatives.empty, f"{name} retrieved nothing"
    assert len(alternatives) <= 3


def test_strict_results_are_leaner_per_calorie(retriever, database):
    """When results are tagged strictly_better they MUST be leaner per calorie.

    When nothing clears both ratio thresholds the retriever deliberately returns
    the leanest near-misses instead of an empty set, tagged strictly_better=False
    so the prompt can describe them honestly rather than calling them
    "healthier".
    """
    if database.empty:
        pytest.skip("food database not present")
    meal_fat_ratio = BIRYANI["fat"] / BIRYANI["calories"]
    alternatives = retriever.retrieve("Mutton Biryani", BIRYANI)
    if not alternatives.attrs.get("strictly_better", True):
        pytest.skip("this meal only has near-misses; covered by the prompt test")
    for _, row in alternatives.iterrows():
        assert row["fat_g"] / row["energy_kcal"] <= meal_fat_ratio + 1e-9, row["food_name"]


def test_near_miss_results_are_labelled_as_such(retriever, database):
    """A near-miss must never be presented to the model as "healthier"."""
    if database.empty:
        pytest.skip("food database not present")
    from src.recommendation.engine import PromptBuilder as PB
    alternatives = retriever.retrieve("Mutton Biryani", BIRYANI)
    prompt = PB().build({}, {"name": "Mutton Biryani", "calories": 650}, alternatives)
    if alternatives.attrs.get("strictly_better", True):
        assert "Healthier Alternatives" in prompt
    else:
        assert "Healthier Alternatives" not in prompt
        assert "none were strictly leaner" in prompt


# --- Quality of the suggestion ----------------------------------------------
def test_does_not_suggest_the_same_dish(retriever, database):
    """Per-100g rows beat a whole portion on fat-per-calorie, so the database
    will happily recommend mutton biryani to someone who just ate it."""
    if database.empty:
        pytest.skip("food database not present")
    names = retriever.retrieve("Mutton Biryani", BIRYANI)["food_name"].str.lower()
    assert not names.str.contains("biryani|biriyani").any(), list(names)


@pytest.mark.parametrize("candidate,query,expected", [
    ("mutton biryani/biriyani", "Mutton Biryani", True),
    ("Mutton Biryani", "mutton biryani", True),
    ("chicken curry", "Chicken Biryani", False),
    ("paneer soup", "Paneer Butter Masala", False),
    ("", "Mutton Biryani", False),
])
def test_same_dish_detection(candidate, query, expected):
    assert AlternativeRetriever._is_same_dish(candidate, query) is expected


# --- Robustness -------------------------------------------------------------
def test_regex_metacharacters_in_a_meal_name(retriever, database):
    """The meal name is user input. The original interpolated it into
    str.contains, which treats it as a pattern -- "Chicken (fried)" raised."""
    if database.empty:
        pytest.skip("food database not present")
    assert retriever.retrieve("Chicken (fried)", {"calories": 500, "fat": 30, "protein": 25}) is not None


def test_unknown_ingredient_returns_empty(retriever, database):
    if database.empty:
        pytest.skip("food database not present")
    assert retriever.retrieve("zzzqqq-not-a-food", BIRYANI).empty


def test_missing_calories_falls_back_to_energy_density(retriever, database):
    """Without calories the ratios are undefined; return the leanest options
    rather than nothing."""
    if database.empty:
        pytest.skip("food database not present")
    assert not retriever.retrieve("Mutton Biryani", {}).empty


def test_prompt_tolerates_nan_nutrients():
    """NaN reached int() in the original and raised while formatting."""
    import pandas as pd
    frame = pd.DataFrame([{"food_name": "Test dish", "energy_kcal": 100.0,
                           "fat_g": float("nan"), "protein_g": 5.0}])
    prompt = PromptBuilder().build({"predicted_tg": 180}, {"name": "X", "calories": 500}, frame)
    assert "n/a" in prompt
    assert "Test dish" in prompt


def test_prompt_says_so_when_nothing_was_retrieved():
    import pandas as pd
    prompt = PromptBuilder().build({}, {"name": "X"}, pd.DataFrame())
    assert "No direct alternatives" in prompt
