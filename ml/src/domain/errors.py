"""Domain exception hierarchy.

Every failure mode is a typed exception carrying the status code it deserves,
and the API layer is the only place that turns one into an HTTP response.

The alternative -- signalling failure by returning None, or by substituting a
plausible value -- leaves a caller unable to tell a real result from a failed
one. In a health application that is the difference between an estimate and a
fabrication, so failure is made impossible to ignore by type.
"""


class NiyantranaError(Exception):
    """Base for every domain error. Lets callers catch the whole family."""

    status_code = 500


class ValidationError(NiyantranaError):
    """Caller supplied malformed or physiologically impossible input."""

    status_code = 400


class MissingFeatureError(ValidationError):
    """A feature the model requires was not supplied."""

    def __init__(self, missing):
        self.missing = list(missing)
        super().__init__(f"Missing required feature(s): {', '.join(self.missing)}")


class ArtifactsMissingError(NiyantranaError):
    """Model or scaler files are absent. The service cannot serve predictions."""

    status_code = 503


class InferenceError(NiyantranaError):
    """The model failed to produce a prediction.

    Deliberately NOT caught-and-substituted anywhere. A failed prediction must
    surface as an error, never as a fabricated value.
    """

    status_code = 503


class RecommenderUnavailableError(NiyantranaError):
    """The LLM backend is not configured. Prediction endpoints are unaffected."""

    status_code = 503
