declare const operation: (a: number) => number;
declare const owner: { name: string };

export const value: number = Reflect.apply(operation, owner, [1]);
