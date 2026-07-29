import { useState, type MouseEvent } from "react";

export interface ChartSeries {
  label: string;
  color: string;
  values: number[];
}

interface MetricsChartProps {
  series: ChartSeries[];
  yMax?: number;
  formatValue?: (value: number) => string;
}

const WIDTH = 600;
const HEIGHT = 220;
const PADDING = { top: 12, right: 12, bottom: 8, left: 12 };
const PLOT_WIDTH = WIDTH - PADDING.left - PADDING.right;
const PLOT_HEIGHT = HEIGHT - PADDING.top - PADDING.bottom;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Hand-rolled SVG line chart (no charting library — this is the only chart
 * in the app, so a dependency wasn't worth it). Follows the dataviz skill's
 * marks spec: 2px rounded lines, 8px end-dots with a surface-color ring,
 * hairline recessive gridlines, a legend (2 series), and a crosshair +
 * one-tooltip-for-every-series hover layer. A table view is one toggle away
 * for anyone who can't or doesn't want to read the chart.
 */
export function MetricsChart({ series, yMax = 100, formatValue = (v) => `${v}%` }: MetricsChartProps) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [showTable, setShowTable] = useState(false);
  const count = series[0]?.values.length ?? 0;

  const xForIndex = (i: number) => (count <= 1 ? PADDING.left : PADDING.left + (i / (count - 1)) * PLOT_WIDTH);
  const yForValue = (v: number) => PADDING.top + PLOT_HEIGHT - (clamp(v, 0, yMax) / yMax) * PLOT_HEIGHT;

  const onMove = (e: MouseEvent<SVGSVGElement>) => {
    if (count === 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const relX = ((e.clientX - rect.left) / rect.width) * WIDTH;
    const idx = count <= 1 ? 0 : Math.round(((relX - PADDING.left) / PLOT_WIDTH) * (count - 1));
    setHoverIndex(clamp(idx, 0, count - 1));
  };

  const tooltipLeftPercent = hoverIndex !== null ? (xForIndex(hoverIndex) / WIDTH) * 100 : 0;

  return (
    <div>
      <div className="chart-wrap">
        <svg
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          onMouseMove={onMove}
          onMouseLeave={() => setHoverIndex(null)}
          role="img"
          aria-label="Metrics over time"
        >
          {[0, 50, 100].map((gridValue) => (
            <line
              key={gridValue}
              className="chart-gridline"
              x1={PADDING.left}
              x2={WIDTH - PADDING.right}
              y1={yForValue((gridValue / 100) * yMax)}
              y2={yForValue((gridValue / 100) * yMax)}
            />
          ))}

          {hoverIndex !== null && (
            <line
              className="chart-crosshair"
              x1={xForIndex(hoverIndex)}
              x2={xForIndex(hoverIndex)}
              y1={PADDING.top}
              y2={HEIGHT - PADDING.bottom}
            />
          )}

          {series.map((s) => (
            <polyline
              key={s.label}
              fill="none"
              stroke={s.color}
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              points={s.values.map((v, i) => `${xForIndex(i)},${yForValue(v)}`).join(" ")}
            />
          ))}

          {series.map((s) => {
            const lastIdx = s.values.length - 1;
            if (lastIdx < 0) return null;
            return (
              <circle
                key={`${s.label}-end`}
                cx={xForIndex(lastIdx)}
                cy={yForValue(s.values[lastIdx])}
                r={4}
                fill={s.color}
                stroke="var(--surface)"
                strokeWidth={2}
              />
            );
          })}
        </svg>

        {hoverIndex !== null && (
          <div className="chart-tooltip" style={{ left: `${clamp(tooltipLeftPercent, 8, 92)}%` }}>
            {series.map((s) => (
              <div className="chart-tooltip-row" key={s.label}>
                <span className="chart-tooltip-key" style={{ background: s.color }} />
                <strong>{formatValue(s.values[hoverIndex] ?? 0)}</strong>
                <span>{s.label}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="chart-footer">
        <div className="chart-legend">
          {series.map((s) => (
            <span className="chart-legend-item" key={s.label}>
              <span className="chart-legend-swatch" style={{ background: s.color }} />
              {s.label}
            </span>
          ))}
        </div>
        <button onClick={() => setShowTable((v) => !v)}>{showTable ? "Hide table" : "Show as table"}</button>
      </div>

      {showTable && (
        <table>
          <thead>
            <tr>
              <th>#</th>
              {series.map((s) => (
                <th key={s.label}>{s.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: count }, (_, i) => (
              <tr key={i}>
                <td>{i + 1}</td>
                {series.map((s) => (
                  <td key={s.label}>{formatValue(s.values[i])}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
