/** HTTP adapters for risk assessment and meal recommendation. */
import inferenceClient from '../clients/inferenceClient.js';
import riskService from '../services/riskService.js';

export async function assess(req, res) {
  // `dietTotals` is deliberately NOT read from the request: macros come from
  // the user own meal logs, resolved server-side against the food database.
  // `measured` is accepted so a caller can pass a fresh lab result inline, and
  // it is range-checked by the inference service before use.
  const assessment = await riskService.assess(req.user.id, {
    measured: req.body?.measured,
  });
  res.json(assessment);
}

export async function recommend(req, res) {
  res.json(await riskService.recommendMeal(req.user.id, req.body?.meal));
}

/**
 * Inference liveness.
 *
 * `?wake=1` turns this into a wake-up call: it holds the request open for the
 * cold-start window instead of the 5-second probe window, so a client can
 * actually start a spun-down container rather than merely observe that it is
 * asleep. The client uses it before an assessment; a monitor should not.
 */
export async function inferenceHealth(req, res) {
  const wake = ['1', 'true', 'yes'].includes(String(req.query.wake).toLowerCase());
  const health = await inferenceClient.health({ wake });

  // A wake-up call succeeds when the container is running. A monitoring probe
  // succeeds only when the models are loaded and scoring. Same endpoint, two
  // questions, and answering the second one for the first caller is what made
  // the client abandon a service it had just started.
  const ok = wake ? Boolean(health.reachable || health.awake) : health.reachable;
  res.status(ok ? 200 : 503).json(health);
}
