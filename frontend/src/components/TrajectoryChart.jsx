/**
 * Risk over time, one line per condition.
 *
 * Design constraints this chart is built to, not decorated with afterwards:
 *
 * - **Four fixed series slots, never cycled.** Colour follows the condition, so
 *   hiding a series never repaints the survivors.
 * - **One y-axis, 0-100.** All four series share one scale because they are the
 *   same unit. A second axis would be the most common chart lie there is.
 * - **Identity is never colour-alone.** A legend is always present, all four
 *   lines are directly labelled at their right-hand end, and a table view
 *   carries the same numbers. The validated palette reports aqua at 2.82:1 and
 *   yellow at 2.17:1 against a white card -- both under 3:1 -- so colour is a
 *   hint here and the label is the identity.
 * - **Recessive grid, thin marks.** 2px lines, horizontal rules only, axis text
 *   in ink tokens rather than series colours.
 *
 * The x axis is labelled in days-before-today because that is what the server
 * actually sends: `day_index` is the position of a window final day inside the
 * wearable history, so the largest index is today.
 */
import { useEffect, useMemo, useState } from 'react';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Minus, TrendingDown, TrendingUp } from 'lucide-react';

import { CONDITION_LABEL, CONDITION_ORDER, cn, formatScore } from '../lib/utils.js';
import { Button, EmptyState } from '../ui/primitives.jsx';

/**
 * Series colours.
 *
 * Held as literals because SVG presentation attributes do not resolve `var()`,
 * and Recharts sets `stroke` as an attribute. index.css carries the same four
 * values as `--series-1..4` for any CSS-side use; these are the source of truth
 * for charts. Slot order is fixed by CONDITION_ORDER.
 */
const SERIES_COLOR = {
  fatty_liver: '#2a78d6',
  hypertension: '#eb6834',
  dysglycaemia: '#1baf7a',
  diabetes: '#eda100',
};

const CHART_HEIGHT = 300;
const PLOT_TOP = 8;
const X_AXIS_HEIGHT = 28;
const PLOT_HEIGHT = CHART_HEIGHT - PLOT_TOP - X_AXIS_HEIGHT;
const LABEL_RAIL = 104;
const MIN_LABEL_GAP = 18;

const DIRECTION_STYLE = {
  improving: { icon: TrendingDown, text: 'text-status-good', word: 'improving' },
  worsening: { icon: TrendingUp, text: 'text-status-critical', word: 'worsening' },
  stable: { icon: Minus, text: 'text-secondary', word: 'stable' },
  unknown: { icon: Minus, text: 'text-muted', word: 'trend unclear' },
};

const scoreToY = (score) =>
  PLOT_TOP + PLOT_HEIGHT * (1 - Math.min(Math.max(score ?? 0, 0), 100) / 100);

/**
 * Whether there is room for the label rail.
 *
 * Asked in JavaScript rather than CSS because the rail is paid for twice: the
 * labels themselves, and the right-hand margin reserved inside the plot. Hiding
 * only the labels with a CSS breakpoint left 104px of dead space on a phone and
 * squeezed the plot into about half the card.
 */
function useRoomForLabels(query = '(min-width: 640px)') {
  const [roomy, setRoomy] = useState(
    () => (typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia(query).matches
      : true),
  );

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
    const list = window.matchMedia(query);
    const update = () => setRoomy(list.matches);
    update();
    list.addEventListener('change', update);
    return () => list.removeEventListener('change', update);
  }, [query]);

  return roomy;
}

/**
 * Push labels apart so coincident lines stay readable.
 *
 * Greedy downward separation from the top, then a clamp back inside the plot.
 * Without this, two conditions three points apart print on top of each other --
 * which is exactly the case colour alone cannot rescue here.
 */
function separate(entries) {
  const sorted = [...entries].sort((a, b) => a.y - b.y);
  let previous = -Infinity;
  for (const entry of sorted) {
    entry.y = Math.max(entry.y, previous + MIN_LABEL_GAP);
    previous = entry.y;
  }
  const overflow = sorted.length
    ? Math.max(0, sorted[sorted.length - 1].y - (PLOT_TOP + PLOT_HEIGHT))
    : 0;
  if (overflow > 0) sorted.forEach((entry) => { entry.y -= overflow; });
  return sorted;
}

function buildSeries(trajectories) {
  // Fixed order, filtered to what the server actually returned.
  const present = CONDITION_ORDER
    .map((condition) => trajectories.find((t) => t.condition === condition))
    .filter(Boolean);

  const byDay = new Map();
  for (const trajectory of present) {
    for (const point of trajectory.points ?? []) {
      const row = byDay.get(point.day_index) ?? { dayIndex: point.day_index };
      row[trajectory.condition] = point.score;
      byDay.set(point.day_index, row);
    }
  }

  const rows = [...byDay.values()].sort((a, b) => a.dayIndex - b.dayIndex);
  const latestDay = rows.length ? rows[rows.length - 1].dayIndex : 0;
  for (const row of rows) row.daysAgo = latestDay - row.dayIndex;

  return { series: present, rows };
}

function Tip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const rows = [...payload].sort((a, b) => b.value - a.value);
  return (
    <div className="rounded border border-line bg-surface px-3 py-2 shadow-raised">
      <p className="text-xs font-medium text-primary">
        {label === 0 ? 'Today' : `${label} days ago`}
      </p>
      <table className="mt-1.5 text-xs">
        <tbody>
          {rows.map((row) => (
            <tr key={row.dataKey}>
              <td className="pr-2 align-middle">
                <span
                  className="inline-block size-2 rounded-full align-middle"
                  style={{ background: row.stroke }}
                  aria-hidden
                />
              </td>
              <td className="pr-3 text-secondary">{CONDITION_LABEL[row.dataKey] ?? row.dataKey}</td>
              <td className="text-right font-medium text-primary tabular">{formatScore(row.value)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DataTable({ series, rows }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <caption className="sr-only">Risk score by condition over time, 0 to 100</caption>
        <thead>
          <tr className="border-b border-line text-left">
            <th scope="col" className="py-2 pr-4 font-medium text-secondary">When</th>
            {series.map((trajectory) => (
              <th
                key={trajectory.condition}
                scope="col"
                className="py-2 pr-4 font-medium text-secondary"
              >
                {CONDITION_LABEL[trajectory.condition]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {[...rows].reverse().map((row) => (
            <tr key={row.dayIndex} className="border-b border-line/60 last:border-0">
              <th scope="row" className="py-2 pr-4 font-normal text-secondary whitespace-nowrap">
                {row.daysAgo === 0 ? 'Today' : `${row.daysAgo} days ago`}
              </th>
              {series.map((trajectory) => (
                <td key={trajectory.condition} className="py-2 pr-4 tabular text-primary">
                  {formatScore(row[trajectory.condition])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function TrajectoryChart({ trajectories = [], historyDays }) {
  const [showTable, setShowTable] = useState(false);
  const roomForLabels = useRoomForLabels();
  const { series, rows } = useMemo(() => buildSeries(trajectories), [trajectories]);

  const labels = useMemo(() => {
    if (!rows.length) return [];
    const last = rows[rows.length - 1];
    return separate(series.map((trajectory) => ({
      condition: trajectory.condition,
      score: last[trajectory.condition],
      y: scoreToY(last[trajectory.condition]),
    })));
  }, [series, rows]);

  if (!series.length) {
    return (
      <EmptyState icon={TrendingUp} title="No trajectory yet">
        A trend needs at least 28 days of wearable history to fit.
        {typeof historyDays === 'number' ? ` You have ${historyDays}.` : ''}
        {' '}Import a device export or load the demo history to fill this in.
      </EmptyState>
    );
  }

  return (
    <div>
      {/* Legend always present, and every series also labelled on the plot. */}
      <div className="mb-4 flex flex-wrap items-center gap-x-5 gap-y-2">
        {series.map((trajectory) => {
          const direction = DIRECTION_STYLE[trajectory.direction] ?? DIRECTION_STYLE.unknown;
          const Icon = direction.icon;
          return (
            <span key={trajectory.condition} className="inline-flex items-center gap-2 text-xs">
              <span
                className="size-2.5 rounded-full"
                style={{ background: SERIES_COLOR[trajectory.condition] }}
                aria-hidden
              />
              <span className="text-primary">{CONDITION_LABEL[trajectory.condition]}</span>
              <span className={cn('inline-flex items-center gap-1', direction.text)}>
                <Icon className="size-3.5" aria-hidden />
                {direction.word}
              </span>
            </span>
          );
        })}
      </div>

      <div className="relative" style={{ height: CHART_HEIGHT }}>
        <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
          <LineChart
            data={rows}
            margin={{ top: PLOT_TOP, right: roomForLabels ? LABEL_RAIL : 12, bottom: 0, left: 0 }}
          >
            <CartesianGrid stroke="#e8eaed" vertical={false} />
            {/* Rows are oldest-first, so time already runs left to right and the
                most recent window lands under the labels on the right. */}
            <XAxis
              dataKey="daysAgo"
              height={X_AXIS_HEIGHT}
              tickLine={false}
              minTickGap={24}
              axisLine={{ stroke: '#e8eaed' }}
              tick={{ fill: '#5f6368', fontSize: 11 }}
              tickFormatter={(value) => (value === 0 ? 'Today' : `-${value}d`)}
            />
            <YAxis
              domain={[0, 100]}
              width={36}
              tickLine={false}
              axisLine={false}
              tick={{ fill: '#5f6368', fontSize: 11 }}
            />
            <Tooltip
              content={<Tip />}
              cursor={{ stroke: '#bdc1c6', strokeWidth: 1, strokeDasharray: '3 3' }}
            />
            {series.map((trajectory) => (
              <Line
                key={trajectory.condition}
                type="monotone"
                dataKey={trajectory.condition}
                stroke={SERIES_COLOR[trajectory.condition]}
                strokeWidth={2}
                dot={{ r: 4, strokeWidth: 0, fill: SERIES_COLOR[trajectory.condition] }}
                activeDot={{ r: 6, strokeWidth: 2, stroke: '#ffffff' }}
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>

        {/* Direct labels. Dropped on narrow screens, where the legend and the
            table view carry identity instead of a cramped rail. */}
        <div
          className="pointer-events-none absolute right-0 top-0"
          style={{ width: LABEL_RAIL, height: CHART_HEIGHT, display: roomForLabels ? 'block' : 'none' }}
          aria-hidden
        >
          {labels.map((label) => (
            <div
              key={label.condition}
              className="absolute left-2 flex items-center gap-1.5 whitespace-nowrap text-[11px] leading-none"
              style={{ top: label.y - 5 }}
            >
              <span className="font-semibold text-primary tabular">{formatScore(label.score)}</span>
              <span className="text-secondary">{CONDITION_LABEL[label.condition]}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-4 flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <p className="text-xs text-muted">
          Each point scores a 14-day window of your own history, stepped weekly.
        </p>
        <Button
          variant="ghost"
          size="sm"
          className="shrink-0 whitespace-nowrap"
          onClick={() => setShowTable((open) => !open)}
        >
          {showTable ? 'Hide table' : 'View as table'}
        </Button>
      </div>

      {showTable && (
        <div className="mt-3 border-t border-line pt-3">
          <DataTable series={series} rows={rows} />
        </div>
      )}
    </div>
  );
}
