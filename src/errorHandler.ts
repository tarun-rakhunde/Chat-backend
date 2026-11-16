import type { ErrorRequestHandler, RequestHandler } from 'express';
import { HttpError, notFound } from './errors';

export const notFoundHandler: RequestHandler = (req, _res, next) => {
  next(notFound('ROUTE_NOT_FOUND', `No route for ${req.method} ${req.path}`));
};

/** Every error response has the same shape: { error: { code, message, details? } }. */
export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof HttpError) {
    res.status(err.status).json({
      error: { code: err.code, message: err.message, details: err.details },
    });
    return;
  }

  // Errors from express.json(), e.g. malformed JSON or a body that is too large.
  if (isClientError(err)) {
    const code = err.type === 'entity.too.large' ? 'PAYLOAD_TOO_LARGE' : 'INVALID_REQUEST_BODY';
    res.status(err.status).json({ error: { code, message: err.message } });
    return;
  }

  console.error('Unhandled error:', err);
  res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Something went wrong' } });
};

function isClientError(err: unknown): err is { status: number; type?: string; message: string } {
  return (
    typeof err === 'object' &&
    err !== null &&
    'status' in err &&
    typeof err.status === 'number' &&
    err.status >= 400 &&
    err.status < 500
  );
}
