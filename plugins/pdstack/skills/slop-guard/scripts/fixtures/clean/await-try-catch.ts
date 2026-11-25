export async function load(promise: Promise<string>): Promise<string> {
  try {
    return await promise;
  } catch (error) {
    throw new Error('failed', { cause: error });
  }
}
