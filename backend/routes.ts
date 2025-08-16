import { Router, Request, Response } from "express";
import { readJSON, writeJSON } from "./db";
import { User, Car } from "./types";
import { nanoid } from "nanoid";

export const router = Router();

const usersFile = "db/users.json";
const carsFile = "db/cars.json";

//
// USERS
//
router.get("/users", async (_req: Request, res: Response) => {
  const users = await readJSON<User[]>(usersFile);
  res.json(users);
});

router.post("/users", async (req: Request, res: Response) => {
  const users = await readJSON<User[]>(usersFile);
  const newUser: User = { id: nanoid(), balance: 0, role: "user", ...req.body };
  users.push(newUser);
  await writeJSON(usersFile, users);
  res.status(201).json(newUser);
});

router.put("/users/:id", async (req: Request, res: Response) => {
  const users = await readJSON<User[]>(usersFile);
  const idx = users.findIndex(u => u.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: "User not found" });
  users[idx] = { ...users[idx], ...req.body };
  await writeJSON(usersFile, users);
  res.json(users[idx]);
});

router.delete("/users/:id", async (req: Request, res: Response) => {
  const users = await readJSON<User[]>(usersFile);
  const filtered = users.filter(u => u.id !== req.params.id);
  await writeJSON(usersFile, filtered);
  res.status(204).end();
});

//
// CARS
//
router.get("/cars", async (_req: Request, res: Response) => {
  const cars = await readJSON<Car[]>(carsFile);
  res.json(cars);
});

router.post("/cars", async (req: Request, res: Response) => {
  const cars = await readJSON<Car[]>(carsFile);
  const { model, price, ownerId } = req.body;

  if (!model || !price || !ownerId) {
    return res.status(400).json({ error: "Missing model, price or ownerId" });
  }

  const newCar: Car = {
    id: nanoid(),
    model,
    price,
    ownerId,
  };

  cars.push(newCar);
  await writeJSON(carsFile, cars);
  res.status(201).json(newCar);
});

router.put("/cars/:id", async (req: Request, res: Response) => {
  const cars = await readJSON<Car[]>(carsFile);
  const idx = cars.findIndex(c => c.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: "Car not found" });
  cars[idx] = { ...cars[idx], ...req.body };
  await writeJSON(carsFile, cars);
  res.json(cars[idx]);
});

router.delete("/cars/:id", async (req: Request, res: Response) => {
  const cars = await readJSON<Car[]>(carsFile);
  const filtered = cars.filter(c => c.id !== req.params.id);
  await writeJSON(carsFile, filtered);
  res.status(204).end();
});
