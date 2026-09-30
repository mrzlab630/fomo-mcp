export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
export type EndpointBase = "fomo" | "mobula" | "privy";
export type AuthMode = "none" | "identity" | "access";
export type SideEffect = "none" | "mutation";
export type ParamSource = "path" | "query" | "body";
export type ParamType = "string" | "number" | "boolean" | "array" | "object";

export interface EndpointField {
  type: ParamType;
  required?: boolean;
  minimum?: number;
  maximum?: number;
  items?: EndpointField;
  fields?: Record<string, EndpointField>;
  description?: string;
}

export interface EndpointParam extends EndpointField {
  name: string;
  input?: string;
  source: ParamSource;
  required: boolean;
  default?: unknown;
  serialize?: "json" | "repeat";
  bodyMode?: "direct";
  wireName?: string;
  rename?: Record<string, string>;
}

export interface EndpointRequest {
  body?: "object" | "tokenIds";
  params: EndpointParam[];
  atLeastOneOf?: string[];
}

export interface EndpointResponse {
  type: string;
  description: string;
}

export interface EndpointConfig {
  id: string;
  tool: string | null;
  category: string;
  base: EndpointBase;
  method: HttpMethod;
  path: string;
  pathOverrides?: Record<string, string>;
  request: EndpointRequest;
  response: EndpointResponse;
  description: string;
  auth: AuthMode;
  sideEffect: SideEffect;
  expose: boolean;
  internalOnly?: boolean;
}

export interface EndpointMap {
  version: number;
  source: {
    repository: string;
    commit: string;
    status: string;
    discoveredAt?: string;
    discoveryUrl?: string;
    discoveryManifest?: string;
  };
  endpoints: EndpointConfig[];
  discoveryCandidates?: EndpointConfig[];
}

export interface EndpointDiscoveryConfig {
  sourceUrl: string;
  snapshotFile?: string;
  outputDir?: string;
  maxAssets: number;
  maxAssetBytes: number;
  maxTotalBytes: number;
  concurrency: number;
}

export interface RuntimeConfig {
  appName: string;
  environment: string;
  apiBases: Record<EndpointBase, string>;
  http: {
    requestTimeoutMs: number;
    maxResponseBytes: number;
    maxRetries: number;
    retryBaseDelayMs: number;
    respectRetryAfter: boolean;
    origin: string;
    referer: string;
    userAgent: string;
  };
  transport: {
    mode: "direct" | "hybrid";
    browser?: {
      headed: boolean;
      appMode?: boolean;
      /** Start the API browser without creating an initial foreground window. */
      avoidFocus?: boolean;
      startMinimized?: boolean;
      windowWidth?: number;
      windowHeight?: number;
      windowPositionX?: number;
      windowPositionY?: number;
      executablePath?: string;
      origin?: string;
    };
  };
  auth: {
    stateFile: string;
    masterKeyEnv: string;
    allowEnvironmentTokens: boolean;
    persistEnvironmentTokens: boolean;
    privyAppId: string;
    privyClientId: string;
    privyClient: string;
    browserLoginTimeoutMs: number;
    browserLoginHeaded: boolean;
    browserProfileDir: string;
  };
  mcp: {
    name: string;
    version: string;
    includeMutationTools: boolean;
    includeInternalEndpoints: boolean;
  };
  daemon: {
    healthHost: string;
    healthPort: number;
    heartbeatIntervalMs: number;
    collectorEnabled: boolean;
  };
  discovery?: EndpointDiscoveryConfig;
}

export interface StoredCookie {
  name: string;
  value: string;
  domain?: string;
  path?: string;
  expiresAt?: number;
  secure?: boolean;
  httpOnly?: boolean;
  sameSite?: "strict" | "lax" | "none";
}

export interface AuthState {
  version: 1;
  source: "manual-import" | "browser-login" | "environment" | "encrypted-file";
  idToken?: string;
  accessToken?: string;
  refreshToken?: string;
  caId?: string;
  cookies: StoredCookie[];
  updatedAt: string;
  accessTokenExpiresAt?: string;
  refreshTokenExpiresAt?: string;
  identityTokenExpiresAt?: string;
}

export interface AuthStatus {
  available: boolean;
  source: AuthState["source"] | "none";
  hasIdentityToken: boolean;
  hasAccessToken: boolean;
  hasRefreshToken: boolean;
  cookieCount: number;
  updatedAt?: string;
  accessTokenExpiresAt?: string;
  refreshTokenExpiresAt?: string;
  identityTokenExpiresAt?: string;
  reauthRequired: boolean;
}
