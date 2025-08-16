import { IncomingMessage, ServerResponse } from "http";
import jwt from "jsonwebtoken";

export interface User {
  id: string;
  username: string;
  role: "admin" | "user";
}

const SECRET = process.env.JWT_SECRET || "super-secret-key";






export function generateToken(userId: string): string {
  return jwt.sign({ sub: userId }, SECRET, { expiresIn: "15m" });
}

export function getUserFromToken(token: string): User | null {
  try {
    const decoded = jwt.verify(token, SECRET) as jwt.JwtPayload;
    return {
      id: decoded.sub as string,
      username: decoded.sub as string,
      role: "user",
    };
  } catch {
    return null;
  }
}


export function setAuthCookie(res: ServerResponse, token: string) {
  res.setHeader(
    "Set-Cookie",
    `auth=${token}; HttpOnly; Path=/; Max-Age=900` 
  );
}

export function parseCookies(req: IncomingMessage): Record<string, string> {
  const cookieHeader = req.headers.cookie ?? "";
  return cookieHeader.split(";").reduce<Record<string, string>>((acc, part) => {
    const [key, value] = part.trim().split("=");
    if (key && value) acc[key] = value;
    return acc;
  }, {});
}
