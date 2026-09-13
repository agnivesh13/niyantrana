/**
 * Application error hierarchy.
 *
 * Failures are typed exceptions, translated to status codes in exactly one
 * place: the error middleware. Each carries the status it deserves, so a route
 * signals what went wrong by throwing rather than by assembling a response, and
 * no handler can accidentally return 200 for a request that failed.
 */
export class AppError extends Error {
  constructor(message, statusCode = 500, details = undefined) {
    super(message);
    this.name = new.target.name;
    this.statusCode = statusCode;
    this.details = details;
    this.isOperational = true;
    Error.captureStackTrace?.(this, new.target);
  }
}

export class ValidationError extends AppError {
  constructor(message, details) { super(message, 400, details); }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'You are not authorized') { super(message, 401); }
}

export class NotFoundError extends AppError {
  constructor(resource = 'Resource') { super(`${resource} not found`, 404); }
}

export class ConflictError extends AppError {
  constructor(message) { super(message, 409); }
}

export class ServiceUnavailableError extends AppError {
  constructor(message, details) { super(message, 503, details); }
}

/**
 * The inference service could not produce a prediction.
 *
 * Deliberately NOT caught and replaced with a default anywhere in this codebase.
 * An unavailable model is reported as unavailable.
 */
export class InferenceUnavailableError extends ServiceUnavailableError {
  constructor(cause) {
    super('Risk assessment is temporarily unavailable. No estimate was produced.',
      { reason: cause });
    this.provenance = 'unavailable';
  }
}
