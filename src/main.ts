import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { loadEndpointMap, loadRuntimeConfig } from "./config/load.js";
import { createMcpServer } from "./mcp/server.js";

const runtime = await loadRuntimeConfig();
const endpointMap = await loadEndpointMap();
const server = await createMcpServer(runtime, endpointMap);
await server.connect(new StdioServerTransport());
