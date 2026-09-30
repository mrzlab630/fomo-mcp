import { chmod, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadEndpointMap, loadRuntimeConfig, resolveConfiguredPath, resolveEndpointMapPath } from "./config/load.js";
import { AuthManager, readAuthImport } from "./auth/auth-manager.js";
import { generateMasterKey } from "./auth/encrypted-store.js";
import { applyDiscoveryCandidates, catalogDigest, discoverEndpointMap, readDiscoveryReport, saveEndpointMap, writeDiscoveryReport, writeDiscoverySnapshot } from "./endpoint-discovery.js";

const command = process.argv[2];
const runtime = await loadRuntimeConfig();

if (command === "endpoints:discover" || command === "endpoints:check" || command === "endpoints:refresh") {
  let apply = command === "endpoints:refresh";
  let baselinePath: string | undefined;
  let outputDir = runtime.discovery?.outputDir;
  const flags = process.argv.slice(3);
  for (let index = 0; index < flags.length; index += 1) {
    const flag = flags[index];
    if (flag === "--apply") {
      if (command === "endpoints:check") throw new Error("endpoints:check is always report-only; use endpoints:refresh to apply reviewed candidates");
      if (flags.includes("--report-only")) throw new Error("--apply and --report-only cannot be combined");
      apply = true;
    } else if (flag === "--report-only") apply = false;
    else if (flag === "--baseline" && flags[index + 1] && !flags[index + 1]!.startsWith("--")) baselinePath = flags[++index];
    else if (flag === "--output-dir" && flags[index + 1] && !flags[index + 1]!.startsWith("--")) outputDir = flags[++index];
    else throw new Error("Usage: endpoints:(discover|check|refresh) [--baseline <report.json|latest>] [--apply|--report-only] [--output-dir <test-report-dir>]");
  }
  const endpointMap = await loadEndpointMap();
  const snapshotPath = resolveConfiguredPath(runtime.discovery?.snapshotFile ?? "data/endpoint-discovery.json");
  if (snapshotPath === resolveEndpointMapPath()) throw new Error("Discovery snapshot must not overwrite the endpoint catalog");
  const automaticBaseline = !baselinePath && command !== "endpoints:discover";
  if (automaticBaseline) baselinePath = "latest";
  if (baselinePath === "latest") baselinePath = snapshotPath;
  const baseline = baselinePath ? await readDiscoveryReport(path.resolve(baselinePath)).catch((error: NodeJS.ErrnoException) => {
    if (automaticBaseline && error.code === "ENOENT") return undefined;
    throw error;
  }) : undefined;
  const report = await discoverEndpointMap(runtime, endpointMap, baseline);
  const paths = outputDir ? await writeDiscoveryReport(report, resolveConfiguredPath(outputDir)) : null;
  let applied = false;
  if (apply) {
    const currentMap = await loadEndpointMap();
    if (catalogDigest(currentMap) !== report.catalogDigest) throw new Error("Catalog changed during discovery; rerun before applying");
    const updated = applyDiscoveryCandidates(currentMap, report);
    await saveEndpointMap(updated, resolveEndpointMapPath());
    applied = true;
  }
  await writeDiscoverySnapshot(report, snapshotPath);
  console.log(JSON.stringify({
    status: "complete",
    mode: command === "endpoints:discover" ? "discovery" : command === "endpoints:check" ? "check" : "refresh",
    baseline: baseline ? path.resolve(baselinePath!) : null,
    applyRequested: apply,
    applied,
    candidates: report.candidates.map((item) => item.endpoint.id),
    routeReferences: report.routeReferences,
    unmappedRoutes: report.unmappedRoutes.length,
    catalogOnly: report.catalogOnly.length,
    changes: report.changes,
    snapshot: snapshotPath,
    report: paths,
  }, null, 2));
  process.exit(0);
}

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

throw new Error("Unknown command. Use endpoints:discover, endpoints:check, or endpoints:refresh [--baseline <report.json|latest>] [--apply|--report-only] [--output-dir <test-report-dir>], auth:keygen, auth:status, auth:import, auth:refresh, or auth:init-example");
