import { chmod, mkdir, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadEndpointMap, loadRuntimeConfig, resolveConfiguredPath, resolveEndpointMapPath } from "./config/load.js";
import { AuthManager, readAuthImport } from "./auth/auth-manager.js";
import { generateMasterKey } from "./auth/encrypted-store.js";
import { applyDiscoveryCandidates, catalogDigest, discoverEndpointMap, readDiscoveryReport, saveEndpointMap, writeDiscoveryReport } from "./endpoint-discovery.js";

const command = process.argv[2];
const runtime = await loadRuntimeConfig();

if (command === "endpoints:discover") {
  let apply = false;
  let baselinePath: string | undefined;
  const flags = process.argv.slice(3);
  for (let index = 0; index < flags.length; index += 1) {
    const flag = flags[index];
    if (flag === "--apply") apply = true;
    else if (flag === "--baseline" && flags[index + 1] && !flags[index + 1]!.startsWith("--")) baselinePath = flags[++index];
    else throw new Error("Usage: endpoints:discover [--baseline <report.json|latest>] [--apply]");
  }
  const endpointMap = await loadEndpointMap();
  const outputDir = runtime.discovery?.outputDir ?? "reports";
  const resolvedOutputDir = resolveConfiguredPath(outputDir);
  if (baselinePath === "latest") {
    const reports = (await readdir(resolvedOutputDir, { withFileTypes: true })).filter((item) => item.isFile() && /^fomo-endpoint-discovery-.*\.json$/.test(item.name)).map((item) => item.name).sort();
    if (reports.length === 0) throw new Error(`No discovery baseline exists in ${resolvedOutputDir}; run endpoints:discover once without --baseline`);
    baselinePath = path.join(resolvedOutputDir, reports.at(-1)!);
  }
  const baseline = baselinePath ? await readDiscoveryReport(path.resolve(baselinePath)) : undefined;
  const report = await discoverEndpointMap(runtime, endpointMap, baseline);
  const paths = await writeDiscoveryReport(report, resolvedOutputDir);
  let applied = false;
  if (apply) {
    const currentMap = await loadEndpointMap();
    if (catalogDigest(currentMap) !== report.catalogDigest) throw new Error("Catalog changed during discovery; rerun before applying");
    const updated = applyDiscoveryCandidates(currentMap, report);
    await saveEndpointMap(updated, resolveEndpointMapPath());
    applied = true;
  }
  console.log(JSON.stringify({
    status: "complete",
    applyRequested: apply,
    applied,
    candidates: report.candidates.map((item) => item.endpoint.id),
    routeReferences: report.routeReferences,
    unmappedRoutes: report.unmappedRoutes.length,
    catalogOnly: report.catalogOnly.length,
    changes: report.changes,
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

throw new Error("Unknown command. Use endpoints:discover [--baseline <report.json|latest>] [--apply], auth:keygen, auth:status, auth:import, auth:refresh, or auth:init-example");
