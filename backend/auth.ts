import { IncomingMessage, ServerResponse } from "http";
import jwt from "jsonwebtoken";

// ===== Typy JWT
export type TokenType = "access" | "refresh";

export interface JwtAccessPayload extends jwt.JwtPayload {
  sub: string;     // user id
  typ: "access";
}

export interface JwtRefreshPayload extends jwt.JwtPayload {
  sub: string;     // user id
  typ: "refresh";
  rv: number;      // refreshVersion
}

// ===== Konfiguracja TTL i cookies =====
export const ACCESS_TTL_SEC = 15 * 60;            // 15 min
export const REFRESH_TTL_SEC = 7 * 24 * 60 * 60;  // 7 dni
export const COOKIE_ACCESS = "auth";
export const COOKIE_REFRESH = "refresh";

const COOKIE_SECURE = process.env.NODE_ENV === "production";
const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";

// ===== Sign / Verify =====
export function signAccess(userId: string): string {
  const payload: Partial<JwtAccessPayload> = { sub: userId, typ: "access" };
  return jwt.sign(payload, JWT_SECRET, { expiresIn: ACCESS_TTL_SEC });
}

export function signRefresh(userId: string, refreshVersion: number): string {
  const payload: Partial<JwtRefreshPayload> = { sub: userId, typ: "refresh", rv: refreshVersion };
  return jwt.sign(payload, JWT_SECRET, { expiresIn: REFRESH_TTL_SEC });
}

export function verifyAccess(token: string): JwtAccessPayload | null {
  try {
    const p = jwt.verify(token, JWT_SECRET) as JwtAccessPayload;
    return p.typ === "access" ? p : null;
  } catch {
    return null;
  }
}

export function verifyRefresh(token: string): JwtRefreshPayload | null {
  try {
    const p = jwt.verify(token, JWT_SECRET) as JwtRefreshPayload;
    return p.typ === "refresh" && typeof p.rv === "number" ? p : null;
  } catch {
    return null;
  }
}

// ===== Cookies ======
function buildCookie(name: string, value: string, maxAgeSec: number): string {
  const parts = [
    `${name}=${value}`,
    "HttpOnly",
    "Path=/",
    `Max-Age=${maxAgeSec}`,
    "SameSite=Lax",
  ];
  if (COOKIE_SECURE) parts.push("Secure");
  return parts.join("; ");
}

export function setAuthCookies(res: ServerResponse, accessToken: string, refreshToken: string): void {
  res.setHeader("Set-Cookie", [
    buildCookie(COOKIE_ACCESS, accessToken, ACCESS_TTL_SEC),
    buildCookie(COOKIE_REFRESH, refreshToken, REFRESH_TTL_SEC),
  ]);
}

export function clearAuthCookies(res: ServerResponse): void {
  res.setHeader("Set-Cookie", [
    buildCookie(COOKIE_ACCESS, "", 0),
    buildCookie(COOKIE_REFRESH, "", 0),
  ]);
}

export function parseCookies(req: IncomingMessage): Record<string, string> {
  const header = req.headers?.cookie ?? "";
  return header
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean)
    .reduce<Record<string, string>>((acc, part) => {
      const idx = part.indexOf("=");
      if (idx > 0) {
        const k = part.slice(0, idx);
        const v = part.slice(idx + 1);
        acc[k] = v;
      }
      return acc;
    }, {});
}

export function getAccessFromReq(req: IncomingMessage): JwtAccessPayload | null {
  const cookies = parseCookies(req);
  const token = cookies[COOKIE_ACCESS];
  if (!token) return null;
  return verifyAccess(token);
}
