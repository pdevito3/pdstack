declare const prefix: string;

// eslint-disable-next-line anti-slop/no-unknown-parameters -- the log line accepts any value by design.
export function describe(input: unknown): string {
  return `${prefix}${JSON.stringify(input)}`;
}
