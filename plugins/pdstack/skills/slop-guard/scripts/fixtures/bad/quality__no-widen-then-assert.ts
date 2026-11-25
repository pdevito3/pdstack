interface User {
  id: string;
}

declare function loadUser(): User;

const loaded: User = loadUser();
const stored: unknown = loaded;
// SAFETY: fixture
export const user = stored as User;
