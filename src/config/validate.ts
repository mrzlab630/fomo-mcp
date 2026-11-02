import { z } from "zod/v4";
import type { EndpointField, EndpointMap } from "./types.js";
import { fieldSchema } from "../endpoints/catalog.js";

const text = z.string().min(1);
const name = text.regex(/^[A-Za-z_][A-Za-z0-9_]*$/);
const route = text.refine((value) => value.startsWith("/") && !value.startsWith("//")
  && !/[?#\\\s]/.test(value) && !value.split("/").includes(".."), "Expected an origin-relative API path");
const fieldShape = {
  type: z.enum(["string", "number", "boolean", "array", "object"]),
  format: z.literal("uuid").optional(),
  required: z.boolean().optional(),
  minimum: z.number().optional(),
  maximum: z.number().optional(),
  enum: z.array(text).nonempty().optional(),
  minItems: z.number().int().nonnegative().optional(),
  description: text.optional(),
};
const field: z.ZodType<EndpointField> = z.lazy(() => z.object({
  ...fieldShape,
  items: field.optional(),
  fields: z.record(name, field).optional(),
}).strict());
const param = z.object({
  ...fieldShape,
  items: field.optional(),
  fields: z.record(name, field).optional(),
  name,
  source: z.enum(["path", "query", "body"]),
  required: z.boolean(),
  default: z.unknown().optional(),
  serialize: z.enum(["json", "repeat"]).optional(),
  bodyMode: z.literal("direct").optional(),
  wireName: name.optional(),
  rename: z.record(name, name).optional(),
}).strict();
const endpoint = z.object({
  id: name,
  tool: name.nullable(),
  category: text,
  base: z.enum(["fomo", "mobula", "privy"]),
  method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
  path: route,
  pathOverrides: z.record(text, route).optional(),
  request: z.object({ body: z.enum(["object", "tokenIds"]).optional(), params: z.array(param), atLeastOneOf: z.array(name).nonempty().optional() }).strict(),
  response: z.object({ type: text, description: text }).strict(),
  mcpMetadata: z.object({ scope: z.enum(["single-token", "requested-token-set", "provider-wide-verified-list"]) }).strict().optional(),
  description: text,
  auth: z.enum(["none", "identity", "access"]),
  sideEffect: z.enum(["none", "mutation"]),
  expose: z.boolean(),
  internalOnly: z.boolean().optional(),
}).strict();
const catalog = z.object({
  version: z.number().int().positive(),
  source: z.object({ repository: text, commit: text, status: text, discoveredAt: text.optional(), discoveryUrl: text.optional(), discoveryManifest: text.optional() }).strict(),
  endpoints: z.array(endpoint).nonempty(),
  discoveryCandidates: z.array(endpoint).optional(),
}).strict();

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Invalid endpoint catalog: ${message}`);
}

function validateField(value: EndpointField): void {
  assert(value.minimum === undefined || value.type === "number", "minimum requires number");
  assert(value.maximum === undefined || value.type === "number", "maximum requires number");
  assert(value.minimum === undefined || value.maximum === undefined || value.minimum <= value.maximum, "inverted numeric bounds");
  assert(value.format === undefined || value.type === "string", "format requires string");
  assert(value.enum === undefined || (value.type === "string" && new Set(value.enum).size === value.enum.length && value.enum.every((item) => fieldSchema({ ...value, enum: undefined }).safeParse(item).success)), "invalid enum");
  assert(value.minItems === undefined || value.type === "array", "minItems requires array");
  assert(value.type === "array" ? value.items !== undefined : value.items === undefined, "array items mismatch");
  assert(value.type === "object" ? value.fields !== undefined : value.fields === undefined, "object fields mismatch");
  if (value.items) validateField(value.items);
  for (const child of Object.values(value.fields ?? {})) validateField(child);
}

/** Validates local contracts only; cannot establish remote semantics or authorization. */
export function validateEndpointMap(input: unknown): EndpointMap {
  const map = catalog.parse(input) as EndpointMap;
  const ids = new Set<string>();
  const tools = new Set<string>(["fomo_auth_status", "fomo_auth_start"]);
  const routes = new Set<string>();
  for (const item of [...map.endpoints, ...(map.discoveryCandidates ?? [])]) {
    assert(!ids.has(item.id), `duplicate id ${item.id}`);
    ids.add(item.id);
    const key = `${item.base}:${item.method}:${item.path}`;
    assert(!routes.has(key), `duplicate route ${item.id}`);
    routes.add(key);
    if (item.tool) {
      assert(!tools.has(item.tool), `duplicate or reserved tool ${item.tool}`);
      tools.add(item.tool);
    }
    if (item.expose) assert(item.tool && item.sideEffect === "none" && !item.internalOnly && ["GET", "POST"].includes(item.method), `unsafe exposure ${item.id}`);
    const names = new Set<string>();
    const wireNames = new Set<string>();
    for (const value of item.request.params) {
      validateField(value);
      assert(!names.has(value.name), `duplicate parameter ${item.id}.${value.name}`);
      names.add(value.name);
      const wireKey = `${value.source}:${value.wireName ?? value.name}`;
      assert(!wireNames.has(wireKey), `duplicate wire parameter ${item.id}.${value.name}`);
      wireNames.add(wireKey);
      if (value.default !== undefined) assert(fieldSchema(value).safeParse(value.default).success, `invalid default ${item.id}.${value.name}`);
      if (value.source === "path") assert((value.required || value.default !== undefined) && ["string", "number"].includes(value.type), `invalid path parameter ${item.id}.${value.name}`);
      if (value.source === "body") assert(item.request.body && item.method !== "GET", `body without body contract ${item.id}`);
      if (value.serialize) assert(value.source === "query" && (value.serialize !== "repeat" || (value.type === "array" && value.items?.type !== "object" && value.items?.type !== "array")), `invalid serialization ${item.id}`);
      if (value.source === "query" && ["array", "object"].includes(value.type)) assert(value.serialize, `missing query serialization ${item.id}`);
      if (value.bodyMode) assert(value.source === "body" && item.request.body === "tokenIds" && value.type === "array", `invalid direct body ${item.id}`);
      if (value.rename) {
        assert(value.type === "array" && value.items?.type === "object", `invalid rename ${item.id}`);
        const outputs = Object.keys(value.items.fields ?? {}).map((key) => value.rename?.[key] ?? key);
        assert(Object.keys(value.rename).every((key) => Object.hasOwn(value.items!.fields!, key)) && new Set(outputs).size === outputs.length, `invalid rename targets ${item.id}`);
      }
    }
    for (const value of item.request.atLeastOneOf ?? []) assert(names.has(value), `unknown atLeastOneOf parameter ${item.id}.${value}`);
    for (const selected of [item.path, ...Object.values(item.pathOverrides ?? {})]) {
      const placeholders = [...selected.matchAll(/\{([^{}]+)\}/g)].map((match) => match[1]!);
      assert(!/[{}]/.test(selected.replace(/\{[^{}]+\}/g, "")), `malformed path template ${item.id}`);
      for (const value of placeholders) assert(item.request.params.some((p) => p.name === value && p.source === "path"), `unknown path placeholder ${item.id}.${value}`);
    }
    for (const value of item.request.params.filter((p) => p.source === "path")) assert(item.path.includes(`{${value.name}}`), `unused path parameter ${item.id}.${value.name}`);
    if (item.pathOverrides) {
      const window = item.request.params.find((p) => p.name === "window" && p.source === "path");
      assert(window?.enum && Object.keys(item.pathOverrides).every((key) => window.enum!.includes(key)), `invalid path override ${item.id}`);
    }
    const bodyParams = item.request.params.filter((p) => p.source === "body");
    if (item.request.body) assert(bodyParams.length > 0, `empty body contract ${item.id}`);
    if (item.request.body === "tokenIds") assert(bodyParams.length === 1 && bodyParams[0]?.bodyMode === "direct", `invalid direct body contract ${item.id}`);
  }
  return map;
}
