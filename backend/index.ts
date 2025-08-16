import { createServer } from "http";
import { readFile } from "fs/promises";
import { join } from "path";

const PORT = 4000;

const server = createServer(async (req, res) => {
  res.setHeader("Content-Type", "application/json");

  // GET /users
  if (req.url === "/users" && req.method === "GET") {
    try {
      const users = await readFile(join("db", "users.json"), "utf-8");
      res.end(users);
    } catch (err) {
      res.statusCode = 500;
      res.end(JSON.stringify({ error: "Failed to read users" }));
    }
    return;
  }

  // fallback 404
  res.statusCode = 404;
  res.end(JSON.stringify({ error: "Not found" }));
});

server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
