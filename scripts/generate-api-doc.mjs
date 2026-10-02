import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const runtimePath = process.env.FOMO_MCP_RUNTIME_CONFIG ? path.resolve(process.env.FOMO_MCP_RUNTIME_CONFIG) : path.join(root, "config", "runtime.json");
const catalogPath = process.env.FOMO_MCP_ENDPOINTS_CONFIG ? path.resolve(process.env.FOMO_MCP_ENDPOINTS_CONFIG) : path.join(path.dirname(runtimePath), "endpoints.json");
const outputPath = path.join(root, "docs", "API.md");
const catalog = JSON.parse(await readFile(catalogPath, "utf8"));
const runtime = JSON.parse(await readFile(runtimePath, "utf8"));

function cell(value) {
  return String(value).replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function isExposed(endpoint) {
  return endpoint.expose && endpoint.sideEffect === "none" && !endpoint.internalOnly && Boolean(endpoint.tool);
}

function fieldText(field) {
  if (!field) return "unknown";
  let result = field.type;
  if (field.type === "array" && field.items) result += `<${fieldText(field.items)}>`;
  if (field.type === "object" && field.fields) {
    const children = Object.entries(field.fields).map(([name, child]) => `${name}${child.required === false ? "?" : ""}: ${fieldText(child)}`);
    result += ` { ${children.join(", ")} }`;
  }
  if (field.minimum !== undefined) result += ` >= ${field.minimum}`;
  if (field.maximum !== undefined) result += ` <= ${field.maximum}`;
  if (field.format) result += ` (${field.format})`;
  return result;
}

function parameterRows(endpoint) {
  return endpoint.request.params.length === 0
    ? ["| No parameters | - | - | - | - | - |"]
    : endpoint.request.params.map((parameter) => {
      const location = parameter.source;
      const wire = parameter.wireName && parameter.wireName !== parameter.name ? `\`${parameter.wireName}\`` : "same";
      const defaultValue = parameter.default === undefined ? "none" : `\`${JSON.stringify(parameter.default)}\``;
      const details = [parameter.description, parameter.serialize ? `Serialization: ${parameter.serialize}.` : undefined, parameter.bodyMode === "direct" ? "Sent as the complete request body." : undefined, parameter.rename ? `Nested wire renames: ${JSON.stringify(parameter.rename)}.` : undefined].filter(Boolean).join(" ");
      return `| \`${parameter.name}\` | ${location} | \`${cell(fieldText(parameter))}\` | ${parameter.required ? "yes" : "no"} | ${wire} | ${cell(`${defaultValue}${details ? `; ${details}` : ""}`)} |`;
    });
}

function sampleValue(field, name) {
  if (field.default !== undefined) return field.default;
  if (field.format === "uuid") return "00000000-0000-4000-8000-000000000001";
  if (field.type === "number") return name === "networkId" ? 1399811149 : name === "from" ? 1790121600 : name === "to" ? 1790726400 : name === "afterTime" ? 1790121600000 : field.minimum ?? 1;
  if (field.type === "boolean") return false;
  if (field.type === "array") return [sampleValue(field.items ?? { type: "string" }, name)];
  if (field.type === "object") return Object.fromEntries(Object.entries(field.fields ?? {}).filter(([, child]) => child.required !== false).map(([key, child]) => [key, sampleValue(child, key)]));
  if (["tokenId", "tokenIds", "symbol"].includes(name)) return "<tokenAddress>:1399811149";
  return name === "chain" ? "solana" : name === "resolution" ? "60" : `<${name}>`;
}

function endpointSection(endpoint) {
  const state = isExposed(endpoint) ? "exposed read-only" : "catalog reference / disabled";
  const tool = isExposed(endpoint) ? `\`${endpoint.tool}\`` : `not registered${endpoint.tool ? ` (reference name: \`${endpoint.tool}\`)` : ""}`;
  const body = endpoint.request.body ? `; body mode: \`${endpoint.request.body}\`` : "";
  const exampleFields = endpoint.request.params.filter((parameter) => parameter.required || parameter.default !== undefined || parameter.name === endpoint.request.atLeastOneOf?.[0]);
  const example = Object.fromEntries(exampleFields.map((parameter) => [parameter.name, sampleValue(parameter, parameter.name)]));
  return [
    `### ${endpoint.id}`,
    "",
    `- MCP tool: ${tool}`,
    `- State: **${state}**`,
    `- Upstream: \`${endpoint.method} ${runtime.apiBases[endpoint.base]}${endpoint.path}\` (base: \`${endpoint.base}\`; auth: \`${endpoint.auth}\`)${body}`,
    ...(endpoint.pathOverrides ? [`- Path overrides: ${Object.entries(endpoint.pathOverrides).map(([key, value]) => `\`${key}\` uses \`${value}\``).join("; ")}.`] : []),
    `- Description: ${endpoint.description}`,
    `- Response: \`${endpoint.response.type}\`: ${endpoint.response.description}`,
    ...(endpoint.mcpMetadata ? [`- MCP-generated interpretation (not an upstream field): scope = \`${endpoint.mcpMetadata.scope}\`.`] : []),
    ...(endpoint.request.atLeastOneOf?.length ? [`- Validation: provide at least one non-empty value from ${endpoint.request.atLeastOneOf.map((name) => `\`${name}\``).join(", ")}.`] : []),
    "",
    "| Input | Location | Type | Required | Wire name | Default / description |",
    "| --- | --- | --- | --- | --- | --- |",
    ...parameterRows(endpoint),
    "",
    ...(isExposed(endpoint) ? ["MCP arguments (replace placeholders with authorized ids/addresses and documented feed types):", "", "```json", JSON.stringify(example, null, 2), "```", ""] : []),
  ].join("\n");
}

const categories = new Map();
for (const endpoint of catalog.endpoints) {
  const list = categories.get(endpoint.category) ?? [];
  list.push(endpoint);
  categories.set(endpoint.category, list);
}

const lines = [
  "# API and MCP tools",
  "",
  "> Generated from `config/endpoints.json` by `npm run docs:api`. Keep the catalog as the source of truth; edit this file only through the generator.",
  "",
  `- Catalog version: \`${catalog.version}\``,
  `- Records: **${catalog.endpoints.length}**`,
  `- Exposed read-only records: **${catalog.endpoints.filter(isExposed).length}**`,
  `- Disabled/internal references: **${catalog.endpoints.filter((endpoint) => !isExposed(endpoint)).length}**`,
  `- Source status: ${catalog.source.status}`,
  ...(catalog.source.discoveryUrl ? [`- Production evidence: ${catalog.source.discoveryUrl}; manifest \`${catalog.source.discoveryManifest}\`; collected ${catalog.source.discoveredAt}.`] : []),
  "",
  "## Contract and usage",
  "",
  "Every registered data tool accepts top-level fields shown below and returns `{ data, meta }`. `data` is the upstream payload after only envelope unwrapping; MCP does not normalize or invent its business fields. `meta` is MCP-generated and includes the catalog id, source base, HTTP status, request id, retry attempts, fetch time, response type, provenance, scope and freshness metadata. `meta.provenance.data` identifies the payload as upstream, while `meta.provenance.metadata` identifies the envelope as MCP-generated. `meta.scope` comes from the MCP catalog. `meta.freshness` uses provider date headers when available and otherwise reports only the MCP observation time. Parameter names are the MCP names; the adapter applies path encoding, query serialization, body construction, and wire-name conversions.",
  "",
  "The catalog contains private, reverse-engineered routes. A route appearing here is not proof that it is stable or authorized for every account. Live readiness requires the non-expired token selected by each endpoint's auth field, followed by a successful read-only request. Enabled FOMO routes and Mobula OHLCV use the identity token; Privy session operations use the access/refresh pair internally.",
  "",
  "The catalog is the single endpoint map: every record, including disabled and internal references, is listed in this document. A route is not marked deprecated merely because the current frontend bundle does not reference it; `catalogOnly` discovery results require a reviewed source contract or an authorized probe before deprecation. `fomo_trading_activity` is active upstream but may return stale events, which is a freshness limitation rather than a deprecated route.",
  "",
  "Response type names describe observed payload purposes, not validated upstream JSON schemas. Only the envelope is checked by the adapter. Do not assume undocumented response fields. Time units are specified per parameter; chart bars use Unix seconds, while sorted thesis and Mobula OHLCV use Unix milliseconds.",
  "",
  "FOMO tokenIds, tokenId and chart symbol values use `<tokenAddress>:<numeric networkId>`, such as `<tokenAddress>:1399811149` for Solana. Obtain both parts from a token response. The Mobula OHLCV chain query is a separate provider identifier (`solana` or `evm:<chain id>`); do not use it as the prefix of a FOMO token id. Batch user lookups use GET `/v2/users` with repeated userIds query fields; POST on that path is account registration and is not exposed.",
  "",
  "The adapter returns each FOMO page as received, including cursors, pinned records, and provider timestamps. It does not automatically paginate, filter by time, reconcile token identities, normalize metrics, or classify sentiment. Users and agents decide how to use the data; any subsequent analysis must be labelled as derived. When explicitly collecting more pages, use the final item or cursor provided by the actual response and stop when the page is empty or the cursor repeats.",
  "",
  "For the normal request and reauthorization sequence, read [AI agent workflow](AGENT_WORKFLOW.md). Two additional auth tools are registered outside the endpoint catalog: `fomo_auth_status` accepts `{}` and returns secret-free metadata plus `ready`/`nextAction`; `fomo_auth_start` accepts `{}` and starts the visible headed browser flow when the local daemon is available, returning its secret-free status plus the local authorization URL and polling contract. Data tools also start this flow automatically when an identity session expires. Neither auth tool returns credentials.",
  "",
  "## Endpoint index",
  "",
  "| Catalog id | Method | Route | State |",
  "| --- | --- | --- | --- |",
  ...catalog.endpoints.map((endpoint) => `| [${endpoint.id}](#${endpoint.id}) | ${endpoint.method} | \`${endpoint.path}\` | ${isExposed(endpoint) ? "exposed" : "disabled/internal"} |`),
  "",
  "## Disabled and internal records",
  "",
  "These records are retained for reference and are not registered as MCP data tools. Their exclusions are independent of authentication expiry and are not evidence that the upstream routes have been removed. Privy refresh remains available internally to AuthManager.",
  "",
  "| Catalog id | Reason for exclusion |",
  "| --- | --- |",
  ...catalog.endpoints.filter((endpoint) => !isExposed(endpoint)).map((endpoint) => `| [${endpoint.id}](#${endpoint.id}) | ${cell(endpoint.description)} |`),
  "",
  "## Endpoint reference",
  "",
];
for (const [category, endpoints] of categories) {
  lines.push(`## ${category}`, "");
  for (const endpoint of endpoints) lines.push(endpointSection(endpoint));
}

lines.push(
  "## Local daemon routes",
  "",
  "These routes are local control-plane routes on `127.0.0.1:8387`; they are not upstream MCP data tools.",
  "",
  "| Method | Route | Purpose |",
  "| --- | --- | --- |",
  "| GET | `/healthz` | Process liveness. |",
  "| GET | `/readyz` | Readiness; returns 503 when identity auth is unavailable or expired. |",
  "| GET | `/config/status` | Catalog counts and source metadata. |",
  "| GET | `/auth/status` | Secret-free auth metadata. |",
  "| GET | `/auth/form` | Local interactive authorization form. |",
  "| GET | `/auth/start` | Returns the local authorization URL. |",
  "| POST | `/auth/oauth/start` | Starts manual OAuth flow. |",
  "| GET | `/auth/oauth/:id` | Reads manual OAuth flow status. |",
  "| GET | `/auth/oauth/:id/open` | Redirects to the generated authorization URL. |",
  "| POST | `/auth/oauth/:id/complete` | Completes a state/PKCE-checked callback. |",
  "| POST | `/auth/session/start` | Starts the dedicated headed browser flow. |",
  "| GET | `/auth/session/:id` | Reads browser flow status. |",
  "| POST | `/auth/session/:id/open` | Opens the observed authorization URL in the auth browser. |",
  "| POST | `/auth/session/:id/redirect` | Submits a validated callback URL to the browser flow. |",
  "",
  "## Endpoint discovery and refresh",
  "",
  "Run `npm run endpoints:discover` to fetch the current public FOMO HTML/manifest/JavaScript graph and store one machine-readable snapshot at ignored `data/endpoint-discovery.json`. It does not create a reports directory unless `--output-dir reports` is supplied for a disposable test/export run. The default run never edits the catalog or starts a browser. Manual aliases are available: `npm run endpoints:check` compares with the snapshot and stays report-only; `npm run endpoints:refresh` compares and applies only reviewed `discoveryCandidates`; add `--report-only` to keep refresh non-mutating. Both aliases create an initial snapshot when none exists. The parser uses the installed TypeScript dependency without executing application JavaScript, so maintenance requires a full development install (`npm ci`), not an install that omits development dependencies.",
  "",
  "Use `npm run endpoints:discover -- --baseline latest` to compare against the saved snapshot, or pass an explicit snapshot JSON path. An optional `--output-dir <test-report-dir>` writes a Markdown/JSON export for review. Snapshots and exports include added/removed route references, changed SHA-256 evidence, unknown routes, catalog records not observed, and current asset URLs. A changed asset is a prompt to review its contract; no automatic parameter inference is performed.",
  "",
  "After review, put approved complete endpoint records in the optional top-level `discoveryCandidates` array of `config/endpoints.json`. Run `npm run endpoints:refresh` (or `npm run endpoints:discover -- --apply`) to promote only those records with current route evidence. It rejects side effects, internal records, conflicts, and catalog edits made during the network run; writes atomically; increments the version only for additions; and updates discovery provenance. Existing contracts are edited directly in `endpoints`, and unseen records are never automatically removed or enabled. Run a single apply process at a time.",
  "",
  "After any catalog edit/apply, run `npm run docs:api` and `npm run build`, review the diff, and perform an authorized read-only probe when authentication is ready. Restart affected MCP hosts/daemon to load new catalog schemas; processes load the catalog at startup. The periodic agent procedure is in [AI agent workflow](AGENT_WORKFLOW.md#endpoint-maintenance-run).",
  "",
  "## Evidence limits",
  "",
  "Static frontend discovery is not an official OpenAPI document. It cannot prove response schemas, permissions, freshness, or stability. Authenticated endpoint probes with recorded HTTP status and request id remain required before relying on a newly discovered route in production collection.",
  "",
);

await writeFile(outputPath, lines.join("\n"), "utf8");
console.log(JSON.stringify({ output: outputPath, records: catalog.endpoints.length }));
