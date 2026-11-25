function isText(value: string | Uint8Array): value is string {
  return typeof value === 'string';
}

export function size(value: string | Uint8Array): number {
  if (isText(value)) {
    return value.length;
  }

  return value.byteLength;
}
