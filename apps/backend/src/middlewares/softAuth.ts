import { Request, Response, NextFunction } from "express";
import { verifyToken } from "../utils/jwt";

export const softAuth = (req: Request, _res: Response, next: NextFunction): void => {
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith("Bearer ")) {
    try {
      req.user = verifyToken(authHeader.split(" ")[1]);
    } catch {
      // invalid token — ignore, proceed without user
    }
  }
  next();
};
