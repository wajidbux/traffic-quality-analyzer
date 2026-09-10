import { NextFunction, Request, RequestHandler, Response } from "express";

/**
 * Wrap an async Express handler so rejected promises reach the central error
 * handler instead of becoming unhandled rejections (Express 4 does not catch
 * async handler errors itself).
 */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>
): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}