import { chmod, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadRuntimeConfig } from "./config/load.js";
import { AuthManager, readAuthImport } from "./auth/auth-manager.js";
import { generateMasterKey } from "./auth/encrypted-store.js";

const command = process.argv[2];
const runtime = await loadRuntimeConfig();

if (command === "auth:keygen") {
  console.log(generateMasterKey());
  process.exit(0);
}

const auth = new AuthManager(runtime);
await auth.initialize();

if (command === "auth:status") {
  console.log(JSON.stringify(await auth.status(), null, 2));
  process.exit(0);
}

if (command === "auth:import") {
  const inputPath = process.argv[3];
  if (!inputPath) throw new Error("Usage: npm run auth:import -- path/to/auth-import.json");
  const imported = await readAuthImport(inputPath);
  console.log(JSON.stringify(await auth.importState(imported), null, 2));
  process.exit(0);
}

if (command === "auth:refresh") {
  console.log(JSON.stringify(await auth.refreshSession(), null, 2));
  process.exit(0);
}

if (command === "auth:init-example") {
  const target = path.resolve(process.argv[3] ?? "data/auth-import.example.json");
  await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
  await writeFile(target, `${JSON.stringify({ version: 1, cookies: [] }, null, 2)}\n`, { mode: 0o600 });
  await chmod(target, 0o600);
  console.log(target);
  process.exit(0);
}

throw new Error("Unknown command. Use auth:keygen, auth:status, auth:import, auth:refresh, or auth:init-example");
