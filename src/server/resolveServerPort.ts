export class InvalidServerPortError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidServerPortError";
  }
}

const MIN_PORT = 1;
const MAX_PORT = 65535;
const DEFAULT_PORT = 3000;

export function resolveServerPort(value: string | undefined = process.env.PORT): number {
  if (value === undefined || value.trim() === "") {
    return DEFAULT_PORT;
  }

  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) {
    throw new InvalidServerPortError(
      `Invalid PORT environment variable "${trimmed}": must be an integer between ${MIN_PORT} and ${MAX_PORT}`
    );
  }

  const port = Number(trimmed);
  if (!Number.isInteger(port) || port < MIN_PORT || port > MAX_PORT) {
    throw new InvalidServerPortError(
      `Invalid PORT environment variable "${trimmed}": must be an integer between ${MIN_PORT} and ${MAX_PORT}`
    );
  }

  return port;
}
