"""FastAPI service: biomarker prediction and meal recommendation.

Prediction and recommendation share one process because free-tier instance hours
are shared across the workspace, and two sleeping services cost twice the
cold-start latency for no isolation benefit at this size.

Handlers are deliberately thin: each translates a DTO, calls one domain service,
and translates the result back. No clinical logic lives here, so the rules stay
testable without a web server. Domain errors map to status codes through one
handler per error type rather than a try/except in every route, and services are
resolved through the dependency system so tests can inject fakes instead of
loading real model artifacts.
"""
from __future__ import annotations

import os

from fastapi import Depends, FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from ..domain.errors import NiyantranaError
from ..inference.artifacts import full_readiness
from ..recommendation.engine import RecommendationEngine
from ..risk.assessor import RiskAssessor
from .schemas import (AssessmentResponse, ErrorResponse, PredictRequest,
                      RecommendRequest, RecommendResponse)

app = FastAPI(
    title="Niyantrana Inference Service",
    version="2.0.0",
    description="Metabolic risk assessment and culturally-aware meal recommendations.",
)

_origins = [o.strip() for o in os.environ.get("CORS_ORIGIN", "*").split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


# --- Dependency providers (Singleton-scoped, lazily constructed) -------------
_assessor: RiskAssessor | None = None
_recommender: RecommendationEngine | None = None


def get_assessor() -> RiskAssessor:
    global _assessor
    if _assessor is None:
        _assessor = RiskAssessor.build()
    return _assessor


def get_recommender() -> RecommendationEngine:
    global _recommender
    if _recommender is None:
        _recommender = RecommendationEngine()
    return _recommender


# --- Error handling ---------------------------------------------------------
@app.exception_handler(NiyantranaError)
async def handle_domain_error(request: Request, exc: NiyantranaError):
    """Map the domain exception hierarchy onto HTTP.

    Critically, an inference failure returns its real status code. It is never
    downgraded into a 200 carrying an invented number.
    """
    return JSONResponse(
        status_code=exc.status_code,
        content=ErrorResponse(error=type(exc).__name__, detail=str(exc)).model_dump(),
    )


# --- Routes -----------------------------------------------------------------
@app.get("/health")
def health():
    """Liveness plus readiness of the artifacts the request path actually reads.

    Checks artifact presence AND that the model stack actually loads and
    predicts, because presence alone is not readiness: a build that stripped
    numpy test modules left every file in place while every /predict returned
    500. The functional probe is cached after the first call.

    Returns 503 when a required model is missing or the stack is broken, so a
    dead instance leaves rotation rather than serving errors. `/recommend` being
    disabled is NOT a failure -- prediction is unaffected by it.
    """
    artifacts = full_readiness()
    ready = artifacts["ready"]
    body = {
        "status": "ok" if ready else "degraded",
        "artifacts": artifacts,
        "recommendation_enabled": RecommendationEngine.is_configured(),
        "version": app.version,
    }
    return body if ready else JSONResponse(status_code=503, content=body)


@app.post("/predict", response_model=AssessmentResponse)
def predict(request: PredictRequest, assessor: RiskAssessor = Depends(get_assessor)):
    """Assess fatty-liver, dysglycaemia and hypertension risk."""
    profile, window, history, measured = request.to_domain()
    return AssessmentResponse.from_domain(
        assessor.assess(profile, window, measured, history=history))


@app.post("/recommend", response_model=RecommendResponse)
def recommend(request: RecommendRequest,
              engine: RecommendationEngine = Depends(get_recommender)):
    """Suggest a healthier Indian alternative to a logged meal."""
    result = engine.recommend(request.user_context, request.original_meal.model_dump())
    return RecommendResponse(**result)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("PORT", 8000)))
