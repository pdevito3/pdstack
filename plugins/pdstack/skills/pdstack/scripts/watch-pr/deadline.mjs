export class DeadlineExceeded extends Error {
  constructor() {
    super("watch deadline reached");
    this.name = "DeadlineExceeded";
  }
}

/** One monotonic budget shared by discovery, commands, polling and retries. */
export class WatchDeadline {
  expiresAt;
  now;
  constructor(timeout, now) {
    this.now = now;
    this.expiresAt = timeout > 0 ? now() + timeout : Infinity;
  }
  remaining() {
    return Math.max(0, this.expiresAt - this.now());
  }
}
