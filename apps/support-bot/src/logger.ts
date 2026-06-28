export function logEvent(entry: Record<string, unknown>): void {
  const line = JSON.stringify({ timestamp: new Date().toISOString(), ...entry }) + '\n';
  process.stdout.write(line);
}
