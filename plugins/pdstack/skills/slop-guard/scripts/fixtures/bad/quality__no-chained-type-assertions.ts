interface User {
  id: string;
}

declare const input: string;

// SAFETY: fixture
export const user = input as unknown as User;
