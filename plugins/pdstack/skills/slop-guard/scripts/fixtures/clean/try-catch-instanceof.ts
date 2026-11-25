export function attempt(run: () => void): string {
  try {
    run();

    return 'ok';
  } catch (error) {
    if (error instanceof Error) {
      return error.message;
    }

    throw error;
  }
}
