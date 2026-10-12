"use client";

import { useState } from "react";
import { cn, formatDay, formatNumber } from "@/lib/format";
import { ruleLabels, violationRules, type DailyViolations, type ViolationRule } from "@/lib/types";
import { Button, EmptyState } from "./ui";

// Series colours follow the rule, never its position: link is always series 1, banned words series 2.
const seriesColor: Record<ViolationRule, string> = { link: "bg-series-1", badWord: "bg-series-2" };
const plotHeight = 208;

// Rounds the axis top up to a clean number so the ticks read 0 / 5 / 10 rather than 0 / 3.5 / 7.
function niceMax(value: number): number {
  if (value <= 4) return 4;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const step = [1, 2, 5, 10].find((candidate) => candidate * magnitude >= value) ?? 10;
  return step * magnitude;
}

function Legend() {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
      {violationRules.map((rule) => (
        <li key={rule} className="flex items-center gap-2">
          <span aria-hidden="true" className={cn("size-2.5 rounded-sm", seriesColor[rule])} />
          {ruleLabels[rule]}
        </li>
      ))}
    </ul>
  );
}

function DataTable({ series }: { series: DailyViolations[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <caption className="sr-only">Số tin vi phạm theo ngày và theo quy tắc</caption>
        <thead>
          <tr className="border-b border-border text-left text-muted">
            <th scope="col" className="py-2 pr-4 font-medium">Ngày</th>
            {violationRules.map((rule) => <th key={rule} scope="col" className="py-2 pr-4 text-right font-medium">{ruleLabels[rule]}</th>)}
            <th scope="col" className="py-2 text-right font-medium">Tổng</th>
          </tr>
        </thead>
        <tbody className="tabular-nums">
          {series.map((day) => (
            <tr key={day.date} className="border-b border-border last:border-0">
              <th scope="row" className="py-2 pr-4 text-left font-normal">{formatDay(day.date, "long")}</th>
              {violationRules.map((rule) => <td key={rule} className="py-2 pr-4 text-right">{formatNumber(day[rule])}</td>)}
              <td className="py-2 text-right font-medium">{formatNumber(day.link + day.badWord)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Stacked columns: one per day, one segment per rule. Hover or focus a day for its exact numbers.
export function ViolationsChart({ series }: { series: DailyViolations[] }) {
  const [activeIndex, setActiveIndex] = useState<number>();
  const [showTable, setShowTable] = useState(false);
  const total = series.reduce((sum, day) => sum + day.link + day.badWord, 0);
  const top = niceMax(Math.max(...series.map((day) => day.link + day.badWord)));
  const ticks = [top, top / 2, 0];
  const active = activeIndex === undefined ? undefined : series[activeIndex];

  if (total === 0) {
    return <EmptyState title="Chưa có vi phạm nào trong 14 ngày qua" description="Khi bot phát hiện link bị chặn hoặc từ cấm ở nhóm đang bật quy tắc, số liệu theo ngày sẽ hiện ở đây." />;
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Legend />
        <Button variant="ghost" aria-pressed={showTable} onClick={() => setShowTable((value) => !value)}>
          {showTable ? "Xem biểu đồ" : "Xem dạng bảng"}
        </Button>
      </div>
      {showTable ? <div className="mt-4"><DataTable series={series} /></div> : (
        <div className="mt-4 flex gap-3">
          <div aria-hidden="true" className="flex flex-col justify-between text-right text-xs tabular-nums text-subtle" style={{ height: plotHeight }}>
            {ticks.map((tick) => <span key={tick} className="-translate-y-1/2 first:translate-y-0 last:translate-y-0">{formatNumber(tick)}</span>)}
          </div>
          <div className="min-w-0 flex-1">
            <div className="relative" style={{ height: plotHeight }} onMouseLeave={() => setActiveIndex(undefined)}>
              {ticks.map((tick) => (
                <div key={tick} aria-hidden="true" className="absolute inset-x-0 border-t border-grid" style={{ bottom: `${(tick / top) * 100}%` }} />
              ))}
              <ul className="absolute inset-0 flex">
                {series.map((day, index) => {
                  const dayTotal = day.link + day.badWord;
                  return (
                    <li key={day.date} className="flex min-w-0 flex-1">
                      <button
                        type="button"
                        aria-label={`${formatDay(day.date, "long")}: ${dayTotal} tin vi phạm, ${day.link} link, ${day.badWord} từ cấm`}
                        onMouseEnter={() => setActiveIndex(index)}
                        onFocus={() => setActiveIndex(index)}
                        onBlur={() => setActiveIndex(undefined)}
                        className={cn("flex w-full flex-col-reverse items-center rounded-sm", activeIndex === index && "bg-surface-hover")}
                      >
                        {/* The 2px gaps between segments and above the baseline are the surface showing through, not strokes. */}
                        {violationRules.map((rule, position) => day[rule] === 0 ? null : (
                          <span
                            key={rule}
                            className={cn("w-full max-w-6", seriesColor[rule], position > 0 && day.link > 0 ? "mb-0.5" : "", position === violationRules.length - 1 || day.badWord === 0 ? "rounded-t" : "")}
                            style={{ height: `${(day[rule] / top) * 100}%` }}
                          />
                        ))}
                      </button>
                    </li>
                  );
                })}
              </ul>
              {active !== undefined && activeIndex !== undefined ? (
                <div
                  role="status"
                  className="pointer-events-none absolute top-0 z-10 w-44 -translate-x-1/2 rounded-md border border-border bg-surface p-3 text-sm shadow-lg"
                  style={{ left: `clamp(5.5rem, ${((activeIndex + 0.5) / series.length) * 100}%, calc(100% - 5.5rem))` }}
                >
                  <p className="font-medium">{formatDay(active.date, "long")}</p>
                  <ul className="mt-2 space-y-1 tabular-nums">
                    {violationRules.map((rule) => (
                      <li key={rule} className="flex items-center justify-between gap-3">
                        <span className="flex items-center gap-2 text-muted">
                          <span aria-hidden="true" className={cn("size-2.5 rounded-sm", seriesColor[rule])} />
                          {ruleLabels[rule]}
                        </span>
                        <span>{formatNumber(active[rule])}</span>
                      </li>
                    ))}
                    <li className="flex justify-between gap-3 border-t border-border pt-1 font-medium">
                      <span>Tổng</span>
                      <span>{formatNumber(active.link + active.badWord)}</span>
                    </li>
                  </ul>
                </div>
              ) : null}
            </div>
            <ul aria-hidden="true" className="mt-2 flex text-xs tabular-nums text-subtle">
              {series.map((day, index) => (
                <li key={day.date} className="min-w-0 flex-1 text-center">
                  {/* Every other day is labelled so the dates never collide on narrow screens. */}
                  {(series.length - 1 - index) % 2 === 0 ? formatDay(day.date) : ""}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
