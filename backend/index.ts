import { createServer, IncomingMessage, ServerResponse } from "http";
import { readFile, access } from "fs/promises";
import { constants as FS_CONSTANTS } from "fs";
import { join, normalize, extname } from "path";
import { randomUUID } from "crypto";

import { readJSON, writeJSON } from "./db";
import {
  ACCESS_TTL_SEC,
  COOKIE_REFRESH,
  signAccess,
  signRefresh,
  verifyRefresh,
  parseCookies,
  setAuthCookies,
  clearAuthCookies,
  getAccessFromReq,
} from "./auth";
import {
  User,
  Car,
  SSEEvent,
  FundEvent,
  PurchaseEvent,
  Role,
  AuditEntry,
} from "./types";

/* ================================
   KONFIG
================================ */
const PORT: number = Number(process.env.PORT ?? 3000);
const usersFile: string = join("db", "users.json");
const carsFile: string = join("db", "cars.json");
const auditFile: string = join("db", "audits.json");

const STATIC_PREFIX = "/static/";
const STATIC_DIR = "frontend";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon",
};

/* ================================
   TYPY POMOCNICZE
================================ */
interface AdminFundBody {
  userId: string;
  amount: number;
}

interface FaucetBody {
  amount: number;
}

interface RegisterBody {
  username: string;
  password: string;
}

interface LoginBody {
  username: string;
  password: string;
}

interface CreateCarBody {
  model: string;
  price: number;
  ownerId: string;
}

/* ================================
   Helpery DB — ściśle typowane
================================ */
async function readUsers(): Promise<User[]> {
  return readJSON<User[]>(usersFile).catch(() => [] as User[]);
}
async function writeUsers(users: User[]): Promise<void> {
  await writeJSON<User[]>(usersFile, users);
}

async function readCars(): Promise<Car[]> {
  return readJSON<Car[]>(carsFile).catch(() => [] as Car[]);
}
async function writeCars(cars: Car[]): Promise<void> {
  await writeJSON<Car[]>(carsFile, cars);
}

type AuditInsert =
  | { type: "admin-fund"; adminId: string; userId: string; amount: number }
  | { type: "dev-faucet"; userId: string; amount: number }
  | {
      type: "purchase";
      carId: string;
      buyerId: string;
      sellerId: string;
      price: number;
    };

async function appendAudit(entry: AuditInsert): Promise<void> {
  const list = await readJSON<AuditEntry[]>(auditFile).catch(
    () => [] as AuditEntry[]
  );
  const item: AuditEntry = { ...entry, ts: Date.now() };
  list.push(item);
  await writeJSON<AuditEntry[]>(auditFile, list);
}

/* ================================
   JSON/HTTP helpers
================================ */
async function parseBody<T>(req: IncomingMessage): Promise<T | null> {
  return new Promise<T | null>((resolve) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      try {
        resolve(JSON.parse(body || "{}") as T);
      } catch {
        resolve(null);
      }
    });
  });
}

function json<T>(res: ServerResponse, status: number, payload: T): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(payload));
}

function getPath(req: IncomingMessage): string {
  const raw = req.url || "/";
  const q = raw.indexOf("?");
  return q === -1 ? raw : raw.slice(0, q);
}

function isLocalRequest(req: IncomingMessage): boolean {
  const xf = (req.headers["x-forwarded-for"] || "") as string;
  const ip = (req.socket?.remoteAddress || "").toString();
  const candidates = [ip, xf].join(",").toLowerCase();
  return (
    candidates.includes("127.0.0.1") ||
    candidates.includes("::1") ||
    candidates.trim() === ""
  );
}

/* ================================
   CURRENT USER
================================ */
async function getCurrentUser(req: IncomingMessage): Promise<User | null> {
  const payload = getAccessFromReq(req);
  if (!payload) return null;
  const users = await readUsers();
  return users.find((u) => u.id === payload.sub) ?? null;
}

/* ================================
   SEED ADMINA
================================ */
async function ensureAdminSeed(): Promise<void> {
  const users = await readUsers();
  for (const u of users) {
    if (typeof u.refreshVersion !== "number") (u as User).refreshVersion = 1;
  }
  const hasAdmin = users.some((u) => u.role === "admin");
  if (!hasAdmin) {
    users.push({
      id: "admin001",
      username: "admin",
      password: "admin123",
      role: "admin",
      balance: 10000,
      refreshVersion: 1,
    });
  }
  await writeUsers(users);
  if (!hasAdmin) console.log("Seeded default admin: admin/admin123");
}

/* ================================
   SSE infra
================================ */
type SSEClient = ServerResponse;
const sseClients: Set<SSEClient> = new Set();

function sseBroadcast(payload: SSEEvent): void {
  const msg = `event: ${payload.event}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const res of sseClients) {
    try {
      res.write(msg);
    } catch {
      /* klient mógł się rozłączyć */
    }
  }
}

// keep-alive ping
setInterval(() => {
  sseBroadcast({ event: "ping", ts: Date.now() });
}, 30_000);

/* ================================
   SERVER
================================ */
const server = createServer(
  async (req: IncomingMessage, res: ServerResponse) => {
    try {
      const path = getPath(req);

      // ---- pliki statyczne
      if (req.method === "GET" && path.startsWith(STATIC_PREFIX)) {
        const rel = normalize(path.replace(STATIC_PREFIX, ""));
        const safe = normalize(join(STATIC_DIR, rel));
        const ext = extname(safe).toLowerCase();
        try {
          await access(safe, FS_CONSTANTS.R_OK);
          const data = await readFile(safe);
          res.statusCode = 200;
          res.setHeader(
            "Content-Type",
            MIME[ext] || "application/octet-stream"
          );
          res.end(data);
        } catch {
          json(res, 404, { success: false, error: "File not found" });
        }
        return;
      }

      /* ========= AUTH ========= */

      // GET /auth/me
      if (path === "/auth/me" && req.method === "GET") {
        const me = await getCurrentUser(req);
        if (!me)
          return json(res, 401, { success: false, error: "Not authenticated" });
        const { password, ...safe } = me;
        return json(res, 200, { success: true, user: safe });
      }

      // POST /auth/register
      if (path === "/auth/register" && req.method === "POST") {
        const data = await parseBody<RegisterBody>(req);
        if (
          !data ||
          !data.username?.trim() ||
          typeof data.password !== "string"
        ) {
          return json(res, 400, { success: false, error: "Invalid user data" });
        }
        const users = await readUsers();
        if (users.some((u) => u.username === data.username)) {
          return json(res, 409, {
            success: false,
            error: "User already exists",
          });
        }

        const newUser: User = {
          id: randomUUID(),
          username: data.username,
          password: data.password,
          role: "user",
          balance: 0,
          refreshVersion: 1,
        };

        users.push(newUser);
        await writeUsers(users);

        const accessTok = signAccess(newUser.id);
        const refreshTok = signRefresh(newUser.id, newUser.refreshVersion ?? 1);
        setAuthCookies(res, accessTok, refreshTok);

        const { password, ...safe } = newUser;
        return json(res, 201, { success: true, user: safe });
      }

      // POST /auth/login
      if (path === "/auth/login" && req.method === "POST") {
        const data = await parseBody<LoginBody>(req);
        if (
          !data ||
          typeof data.username !== "string" ||
          typeof data.password !== "string"
        ) {
          return json(res, 400, {
            success: false,
            error: "Invalid login data",
          });
        }
        const users = await readUsers();
        const idx = users.findIndex(
          (u) => u.username === data.username && u.password === data.password
        );
        if (idx === -1)
          return json(res, 401, {
            success: false,
            error: "Invalid credentials",
          });

        users[idx].refreshVersion = (users[idx].refreshVersion ?? 1) + 1;
        await writeUsers(users);

        const me = users[idx];
        const accessTok = signAccess(me.id);
        const refreshTok = signRefresh(me.id, me.refreshVersion ?? 1);
        setAuthCookies(res, accessTok, refreshTok);

        const { password, ...safe } = me;
        return json(res, 200, { success: true, user: safe });
      }

      // POST /auth/refresh
      if (path === "/auth/refresh" && req.method === "POST") {
        const cookies = parseCookies(req);
        const rt = cookies[COOKIE_REFRESH];
        if (!rt)
          return json(res, 401, { success: false, error: "No refresh token" });

        const payload = verifyRefresh(rt);
        if (!payload)
          return json(res, 401, {
            success: false,
            error: "Invalid/expired refresh",
          });

        const users = await readUsers();
        const idx = users.findIndex((u) => u.id === payload.sub);
        if (idx === -1)
          return json(res, 401, { success: false, error: "User not found" });

        const currentRV = users[idx].refreshVersion ?? 1;
        if (payload.rv !== currentRV)
          return json(res, 401, { success: false, error: "Refresh revoked" });

        users[idx].refreshVersion = currentRV + 1;
        await writeUsers(users);

        const accessTok = signAccess(users[idx].id);
        const refreshTok = signRefresh(
          users[idx].id,
          users[idx].refreshVersion
        );
        setAuthCookies(res, accessTok, refreshTok);
        return json(res, 200, { success: true });
      }

      // POST /auth/logout
      if (path === "/auth/logout" && req.method === "POST") {
        const cookies = parseCookies(req);
        const rt = cookies[COOKIE_REFRESH];
        if (rt) {
          const payload = verifyRefresh(rt);
          if (payload?.sub) {
            const users = await readUsers();
            const idx = users.findIndex((u) => u.id === payload.sub);
            if (idx !== -1) {
              users[idx].refreshVersion = (users[idx].refreshVersion ?? 1) + 1;
              await writeUsers(users);
            }
          }
        }
        clearAuthCookies(res);
        return json(res, 200, { success: true });
      }

      /* ========= SSE ========= */

      if (path === "/sse" && req.method === "GET") {
        const me = await getCurrentUser(req);
        if (!me)
          return json(res, 401, { success: false, error: "Not authenticated" });

        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        });
        // wskazówka dla klienta jak retry'ować
        res.write("retry: 10000\n\n");

        sseClients.add(res);
        req.on("close", () => {
          sseClients.delete(res);
        });
        return; // NIE zamykamy strumienia
      }

      /* ========= USERS ========= */

      if (path === "/users" && req.method === "GET") {
        const me = await getCurrentUser(req);
        if (!me)
          return json(res, 401, { success: false, error: "Not authenticated" });

        const users = await readUsers();
        if (me.role === "admin") {
          const safe = users.map(({ password, ...rest }) => rest);
          return json(res, 200, safe);
        } else {
          const { password, ...safeMe } = me;
          return json(res, 200, [safeMe]);
        }
      }

      if (path === "/users" && req.method === "POST") {
        const me = await getCurrentUser(req);
        if (!me || me.role !== "admin")
          return json(res, 403, { success: false, error: "Forbidden" });

        const data = await parseBody<
          RegisterBody & { role?: "admin" | "user"; balance?: number }
        >(req);
        if (
          !data ||
          typeof data.username !== "string" ||
          typeof data.password !== "string"
        ) {
          return json(res, 400, { success: false, error: "Invalid user data" });
        }

        const users = await readUsers();
        if (users.some((u) => u.username === data.username)) {
          return json(res, 409, {
            success: false,
            error: "User already exists",
          });
        }

        const newUser: User = {
          id: randomUUID(),
          username: data.username,
          password: data.password,
          role: data.role === "admin" ? "admin" : "user",
          balance: Number.isFinite(data.balance) ? Number(data.balance) : 0,
          refreshVersion: 1,
        };
        users.push(newUser);
        await writeUsers(users);
        const { password, ...safe } = newUser;
        return json(res, 201, safe);
      }

      if (path.startsWith("/users/") && req.method === "PUT") {
        const me = await getCurrentUser(req);
        if (!me)
          return json(res, 401, { success: false, error: "Not authenticated" });

        const id = path.split("/")[2]!;
        const data = await parseBody<
          Partial<Omit<User, "id" | "refreshVersion">> & { role?: Role }
        >(req);
        if (!data)
          return json(res, 400, { success: false, error: "Invalid JSON" });

        const users = await readUsers();
        const idx = users.findIndex((u) => u.id === id);
        if (idx === -1)
          return json(res, 404, { success: false, error: "User not found" });

        if (me.role !== "admin" && me.id !== id)
          return json(res, 403, { success: false, error: "Forbidden" });
        if (me.role !== "admin" && "role" in data)
          delete (data as Partial<User>).role;

        users[idx] = { ...users[idx], ...data };
        await writeUsers(users);
        const { password, ...safe } = users[idx];
        return json(res, 200, safe);
      }

      if (path.startsWith("/users/") && req.method === "DELETE") {
        const me = await getCurrentUser(req);
        if (!me)
          return json(res, 401, { success: false, error: "Not authenticated" });

        const id = path.split("/")[2]!;
        const users = await readUsers();
        const exists = users.some((u) => u.id === id);
        if (!exists)
          return json(res, 404, { success: false, error: "User not found" });

        if (me.role !== "admin" && me.id !== id)
          return json(res, 403, { success: false, error: "Forbidden" });

        const filtered = users.filter((u) => u.id !== id);
        await writeUsers(filtered);
        res.statusCode = 204;
        return res.end();
      }

      /* ========= ADMIN FUND ========= */

      if (path === "/admin/fund" && req.method === "POST") {
        const me = await getCurrentUser(req);
        if (!me || me.role !== "admin")
          return json(res, 403, { success: false, error: "Forbidden" });

        const body = await parseBody<AdminFundBody>(req);
        const userId = String(body?.userId || "");
        const amount = Number(body?.amount);

        if (!userId || !Number.isFinite(amount)) {
          return json(res, 400, { success: false, error: "Invalid payload" });
        }
        if (amount === 0 || Math.abs(amount) > 1_000_000) {
          return json(res, 400, {
            success: false,
            error: "Amount out of bounds",
          });
        }

        const users = await readUsers();
        const idx = users.findIndex((u) => u.id === userId);
        if (idx === -1)
          return json(res, 404, { success: false, error: "User not found" });

        users[idx].balance = Number(users[idx].balance || 0) + amount;
        await writeUsers(users);

        await appendAudit({
          type: "admin-fund",
          adminId: me.id,
          userId,
          amount,
        });
        const evt: FundEvent = {
          event: "fund",
          by: "admin",
          adminId: me.id,
          userId,
          amount,
          ts: Date.now(),
        };
        sseBroadcast(evt);

        return json(res, 200, {
          success: true,
          user: { id: users[idx].id, balance: users[idx].balance },
        });
      }

      /* ========= DEV FAUCET ========= */

      if (path === "/faucet" && req.method === "POST") {
        if (process.env.NODE_ENV === "production") {
          return json(res, 404, { success: false, error: "Not found" });
        }
        const devSecret = process.env.DEV_FAUCET_SECRET || "";
        const hdr = (req.headers["x-dev-secret"] || "") as string;
        if (!devSecret || hdr !== devSecret) {
          return json(res, 401, {
            success: false,
            error: "Invalid dev secret",
          });
        }
        if (!isLocalRequest(req)) {
          return json(res, 403, { success: false, error: "Local only" });
        }

        const me = await getCurrentUser(req);
        if (!me)
          return json(res, 401, { success: false, error: "Not authenticated" });

        const body = await parseBody<FaucetBody>(req);
        const amount = Number(body?.amount);
        if (!Number.isFinite(amount))
          return json(res, 400, { success: false, error: "Invalid amount" });
        if (amount <= 0 || amount > 10_000) {
          return json(res, 400, {
            success: false,
            error: "Amount must be 1..10000",
          });
        }

        const users = await readUsers();
        const idx = users.findIndex((u) => u.id === me.id);
        if (idx === -1)
          return json(res, 404, { success: false, error: "User not found" });

        users[idx].balance = Number(users[idx].balance || 0) + amount;
        await writeUsers(users);

        await appendAudit({ type: "dev-faucet", userId: me.id, amount });
        const evt: FundEvent = {
          event: "fund",
          by: "faucet",
          userId: me.id,
          amount,
          ts: Date.now(),
        };
        sseBroadcast(evt);

        return json(res, 200, {
          success: true,
          user: { id: users[idx].id, balance: users[idx].balance },
        });
      }

      /* ========= CARS ========= */

      if (path === "/cars" && req.method === "GET") {
        const me = await getCurrentUser(req);
        if (!me)
          return json(res, 401, { success: false, error: "Not authenticated" });

        const cars = await readCars();
        if (me.role === "admin") return json(res, 200, cars);
        return json(
          res,
          200,
          cars.filter((c) => c.ownerId === me.id)
        );
      }

      if (path === "/cars" && req.method === "POST") {
        const me = await getCurrentUser(req);
        if (!me)
          return json(res, 401, { success: false, error: "Not authenticated" });

        const data = await parseBody<CreateCarBody>(req);
        if (
          !data ||
          typeof data.model !== "string" ||
          typeof data.price !== "number" ||
          typeof data.ownerId !== "string"
        ) {
          return json(res, 400, { success: false, error: "Invalid car data" });
        }
        if (me.role !== "admin" && data.ownerId !== me.id) {
          return json(res, 403, {
            success: false,
            error: "Forbidden: ownerId must equal your id",
          });
        }

        const cars = await readCars();
        const newCar: Car = {
          id: randomUUID(),
          model: data.model,
          price: data.price,
          ownerId: data.ownerId,
        };
        cars.push(newCar);
        await writeCars(cars);
        return json(res, 201, newCar);
      }

      if (path.startsWith("/cars/") && req.method === "PUT") {
        const me = await getCurrentUser(req);
        if (!me)
          return json(res, 401, { success: false, error: "Not authenticated" });

        const id = path.split("/")[2]!;
        const data = await parseBody<Partial<Omit<Car, "id">>>(req);
        if (!data)
          return json(res, 400, { success: false, error: "Invalid JSON" });

        const cars = await readCars();
        const idx = cars.findIndex((c) => c.id === id);
        if (idx === -1)
          return json(res, 404, { success: false, error: "Car not found" });

        if (me.role !== "admin" && cars[idx].ownerId !== me.id) {
          return json(res, 403, { success: false, error: "Forbidden" });
        }
        if (
          me.role !== "admin" &&
          typeof data.ownerId === "string" &&
          data.ownerId !== me.id
        ) {
          delete (data as Partial<Car>).ownerId;
        }

        cars[idx] = { ...cars[idx], ...data };
        await writeCars(cars);
        return json(res, 200, cars[idx]);
      }

      if (
        path.startsWith("/cars/") &&
        path.endsWith("/buy") &&
        req.method === "POST"
      ) {
        const me = await getCurrentUser(req);
        if (!me)
          return json(res, 401, { success: false, error: "Not authenticated" });

        const parts = path.split("/"); // ["", "cars", ":id", "buy"]
        const carId = parts[2]!;
        const cars = await readCars();
        const users = await readUsers();

        const carIdx = cars.findIndex((c) => c.id === carId);
        if (carIdx === -1)
          return json(res, 404, { success: false, error: "Car not found" });

        const car = cars[carIdx];
        if (car.ownerId === me.id) {
          return json(res, 400, {
            success: false,
            error: "You already own this car",
          });
        }

        const sellerIdx = users.findIndex((u) => u.id === car.ownerId);
        if (sellerIdx === -1)
          return json(res, 409, {
            success: false,
            error: "Seller user not found",
          });

        const buyerIdx = users.findIndex((u) => u.id === me.id);
        if (buyerIdx === -1)
          return json(res, 401, { success: false, error: "Buyer not found" });

        const price = Number(car.price);
        const buyerBalance = Number(users[buyerIdx].balance || 0);
        if (!Number.isFinite(price) || price < 0)
          return json(res, 400, { success: false, error: "Invalid car price" });
        if (buyerBalance < price)
          return json(res, 400, {
            success: false,
            error: "Insufficient balance",
          });

        users[buyerIdx].balance = buyerBalance - price;
        users[sellerIdx].balance =
          Number(users[sellerIdx].balance || 0) + price;
        cars[carIdx] = { ...car, ownerId: me.id };

        await writeUsers(users);
        await writeCars(cars);

        const evt: PurchaseEvent = {
          event: "purchase",
          carId: car.id,
          model: car.model,
          price,
          sellerId: users[sellerIdx].id,
          buyerId: users[buyerIdx].id,
          ts: Date.now(),
        };
        sseBroadcast(evt);
        await appendAudit({
          type: "purchase",
          carId: car.id,
          buyerId: users[buyerIdx].id,
          sellerId: users[sellerIdx].id,
          price,
        });

        return json(res, 200, {
          success: true,
          car: cars[carIdx],
          buyer: { id: users[buyerIdx].id, balance: users[buyerIdx].balance },
          seller: {
            id: users[sellerIdx].id,
            balance: users[sellerIdx].balance,
          },
        });
      }

      // fallback
      return json(res, 404, { success: false, error: "Not found" });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return json(res, 500, {
        success: false,
        error: "Internal server error",
        details: message,
      });
    }
  }
);

ensureAdminSeed()
  .catch(() => void 0)
  .finally(() => {
    server.listen(PORT, () => {
      console.log(`Server running on http://localhost:${PORT}`);
    });
  });
