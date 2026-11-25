export function attempt(run: () => void): void {
  try {
    run();
  } catch (err) {
    throw new Error('failed', { cause: err });
  }
}
