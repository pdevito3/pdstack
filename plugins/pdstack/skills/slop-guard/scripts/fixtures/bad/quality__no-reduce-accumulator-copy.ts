interface Item {
  id: string;
}

declare const items: Array<Item>;

export const byId = items.reduce<Record<string, Item>>(
  (acc, item) => Object.assign({}, acc, { [item.id]: item }),
  {},
);
