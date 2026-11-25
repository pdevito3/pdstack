type Handler = () => void;

declare const startHandler: Handler;

export const handlers = {
  start: startHandler,
} satisfies Record<string, Handler>;
