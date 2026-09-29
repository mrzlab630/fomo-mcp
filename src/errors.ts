export class AuthRequiredError extends Error {
  constructor(message = "Authentication state is not available") {
    super(message);
    this.name = "AuthRequiredError";
  }
}

export class ReauthRequiredError extends Error {
  constructor(message = "Identity token is expired; interactive re-authentication is required") {
    super(message);
    this.name = "ReauthRequiredError";
  }
}

export class EndpointNotAllowedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EndpointNotAllowedError";
  }
}

export class TransportError extends Error {
  readonly status?: number;
  readonly requestId?: string;

  constructor(message: string, options: { status?: number; requestId?: string } = {}) {
    super(message);
    this.name = "TransportError";
    this.status = options.status;
    this.requestId = options.requestId;
  }
}

export class UpstreamResponseError extends TransportError {
  constructor(message: string, options: { status?: number; requestId?: string } = {}) {
    super(message, options);
    this.name = "UpstreamResponseError";
  }
}
