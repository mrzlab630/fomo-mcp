import type { AuthMode, HttpMethod } from "../config/types.js";

export interface TransportRequest {
  method: HttpMethod;
  url: string;
  auth: AuthMode;
  body?: unknown;
  retryable: boolean;
}

export interface TransportResponse {
  status: number;
  url: string;
  requestId: string;
  body: string;
  headers: Headers;
  attempts: number;
}

export interface Transport {
  request(request: TransportRequest): Promise<TransportResponse>;
}
