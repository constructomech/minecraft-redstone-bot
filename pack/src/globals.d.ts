// Ambient declarations for globals the Bedrock script host provides
// but which aren't in the pure ES2022 lib. Keep this minimal.

declare const console: {
  log(...args: unknown[]): void;
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
};
