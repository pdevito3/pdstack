interface User {
  active: boolean;
  email: string;
}

declare const users: Array<User>;

export const emails = users.flatMap((user) => (user.active ? [user.email] : []));
