// DB INTERACTION

import { readFile, writeFile } from "fs/promises";

export async function readJSON<T>(path: string): Promise<T> {
  const data = await readFile(path, "utf-8");
  return JSON.parse(data);
}

export async function writeJSON<T>(path: string, data: T): Promise<void> {
  await writeFile(path, JSON.stringify(data, null, 2), "utf-8");
}
