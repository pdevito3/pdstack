declare const literal: 'a';

// SAFETY: widening to the declared contract.
export const text = literal as string;
