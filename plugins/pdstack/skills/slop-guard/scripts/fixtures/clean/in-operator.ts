export function size(value: string | Uint8Array): number {
  if ('byteLength' in value) {
    return value.byteLength;
  }

  return value.length;
}
