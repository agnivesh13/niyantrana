/**
 * One condition, one card.
 *
 * Every field on this card comes from the API response. Nothing is derived in
 * the browser and nothing is filled in when absent, which is the whole reason
 * the API makes `provenance` and `basis` required fields rather than optional
 * extras: a card that cannot say where its number came from does not render a
 * number.
 *
 * The magnitude bar is a secondary encoding of the same score, so the reading
 * does not rest on the band colour alone.
 */
import { CONDITION_LABEL, cn, formatScore } from '../lib/utils.js';
import { BandPill, Card, ProvenanceTag, bandColor } from '../ui/primitives.jsx';

// Kept short on purpose: at four cards across, a long basis string wraps to
// three lines and drags the card footers out of alignment with each other.
const BASIS_COPY = {
  calibrated_classifier: 'calibrated classifier',
  clinical_formula: 'clinical formula',
};

export default function RiskCard({ risk, className }) {
  const { condition, score, band, provenance, basis, rationale, contributors = [] } = risk;

  return (
    <Card className={cn('flex flex-col', className)}>
      {/* Fixed height on the title row so the hero numbers share a baseline
          across cards, whether or not the condition name wraps. */}
      <div className="flex min-h-[3.25rem] items-start justify-between gap-3 px-5 pt-5">
        <h3 className="text-sm font-medium leading-snug text-secondary">
          {CONDITION_LABEL[condition] ?? condition}
        </h3>
        <BandPill band={band} className="shrink-0" />
      </div>

      <div className="px-5 pt-2">
        <p className="flex items-baseline gap-1.5">
          <span className="text-hero font-semibold text-primary tabular">{formatScore(score)}</span>
          <span className="text-sm text-muted">/ 100</span>
        </p>

        {/* Same number, second encoding. 4px rounded end, anchored left. */}
        <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-surface-sunken">
          <div
            className="h-full rounded-full"
            style={{
              width: `${Math.min(Math.max(score ?? 0, 0), 100)}%`,
              background: bandColor(band),
            }}
            role="presentation"
          />
        </div>
      </div>

      <div className="flex-1 px-5 pt-4">
        <p className="text-sm leading-relaxed text-secondary">{rationale}</p>

        {contributors.length > 0 && (
          <ul className="mt-3 flex flex-wrap gap-1.5">
            {contributors.map((contributor) => (
              <li
                key={contributor}
                className="rounded-full bg-surface-sunken px-2.5 py-1 text-xs text-secondary"
              >
                {contributor}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Fixed height, so the footer rule lands at the same y on every card
          whether the provenance and basis fit on one line or two. */}
      <div className="mt-4 flex min-h-[3.25rem] items-center border-t border-line px-5 py-3">
        <p className="text-xs">
          <ProvenanceTag provenance={provenance} />
          <span className="text-muted"> / {BASIS_COPY[basis] ?? basis}</span>
        </p>
      </div>
    </Card>
  );
}
