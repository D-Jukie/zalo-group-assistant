const logColors = {
  cyan: "\u001b[36m",
  green: "\u001b[32m",
  magenta: "\u001b[35m",
  red: "\u001b[31m",
  yellow: "\u001b[33m",
  reset: "\u001b[0m",
} as const;

type LogColor = keyof Omit<typeof logColors, "reset">;
type LogOutput = "log" | "warn" | "error";

function colorizeLogPrefix(prefix: string, color: LogColor): string {
  if (process.env.NO_COLOR !== undefined || process.stdout.isTTY !== true) return prefix;
  return `${logColors[color]}${prefix}${logColors.reset}`;
}

function formatLogFields(fields: Readonly<Record<string, string>>): string {
  return Object.entries(fields)
    .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
    .join(" ");
}

export function writeLog(
  prefix: string,
  color: LogColor,
  fields: Readonly<Record<string, string>>,
  output: LogOutput = "log",
): void {
  const line = `${colorizeLogPrefix(prefix, color)} ${formatLogFields(fields)}`;
  if (output === "error") {
    console.error(line);
  } else if (output === "warn") {
    console.warn(line);
  } else {
    console.log(line);
  }
}
