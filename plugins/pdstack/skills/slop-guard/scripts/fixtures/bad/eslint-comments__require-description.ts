declare const prefix: string;

// eslint-disable-next-line anti-slop/no-unknown-parameters
export function describe(input: unknown): string {
  return `${prefix}${JSON.stringify(input)}`;
}
