/**
 * Format hours into a human-readable duration string
 */
export function formatDuration(hours: number): string {
  if (hours === 0) return "—";
  
  if (hours < 1) {
    const minutes = Math.round(hours * 60);
    return `${minutes}m`;
  }
  
  if (hours < 24) {
    const wholeHours = Math.floor(hours);
    const minutes = Math.round((hours - wholeHours) * 60);
    if (minutes === 0) return `${wholeHours}h`;
    return `${wholeHours}h ${minutes}m`;
  }
  
  const days = Math.floor(hours / 24);
  const remainingHours = Math.round(hours % 24);
  if (remainingHours === 0) return `${days}d`;
  return `${days}d ${remainingHours}h`;
}

/**
 * Format a number with appropriate decimal places
 */
export function formatNumber(value: number, decimals: number = 1): string {
  if (value === 0) return "0";
  return value.toFixed(decimals).replace(/\.0$/, "");
}
