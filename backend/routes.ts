import { Router, Request, Response, NextFunction } from "express";
import { ServerResponse } from "http";
import { nanoid } from "nanoid";

import { readJSON, writeJSON } from "./db";
import { User, Car } from "./types";

import {
  COOKIE_REFRESH,
  signAccess,
  signRefresh,
  verifyRefresh,
  getAccessFromReq,
  setAuthCookies,
  clearAuthCookies,
  parseCookies,
} from "./auth";

export const router = Router();

const usersFile = "db/users.json";
const carsFile = "db/cars.json";

/* ================================
   SSE
================================ */
const sseClients = new Set<ServerResponse>();

function sseBroadcast(event: string, payload: any) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const res of sseClients) {
    try {
      res.write(msg);
    } catch {

    }
  }
}


setInterval(() => {
  const ping = `event: ping\ndata: ${Date.now()}\n\n`;
  for (const res of sseClients) {
    try {
      res.write(ping);
    } catch {}
  }
}, 30000);

/* ================================
   MIDDLEWARE AUTH
================================ */
interface AuthedRequest extends Request {
  currentUser?: User;
}

async function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  try {
    const payload = getAccessFromReq(req);
    if (!payload) {
      return res.status(401).json({ success: false, error: "Not authenticated" });
    }
    const users = await readJSON<User[]>(usersFile);
    const me = users.find(u => u.id === payload.sub);
    if (!me) {
      return res.status(401).json({ success: false, error: "User not found" });
    }
    req.currentUser = me;
    next();
  } catch (e) {
    res.status(500).json({ success: false, error: "Internal error" });
  }
}

function requireAdmin(req: AuthedRequest, res: Response, next: NextFunction) {
  if (req.currentUser?.role !== "admin") {
    return res.status(403).json({ success: false, error: "Forbidden" });
  }
  next();
}

/* ================================
   AUTH ENDPOINTS
================================ */

// GET /auth/me
router.get("/auth/me", requireAuth, (req: AuthedRequest, res: Response) => {
  const { password, ...safe } = req.currentUser!;
  res.json({ success: true, user: safe });
});

// POST /auth/register
router.post("/auth/register", async (req: Request, res: Response) => {
  const { username, password } = req.body || {};
  if (typeof username !== "string" || typeof password !== "string" || !username.trim()) {
    return res.status(400).json({ success: false, error: "Invalid user data" });
  }

  const users = await readJSON<User[]>(usersFile).catch(() => [] as User[]);
  if (users.some(u => u.username === username)) {
    return res.status(409).json({ success: false, error: "User already exists" });
  }

  const newUser: User = {
    id: nanoid(),
    username,
    password,        // UWAGA: w prawdziwej appce haszuj!
    role: "user",
    balance: 0,
    refreshVersion: 1,
  };

  users.push(newUser);
  await writeJSON(usersFile, users);

  // ustaw access+refresh cookie
  const accessTok  = signAccess(newUser.id);
  const refreshTok = signRefresh(newUser.id, newUser.refreshVersion!);
  setAuthCookies(res, accessTok, refreshTok);

  const { password: _pw, ...safe } = newUser;
  res.status(201).json({ success: true, user: safe });
});

// POST /auth/login
router.post("/auth/login", async (req: Request, res: Response) => {
  const { username, password } = req.body || {};
  if (typeof username !== "string" || typeof password !== "string") {
    return res.status(400).json({ success: false, error: "Invalid login data" });
  }

  const users = await readJSON<User[]>(usersFile).catch(() => [] as User[]);
  const idx = users.findIndex(u => u.username === username && u.password === password);
  if (idx === -1) {
    return res.status(401).json({ success: false, error: "Invalid credentials" });
  }

  // rotacja refreshVersion przy logowaniu
  users[idx].refreshVersion = (users[idx].refreshVersion ?? 0) + 1;
  await writeJSON(usersFile, users);

  const me = users[idx];
  const accessTok  = signAccess(me.id);
  const refreshTok = signRefresh(me.id, me.refreshVersion!);
  setAuthCookies(res, accessTok, refreshTok);

  const { password: _pw, ...safe } = me;
  res.json({ success: true, user: safe });
});

// POST /auth/refresh
router.post("/auth/refresh", async (req: Request, res: Response) => {
  const cookies = parseCookies(req);
  const rt = cookies[COOKIE_REFRESH];
  if (!rt) return res.status(401).json({ success: false, error: "No refresh token" });

  const payload = verifyRefresh(rt);
  if (!payload) return res.status(401).json({ success: false, error: "Invalid/expired refresh" });

  const users = await readJSON<User[]>(usersFile).catch(() => [] as User[]);
  const idx = users.findIndex(u => u.id === payload.sub);
  if (idx === -1) return res.status(401).json({ success: false, error: "User not found" });

  const currentRV = users[idx].refreshVersion ?? 0;
  if (payload.rv !== currentRV) return res.status(401).json({ success: false, error: "Refresh revoked" });

  users[idx].refreshVersion = currentRV + 1; // rotacja
  await writeJSON(usersFile, users);

  const accessTok  = signAccess(users[idx].id);
  const refreshTok = signRefresh(users[idx].id, users[idx].refreshVersion!);
  setAuthCookies(res, accessTok, refreshTok);

  res.json({ success: true });
});

// POST /auth/logout
router.post("/auth/logout", async (req: Request, res: Response) => {
  const cookies = parseCookies(req);
  const rt = cookies[COOKIE_REFRESH];
  if (rt) {
    const payload = verifyRefresh(rt);
    if (payload?.sub) {
      const users = await readJSON<User[]>(usersFile).catch(() => [] as User[]);
      const idx = users.findIndex(u => u.id === payload.sub);
      if (idx !== -1) {
        users[idx].refreshVersion = (users[idx].refreshVersion ?? 0) + 1; // unieważnij wszystkie obecne refresh'e
        await writeJSON(usersFile, users);
      }
    }
  }
  clearAuthCookies(res);
  res.json({ success: true });
});

/* ================================
   SSE endpoint (tylko zalogowani)
================================ */
router.get("/sse", requireAuth, (req: AuthedRequest, res: Response) => {
  const nodeRes = res as unknown as ServerResponse;

  nodeRes.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
  });
  nodeRes.write("retry: 10000\n\n");

  sseClients.add(nodeRes);
  req.on("close", () => {
    sseClients.delete(nodeRes);
  });
});

/* ================================
   USERS
================================ */
// GET /users
// - admin: lista wszystkich (bez haseł)
// - user: tylko on sam (w tablicy)
router.get("/users", requireAuth, async (req: AuthedRequest, res: Response) => {
  const me = req.currentUser!;
  const users = await readJSON<User[]>(usersFile).catch(() => [] as User[]);
  if (me.role === "admin") {
    const safe = users.map(({ password, ...rest }) => rest);
    return res.json(safe);
  } else {
    const { password, ...safeMe } = me;
    return res.json([safeMe]);
  }
});

// POST /users (admin-only)
router.post("/users", requireAuth, requireAdmin, async (req: AuthedRequest, res: Response) => {
  const users = await readJSON<User[]>(usersFile).catch(() => [] as User[]);
  const { username, password, role, balance } = req.body || {};
  if (typeof username !== "string" || typeof password !== "string") {
    return res.status(400).json({ error: "Invalid user data" });
  }
  if (users.some(u => u.username === username)) {
    return res.status(409).json({ error: "User already exists" });
  }
  const newUser: User = {
    id: nanoid(),
    username,
    password,
    role: role === "admin" ? "admin" : "user",
    balance: Number.isFinite(Number(balance)) ? Number(balance) : 0,
    refreshVersion: 1,
  };
  users.push(newUser);
  await writeJSON(usersFile, users);
  const { password: _pw, ...safe } = newUser;
  res.status(201).json(safe);
});

// PUT /users/:id (owner lub admin)
router.put("/users/:id", requireAuth, async (req: AuthedRequest, res: Response) => {
  const me = req.currentUser!;
  const users = await readJSON<User[]>(usersFile).catch(() => [] as User[]);
  const idx = users.findIndex(u => u.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: "User not found" });

  if (me.role !== "admin" && me.id !== req.params.id) {
    return res.status(403).json({ error: "Forbidden" });
  }

  const patch = { ...req.body };
  if (me.role !== "admin" && "role" in patch) delete (patch as any).role;

  users[idx] = { ...users[idx], ...patch };
  await writeJSON(usersFile, users);
  const { password, ...safe } = users[idx];
  res.json(safe);
});

// DELETE /users/:id (owner lub admin)
router.delete("/users/:id", requireAuth, async (req: AuthedRequest, res: Response) => {
  const me = req.currentUser!;
  const users = await readJSON<User[]>(usersFile).catch(() => [] as User[]);
  const exists = users.some(u => u.id === req.params.id);
  if (!exists) return res.status(404).json({ error: "User not found" });

  if (me.role !== "admin" && me.id !== req.params.id) {
    return res.status(403).json({ error: "Forbidden" });
  }

  const filtered = users.filter(u => u.id !== req.params.id);
  await writeJSON(usersFile, filtered);
  res.status(204).end();
});

/* ================================
   CARS
================================ */
// GET /cars
router.get("/cars", requireAuth, async (req: AuthedRequest, res: Response) => {
  const me = req.currentUser!;
  const cars = await readJSON<Car[]>(carsFile).catch(() => [] as Car[]);
  if (me.role === "admin") return res.json(cars);
  return res.json(cars.filter(c => c.ownerId === me.id));
});

// POST /cars
router.post("/cars", requireAuth, async (req: AuthedRequest, res: Response) => {
  const me = req.currentUser!;
  const { model, price, ownerId } = req.body || {};
  if (typeof model !== "string" || typeof price !== "number" || typeof ownerId !== "string") {
    return res.status(400).json({ error: "Missing/invalid model, price or ownerId" });
  }
  if (me.role !== "admin" && ownerId !== me.id) {
    return res.status(403).json({ error: "Forbidden: ownerId must equal your id" });
  }

  const cars = await readJSON<Car[]>(carsFile).catch(() => [] as Car[]);
  const newCar: Car = { id: nanoid(), model, price, ownerId };
  cars.push(newCar);
  await writeJSON(carsFile, cars);
  res.status(201).json(newCar);
});

// PUT /cars/:id
router.put("/cars/:id", requireAuth, async (req: AuthedRequest, res: Response) => {
  const me = req.currentUser!;
  const cars = await readJSON<Car[]>(carsFile).catch(() => [] as Car[]);
  const idx = cars.findIndex(c => c.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: "Car not found" });

  if (me.role !== "admin" && cars[idx].ownerId !== me.id) {
    return res.status(403).json({ error: "Forbidden" });
  }

  const patch = { ...req.body };
  if (me.role !== "admin" && typeof patch.ownerId === "string" && patch.ownerId !== me.id) {
    delete (patch as any).ownerId;
  }

  cars[idx] = { ...cars[idx], ...patch };
  await writeJSON(carsFile, cars);
  res.json(cars[idx]);
});

// DELETE /cars/:id
router.delete("/cars/:id", requireAuth, async (req: AuthedRequest, res: Response) => {
  const me = req.currentUser!;
  const cars = await readJSON<Car[]>(carsFile).catch(() => [] as Car[]);
  const car = cars.find(c => c.id === req.params.id);
  if (!car) return res.status(404).json({ error: "Car not found" });

  if (me.role !== "admin" && car.ownerId !== me.id) {
    return res.status(403).json({ error: "Forbidden" });
  }

  const filtered = cars.filter(c => c.id !== req.params.id);
  await writeJSON(carsFile, filtered);
  res.status(204).end();
});

// POST /cars/:id/buy
router.post("/cars/:id/buy", requireAuth, async (req: AuthedRequest, res: Response) => {
  const me = req.currentUser!;

  const cars  = await readJSON<Car[]>(carsFile).catch(() => [] as Car[]);
  const users = await readJSON<User[]>(usersFile).catch(() => [] as User[]);

  const carIdx = cars.findIndex(c => c.id === req.params.id);
  if (carIdx === -1) return res.status(404).json({ success: false, error: "Car not found" });

  const car = cars[carIdx];

  if (car.ownerId === me.id) {
    return res.status(400).json({ success: false, error: "You already own this car" });
  }

  const sellerIdx = users.findIndex(u => u.id === car.ownerId);
  if (sellerIdx === -1) {
    return res.status(409).json({ success: false, error: "Seller user not found" });
  }

  const buyerIdx = users.findIndex(u => u.id === me.id);
  if (buyerIdx === -1) {
    return res.status(401).json({ success: false, error: "Buyer not found" });
  }

  const price = Number(car.price);
  const buyerBalance = Number(users[buyerIdx].balance || 0);
  if (!Number.isFinite(price) || price < 0) {
    return res.status(400).json({ success: false, error: "Invalid car price" });
  }
  if (buyerBalance < price) {
    return res.status(400).json({ success: false, error: "Insufficient balance" });
  }

  // aktualizacja
  users[buyerIdx].balance  = buyerBalance - price;
  users[sellerIdx].balance = Number(users[sellerIdx].balance || 0) + price;
  cars[carIdx] = { ...car, ownerId: me.id };

  await writeJSON(usersFile, users);
  await writeJSON(carsFile, cars);

  // SSE broadcast
  sseBroadcast("purchase", {
    event: "purchase",
    carId: car.id,
    model: car.model,
    price,
    sellerId: users[sellerIdx].id,
    buyerId: users[buyerIdx].id,
    ts: Date.now(),
  });

  res.json({
    success: true,
    car: cars[carIdx],
    buyer:  { id: users[buyerIdx].id,  balance: users[buyerIdx].balance },
    seller: { id: users[sellerIdx].id, balance: users[sellerIdx].balance },
  });
});
