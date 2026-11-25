export async function load(promise: Promise<string>): Promise<string> {
  return promise.catch((cause: unknown) => {
    throw new Error('failed', { cause });
  });
}
