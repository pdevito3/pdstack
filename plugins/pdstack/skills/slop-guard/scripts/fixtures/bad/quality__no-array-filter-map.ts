interface User {
  active: boolean;
  email: string;
}

declare const users: Array<User>;

export const emails = users.filter((user) => user.active).map((user) => user.email);
