interface UserSchema {
  // eslint-disable-next-line anti-slop/no-shape-in-symbol-names -- zod names this member, and the repo only reads it.
  readonly shape: { readonly id: string };
}

declare const userSchema: UserSchema;

export const userKeys = Object.keys(userSchema.shape);
