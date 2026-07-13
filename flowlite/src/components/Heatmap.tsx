import { buildHeatmap } from "../lib/stats";

const LEVEL_CLASSES = [
  "bg-cream-dark",
  "bg-teal/25",
  "bg-teal/45",
  "bg-teal/70",
  "bg-teal-deep",
];

/** GitHub-style activity calendar of the last ~5 months. */
export default function Heatmap({ days }: { days: Record<string, number> }) {
  const { columns, monthLabels } = buildHeatmap(days);
  const dowLabels = ["", "Mon", "", "Wed", "", "Fri", ""];

  return (
    <div className="overflow-x-auto">
      <div className="inline-block">
        {/* Month labels */}
        <div className="mb-1 flex gap-[3px] pl-8">
          {monthLabels.map((label, i) => (
            <div key={i} className="relative w-3 text-[10px] text-ink-soft">
              {label && <span className="absolute left-0 whitespace-nowrap">{label}</span>}
            </div>
          ))}
        </div>
        <div className="flex">
          {/* Day-of-week gutter */}
          <div className="mr-2 flex w-6 flex-col gap-[3px]">
            {dowLabels.map((label, i) => (
              <div key={i} className="flex h-3 items-center text-[10px] text-ink-soft">
                {label}
              </div>
            ))}
          </div>
          {/* Week columns */}
          <div className="flex gap-[3px]">
            {columns.map((col, w) => (
              <div key={w} className="flex flex-col gap-[3px]">
                {col.map((cell, d) =>
                  cell.key === "" ? (
                    <div key={d} className="h-3 w-3" />
                  ) : (
                    <div
                      key={d}
                      title={`${cell.key}: ${cell.words} words`}
                      className={`h-3 w-3 rounded-[3px] ${LEVEL_CLASSES[cell.level]}`}
                    />
                  ),
                )}
              </div>
            ))}
          </div>
        </div>
        {/* Legend */}
        <div className="mt-2 flex items-center gap-1 pl-8 text-[10px] text-ink-soft">
          <span className="mr-1">Less</span>
          {LEVEL_CLASSES.map((c, i) => (
            <div key={i} className={`h-3 w-3 rounded-[3px] ${c}`} />
          ))}
          <span className="ml-1">More</span>
        </div>
      </div>
    </div>
  );
}
