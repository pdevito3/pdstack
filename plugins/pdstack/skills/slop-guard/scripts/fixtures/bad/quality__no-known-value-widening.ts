type Handler = () => void;

declare const startHandler: Handler;

export const handlers: Record<string, Handler> = {
  start: startHandler,
};
