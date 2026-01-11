import type { DeveloperMetrics } from "@/types/metrics";
import { formatDuration } from "@/lib/formatters";

interface DeveloperMetricsTableProps {
  metrics: DeveloperMetrics[];
}

export function DeveloperMetricsTable({ metrics }: DeveloperMetricsTableProps) {
  if (metrics.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        No developer metrics available
      </div>
    );
  }

  return (
    <div className="overflow-x-auto animate-fade-in">
      <table className="data-table">
        <thead>
          <tr>
            <th>Developer</th>
            <th>Dev Speed (Avg)</th>
            <th>Items Completed</th>
            <th>Total Returns</th>
            <th>Code Review → Fix</th>
            <th>DEV Test → Fix</th>
            <th>STG Test → Fix</th>
          </tr>
        </thead>
        <tbody>
          {metrics.map((metric, index) => (
            <tr key={metric.developer} style={{ animationDelay: `${index * 50}ms` }}>
              <td className="font-medium">{metric.developer}</td>
              <td>{formatDuration(metric.developmentSpeedHours)}</td>
              <td>{metric.itemsCompleted}</td>
              <td>
                <span className={metric.totalReturnCount > 0 ? "text-warning font-medium" : ""}>
                  {metric.totalReturnCount}
                </span>
              </td>
              <td>{metric.codeReviewReturns}</td>
              <td>
                <span className="badge-dev">{metric.devTestingReturns}</span>
              </td>
              <td>
                <span className="badge-stg">{metric.stgTestingReturns}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
