import { createServer } from "http";
import { readFile, writeFile } from "fs/promises";
import { join } from "path";
import { randomUUID } from "crypto";

const PORT = 4000;
const usersFile = join("db", "users.json");
const carsFile = join("db", "cars.json");

// helpers
async function loadJSON(file: string) {
  try {
    const data = await readFile(file, "utf-8");
    return JSON.parse(data);
  } catch {
    return [];
  }
}
async function saveJSON(file: string, data: any[]) {
  await writeFile(file, JSON.stringify(data, null, 2), "utf-8");
}
function parseBody(req: any): Promise<any | null> {
  return new Promise(resolve => {
    let body = "";
    req.on("data", (chunk: any) => (body += chunk));
    req.on("end", () => {
      try {
        const parsed = JSON.parse(body);
        resolve(parsed);
      } catch {
        resolve(null);
      }
    });
  });
}

const server = createServer(async (req, res) => {
  res.setHeader("Content-Type", "application/json");

  //
  // USERS CRUD
  // GET /users
  //
  if (req.url === "/users" && req.method === "GET") {
    const users = await loadJSON(usersFile);
    res.end(JSON.stringify(users));
    return;
  }
  //
  // POST /users
  //
 if (req.url === "/users" && req.method === "POST") {
    const data = await parseBody(req);
    if (!data || typeof data.username !== "string" || typeof data.password !== "string") {
      res.statusCode = 400;
      res.end(JSON.stringify({ success: false, error: "Invalid user data" }));
      return;
    }

    const users = await loadJSON(usersFile);
    const newUser = {
      id: randomUUID(),
      username: data.username,
      password: data.password,
      role: "user",
      balance: 0,
    };
    users.push(newUser);
    await saveJSON(usersFile, users);

    res.statusCode = 201;
    res.end(JSON.stringify(newUser));
    return;
  }
  //
  // PUT /users/:id
  //

  if (req.url?.startsWith("/users/") && req.method === "PUT") {
    const id = req.url.split("/")[2];
    const data = await parseBody(req);
    if (!data) {
      res.statusCode = 400;
      res.end(JSON.stringify({ success: false, error: "Invalid JSON" }));
      return;
    }

    const users = await loadJSON(usersFile);
    const idx = users.findIndex((u: any) => u.id === id);
    if (idx === -1) {
      res.statusCode = 404;
      res.end(JSON.stringify({ success: false, error: "User not found" }));
      return;
    }

    users[idx] = { ...users[idx], ...data };
    await saveJSON(usersFile, users);
    res.end(JSON.stringify(users[idx]));
    return;
  }

  //
  // DELETE /users/:id
  //
  if (req.url?.startsWith("/users/") && req.method === "DELETE") {
    const id = req.url.split("/")[2];
    const users = await loadJSON(usersFile);
    const filtered = users.filter((u: any) => u.id !== id);

    if (filtered.length === users.length) {
      res.statusCode = 404;
      res.end(JSON.stringify({ success: false, error: "User not found" }));
      return;
    }

    await saveJSON(usersFile, filtered);
    res.statusCode = 204;
    res.end();
    return;
  }

  //
  // CARS CRUD
  // GET /cars
  //
  if (req.url === "/cars" && req.method === "GET") {
    const cars = await loadJSON(carsFile);
    res.end(JSON.stringify(cars));
    return;
  }
  //
  // POST /cars
  //
 if (req.url === "/cars" && req.method === "POST") {
    const data = await parseBody(req);
    if (!data || typeof data.model !== "string" || typeof data.price !== "number" || typeof data.ownerId !== "string") {
      res.statusCode = 400;
      res.end(JSON.stringify({ success: false, error: "Invalid car data" }));
      return;
    }

    const cars = await loadJSON(carsFile);
    const newCar = {
      id: randomUUID(),
      model: data.model,
      price: data.price,
      ownerId: data.ownerId,
    };
    cars.push(newCar);
    await saveJSON(carsFile, cars);

    res.statusCode = 201;
    res.end(JSON.stringify(newCar));
    return;
  }
  //
  // PUT /cars/:id
  //


  if (req.url?.startsWith("/cars/") && req.method === "PUT") {
    const id = req.url.split("/")[2];
    const data = await parseBody(req);
    if (!data) {
      res.statusCode = 400;
      res.end(JSON.stringify({ success: false, error: "Invalid JSON" }));
      return;
    }

    const cars = await loadJSON(carsFile);
    const idx = cars.findIndex((c: any) => c.id === id);
    if (idx === -1) {
      res.statusCode = 404;
      res.end(JSON.stringify({ success: false, error: "Car not found" }));
      return;
    }

    cars[idx] = { ...cars[idx], ...data };
    await saveJSON(carsFile, cars);
    res.end(JSON.stringify(cars[idx]));
    return;
  }
  //
  // DELETE /cars/:id
  //

  if (req.url?.startsWith("/cars/") && req.method === "DELETE") {
    const id = req.url.split("/")[2];
    const cars = await loadJSON(carsFile);
    const filtered = cars.filter((c: any) => c.id !== id);

    if (filtered.length === cars.length) {
      res.statusCode = 404;
      res.end(JSON.stringify({ success: false, error: "Car not found" }));
      return;
    }

    await saveJSON(carsFile, filtered);
    res.statusCode = 204;
    res.end();
    return;
  }

  //
  // fallback
  //
  res.statusCode = 404;
  res.end(JSON.stringify({ success: false, error: "Not found" }));
});

server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
