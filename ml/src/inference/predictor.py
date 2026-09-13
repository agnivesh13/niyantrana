"""Biomarker prediction pipeline.

Orchestration only. Validation belongs to `UserProfile` and `WearableWindow`,
feature assembly to `FeatureBridge`, and execution to an `InferenceBackend`;
this class wires them together and checks the shape of what comes back.

Keeping those responsibilities apart is what makes the seams testable: the
backend is constructor-injected, so a test can drive the whole pipeline with a
fake and never touch the filesystem.
"""
from __future__ import annotations

import numpy as np

from ..domain.errors import InferenceError
from ..domain.models import Biomarkers, UserProfile, WearableWindow
from ..features.bridge import FeatureBridge
from .backends import InferenceBackend
from .registry import ModelRegistry


class BiomarkerPredictor:
    """Predicts triglycerides and GGT from a profile plus a 14-day window."""

    # Output column order of the multimodal model, matching TARGET_FEATURES.
    OUTPUT_ORDER = ("triglycerides", "ggt")

    def __init__(self, backend: InferenceBackend, bridge: FeatureBridge, target_scaler):
        self._backend = backend
        self._bridge = bridge
        self._target_scaler = target_scaler

    @classmethod
    def from_registry(cls, registry: ModelRegistry | None = None) -> "BiomarkerPredictor":
        """Factory Method: wire the production object graph from loaded artifacts."""
        registry = registry or ModelRegistry.instance()
        bridge = FeatureBridge(registry.feature_scaler, registry.scaler_feature_order)
        return cls(registry.backend, bridge, registry.target_scaler)

    def predict(self, profile: UserProfile, window: WearableWindow) -> Biomarkers:
        inputs = self._bridge.to_model_inputs(profile, window)
        scaled = self._backend.run(inputs)

        if scaled.ndim != 2 or scaled.shape[1] != len(self.OUTPUT_ORDER):
            raise InferenceError(
                f"Model returned shape {scaled.shape}, expected (n, {len(self.OUTPUT_ORDER)})"
            )
        if np.isnan(scaled).any():
            # NaN here would otherwise reach the caller as a confident-looking
            # number, since downstream arithmetic quietly propagates it. A
            # prediction that cannot be computed has to fail loudly.
            raise InferenceError("Model produced NaN output")

        values = self._target_scaler.inverse_transform(scaled)[0]
        # round() on a numpy float32 keeps precision artefacts
        # (196.51 -> 196.50999450683594), so cast to Python float first.
        readings = {name: round(float(values[i]), 2)
                    for i, name in enumerate(self.OUTPUT_ORDER)}
        return Biomarkers(**readings)
