import type { TesterMetrics } from "@/types/metrics";
import { formatDuration } from "@/lib/formatters";

interface TesterMetricsTableProps {
  metrics: TesterMetrics[];
}

export function TesterMetricsTable({ metrics }: TesterMetricsTableProps) {
  if (metrics.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        No tester metrics available
      </div>
    );
  }

  return (
    <div className="overflow-x-auto animate-fade-in">
      <table className="data-table">
        <thead>
          <tr>
            <th>Tester</th>
            <th>Closed Items</th>
            <th>DEV Test Speed (Avg)</th>
            <th>STG Test Speed (Avg)</th>
            <th>DEV Iterations</th>
            <th>STG Iterations</th>
            <th>PR Comments</th>
          </tr>
        </thead>
        <tbody>
          {metrics.map((metric, index) => (
            <tr key={metric.tester} style={{ animationDelay: `${index * 50}ms` }}>
              <td className="font-medium">{metric.tester}</td>
              <td>
                <span className="badge-success">{metric.closedItemsCount}</span>
              </td>
              <td>{formatDuration(metric.avgDevTestingSpeedHours)}</td>
              <td>{formatDuration(metric.avgStgTestingSpeedHours)}</td>
              <td>
                <span className="badge-dev">{metric.devTestingIterations}</span>
              </td>
              <td>
                <span className="badge-stg">{metric.stgTestingIterations}</span>
              </td>
              <td>{metric.prCommentsCount}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
