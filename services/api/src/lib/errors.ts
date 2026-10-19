/**
 * Errors that are safe to show to API clients. Anything else is reported as a generic 500.
 */
export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const Errors = {
  validation: (details: unknown) => new AppError(400, 'VALIDATION_FAILED', 'Some fields are invalid', details),
  unauthenticated: () => new AppError(401, 'UNAUTHENTICATED', 'Please sign in to continue'),
  /** Deliberately vague so it does not reveal whether the email exists. */
  invalidCredentials: () => new AppError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect'),
  accountLocked: () =>
    new AppError(429, 'ACCOUNT_LOCKED', 'Too many failed sign-in attempts. Please try again in a few minutes.'),
  accountInactive: () => new AppError(403, 'ACCOUNT_INACTIVE', 'This account is not active. Please contact support.'),
  forbidden: () => new AppError(403, 'FORBIDDEN', 'You do not have permission to do that'),
  notFound: (what = 'Resource') => new AppError(404, 'NOT_FOUND', `${what} not found`),
  conflict: (code: string, message: string) => new AppError(409, code, message),
};
