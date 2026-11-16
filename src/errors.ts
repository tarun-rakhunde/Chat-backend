/**
 * An error that maps directly to an HTTP response.
 * Services throw these; the error middleware turns them into JSON.
 */
export class HttpError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (code: string, message: string, details?: unknown) =>
  new HttpError(400, code, message, details);

export const forbidden = (code: string, message: string) => new HttpError(403, code, message);

export const notFound = (code: string, message: string, details?: unknown) =>
  new HttpError(404, code, message, details);

export const conflict = (code: string, message: string) => new HttpError(409, code, message);
