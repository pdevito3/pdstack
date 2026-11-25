export function describe(input: string | number): string {
  if (typeof input === 'string') {
    return input;
  }

  return input.toFixed(0);
}
