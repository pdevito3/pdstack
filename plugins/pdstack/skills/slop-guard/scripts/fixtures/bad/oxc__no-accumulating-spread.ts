declare const items: Array<number>;

export const copied = items.reduce<Array<number>>((acc, item) => [...acc, item], []);
