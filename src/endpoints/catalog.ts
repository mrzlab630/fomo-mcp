import { z } from "zod/v4";
import type { EndpointConfig, EndpointParam } from "../config/types.js";
import { EndpointNotAllowedError } from "../errors.js";

function fieldSchema(field: EndpointParam | NonNullable<EndpointParam["items"]>): z.ZodType {
  switch (field.type) {
    case "string": return field.format === "uuid" ? z.uuid() : z.string();
    case "number": {
      let schema = z.number();
      if (field.minimum !== undefined) schema = schema.min(field.minimum);
      if (field.maximum !== undefined) schema = schema.max(field.maximum);
      return schema;
    }
    case "boolean": return z.boolean();
    case "array": return z.array(field.items ? fieldSchema(field.items) : z.unknown());
    case "object": {
      const shape: Record<string, z.ZodType> = {};
      for (const [name, child] of Object.entries(field.fields ?? {})) {
        const childSchema = fieldSchema(child);
        shape[name] = child.required === false ? childSchema.optional() : childSchema;
      }
      return z.object(shape);
    }
    default: return z.unknown();
  }
}

export function inputSchema(endpoint: EndpointConfig): Record<string, z.ZodType> {
  const shape: Record<string, z.ZodType> = {};
  for (const parameter of endpoint.request.params) {
    let schema = fieldSchema(parameter);
    if (parameter.default !== undefined) schema = schema.default(parameter.default);
    else if (!parameter.required) schema = schema.optional();
    shape[parameter.name] = schema.describe(parameter.description ?? parameter.name);
  }
  return shape;
}

export function exposedEndpoints(
  endpoints: EndpointConfig[],
  includeMutationTools: boolean,
  includeInternalEndpoints: boolean,
): EndpointConfig[] {
  return endpoints.filter((endpoint) => {
    if (!endpoint.expose) return false;
    if (endpoint.internalOnly && !includeInternalEndpoints) return false;
    if (endpoint.sideEffect === "mutation" && !includeMutationTools) return false;
    return Boolean(endpoint.tool);
  });
}

function wireValue(value: unknown, parameter: EndpointParam): unknown {
  if (parameter.rename && Array.isArray(value)) {
    return value.map((entry) => {
      if (!entry || typeof entry !== "object") return entry;
      const source = entry as Record<string, unknown>;
      const renamed: Record<string, unknown> = { ...source };
      for (const [from, to] of Object.entries(parameter.rename ?? {})) {
        if (source[from] !== undefined) {
          renamed[to] = source[from];
          delete renamed[from];
        }
      }
      return renamed;
    });
  }
  return value;
}

function applyPath(endpoint: EndpointConfig, args: Record<string, unknown>): string {
  const overrideKey = endpoint.path.includes("{window}") ? String(args.window ?? "24h") : undefined;
  const selectedPath = overrideKey && endpoint.pathOverrides?.[overrideKey]
    ? endpoint.pathOverrides[overrideKey]
    : endpoint.path;
  return selectedPath.replace(/\{([^}]+)\}/g, (_, key: string) => {
    const value = args[key];
    if (value === undefined || value === null || value === "") throw new Error(`Missing path parameter: ${key}`);
    return encodeURIComponent(String(value));
  });
}

export interface BuiltRequest {
  path: string;
  query: Record<string, string | number | boolean | string[] | undefined>;
  body?: unknown;
}

export function buildRequest(endpoint: EndpointConfig, args: Record<string, unknown>): BuiltRequest {
  if (endpoint.request.atLeastOneOf?.length && !endpoint.request.atLeastOneOf.some((name) => {
    const value = args[name] ?? endpoint.request.params.find((parameter) => parameter.name === name)?.default;
    return typeof value === "string" ? value.trim().length > 0 : value !== undefined && value !== null;
  })) {
    throw new Error(`Provide at least one non-empty parameter: ${endpoint.request.atLeastOneOf.join(", ")}`);
  }
  const path = applyPath(endpoint, args);
  const query: Record<string, string | number | boolean | string[] | undefined> = {};
  const bodyFields: Record<string, unknown> = {};
  let directBody: unknown;
  for (const parameter of endpoint.request.params) {
    const value = args[parameter.name] ?? parameter.default;
    if (value === undefined) {
      if (parameter.required) throw new Error(`Missing required parameter: ${parameter.name}`);
      continue;
    }
    if (parameter.format === "uuid" && !z.uuid().safeParse(value).success) {
      throw new Error(`Parameter ${parameter.name} must be a FOMO user UUID, not a wallet address or handle`);
    }
    const wireName = parameter.wireName ?? parameter.name;
    if (parameter.source === "path") continue;
    if (parameter.source === "body") {
      if (parameter.bodyMode === "direct") directBody = wireValue(value, parameter);
      else bodyFields[wireName] = wireValue(value, parameter);
      continue;
    }
    if (Array.isArray(value) && parameter.serialize === "repeat") query[wireName] = value.map(String);
    else if (parameter.serialize === "json") query[wireName] = JSON.stringify(wireValue(value, parameter));
    else query[wireName] = value as string | number | boolean;
  }
  return { path, query, ...(endpoint.request.body ? { body: endpoint.request.body === "tokenIds" ? directBody : bodyFields } : {}) };
}

export function assertReadOnly(endpoint: EndpointConfig): void {
  if (endpoint.sideEffect !== "none") {
    throw new EndpointNotAllowedError(`Endpoint ${endpoint.id} is disabled because it has side effects`);
  }
}
