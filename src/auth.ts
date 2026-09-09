import { timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";

export function bearerAuth(token: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const header = req.header("authorization") ?? "";
    const match = /^Bearer\s+(\S+)/i.exec(header);
    const provided = match?.[1] ?? "";
    if (!safeEqual(provided, token)) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    next();
  };
}

export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) {
    if (right.length > 0) timingSafeEqual(right, right);
    return false;
  }
  if (left.length === 0) return false;
  return timingSafeEqual(left, right);
}
