declare const owner: { name: string };

export const value: string = Reflect.get(owner, 'name');
