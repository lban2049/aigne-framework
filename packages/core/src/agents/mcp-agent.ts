import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import {
  StdioClientTransport,
  type StdioServerParameters,
} from "@modelcontextprotocol/sdk/client/stdio.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { CallToolResult, GetPromptResult } from "@modelcontextprotocol/sdk/types";
import {} from "zod";
import { logger } from "../utils/logger";
import { promptFromMCPPrompt, toolFromMCPTool } from "../utils/mcp-utils";
import { createAccessorArray } from "../utils/type-utils";
import { Agent, type AgentInput, type AgentOptions, type AgentOutput } from "./agent";

const MCP_AGENT_CLIENT_NAME = "MCPAgent";
const MCP_AGENT_CLIENT_VERSION = "0.0.1";

const debug = logger.base.extend("mcp");

export interface MCPAgentOptions extends AgentOptions {
  client: Client;

  prompts?: MCPPrompt[];
}

export type MCPServerOptions = SSEServerParameters | StdioServerParameters;

export type SSEServerParameters = {
  url: string;
};

function isSSEServerParameters(
  options: MCPAgentOptions | MCPServerOptions,
): options is SSEServerParameters {
  return "url" in options && typeof options.url === "string";
}

function isStdioServerParameters(
  options: MCPAgentOptions | MCPServerOptions,
): options is StdioServerParameters {
  return "command" in options && typeof options.command === "string";
}

export class MCPAgent extends Agent {
  static from(options: MCPServerOptions): Promise<MCPAgent>;
  static from(options: MCPAgentOptions): MCPAgent;
  static from(options: MCPAgentOptions | MCPServerOptions): MCPAgent | Promise<MCPAgent> {
    if (isSSEServerParameters(options)) {
      const transport = new SSEClientTransport(new URL(options.url));
      return MCPAgent.fromTransport(transport);
    }

    if (isStdioServerParameters(options)) {
      const transport = new StdioClientTransport({ ...options, stderr: "pipe" });
      return MCPAgent.fromTransport(transport);
    }

    return new MCPAgent(options);
  }

  private static async fromTransport(transport: Transport): Promise<MCPAgent> {
    const client = new Client({
      name: MCP_AGENT_CLIENT_NAME,
      version: MCP_AGENT_CLIENT_VERSION,
    });

    await debug.spinner(client.connect(transport), "Connecting to MCP server");

    const mcpServer = getMCPServerName(client);

    const { tools: isToolsAvailable, prompts: isPromptsAvailable } =
      client.getServerCapabilities() ?? {};

    const tools = isToolsAvailable
      ? await debug
          .spinner(client.listTools(), `Listing tools from ${mcpServer}`, ({ tools }) =>
            debug("%O", tools),
          )
          .then(({ tools }) => tools.map((tool) => toolFromMCPTool(client, tool)))
      : undefined;

    const prompts = isPromptsAvailable
      ? await debug
          .spinner(client.listPrompts(), `Listing prompts from ${mcpServer}`, ({ prompts }) =>
            debug("%O", prompts),
          )
          .then(({ prompts }) => prompts.map((prompt) => promptFromMCPPrompt(client, prompt)))
      : undefined;

    return new MCPAgent({ client, tools, prompts });
  }

  constructor(options: MCPAgentOptions) {
    super(options);

    this.client = options.client;
    if (options.prompts?.length) this.prompts.push(...options.prompts);
  }

  private client: Client;

  readonly prompts = createAccessorArray<MCPPrompt>([], (arr, name) =>
    arr.find((i) => i.name === name),
  );

  override async shutdown() {
    super.shutdown();
    await this.client.close();
  }
}

export interface MCPToolBaseOptions<I extends AgentInput, O extends AgentOutput>
  extends AgentOptions<I, O> {
  client: Client;
}

export abstract class MCPBase<I extends AgentInput, O extends AgentOutput> extends Agent<I, O> {
  constructor(options: MCPToolBaseOptions<I, O>) {
    super(options);
    this.client = options.client;
  }

  protected client: Client;

  protected get mcpServer() {
    return getMCPServerName(this.client);
  }
}

export class MCPTool extends MCPBase<AgentInput, CallToolResult> {
  async process(input: AgentInput): Promise<CallToolResult> {
    const result = await debug.spinner(
      this.client.callTool({ name: this.name, arguments: input }),
      `Call tool ${this.name} from ${this.mcpServer}`,
      (output) => debug("input: %O\noutput: %O", input, output),
    );

    return result as CallToolResult;
  }
}

export class MCPPrompt extends MCPBase<{ [key: string]: string }, GetPromptResult> {
  async process(input: AgentInput): Promise<GetPromptResult> {
    const result = await debug.spinner(
      this.client.getPrompt({ name: this.name, arguments: input as Record<string, string> }),
      `Get prompt ${this.name} from ${this.mcpServer}`,
      (output) => debug("input: %O\noutput: %O", input, output),
    );

    return result as GetPromptResult;
  }
}

function getMCPServerName(client: Client): string | undefined {
  const info = client.getServerVersion();
  if (!info) return undefined;

  const { name, version } = info;
  return `${name}@${version}`;
}
