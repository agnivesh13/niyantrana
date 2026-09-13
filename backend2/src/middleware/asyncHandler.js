/**
 * Wraps an async route handler so rejections reach the error middleware.
 *
 * Forwards a rejected promise to the error middleware, so handlers can be
 * plain async functions with no try/catch. Without it an async throw never
 * reaches Express and the request hangs until it times out.
 */
export const asyncHandler = (handler) => (req, res, next) =>
  Promise.resolve(handler(req, res, next)).catch(next);

export default asyncHandler;
