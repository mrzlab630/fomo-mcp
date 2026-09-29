import type { RuntimeConfig } from "../config/types.js";
import { AuthManager } from "../auth/auth-manager.js";
import type { Transport, TransportRequest, TransportResponse } from "./transport.js";
import { FetchTransport } from "./fetch-transport.js";
import { BrowserTransport } from "./browser-transport.js";

export class HybridTransport implements Transport {
  private readonly direct: FetchTransport;
  private readonly browser: BrowserTransport;
  private readonly browserHost: string;

  constructor(private readonly runtime: RuntimeConfig, auth: AuthManager) {
    this.direct = new FetchTransport(runtime, auth);
    this.browser = new BrowserTransport(runtime, auth);
    this.browserHost = new URL(runtime.apiBases.fomo).host;
  }

  request(request: TransportRequest): Promise<TransportResponse> {
    return new URL(request.url).host === this.browserHost
      ? this.browser.request(request)
      : this.direct.request(request);
  }

  async close(): Promise<void> {
    await this.browser.close();
  }
}
