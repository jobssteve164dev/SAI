import {readFileSync} from "node:fs";
import {createMcpHandler, fromJsonSchema, McpServer, type AuthInfo, type JsonSchemaType} from "@modelcontextprotocol/server";
import type {ActInput} from "../../kernel/src/index.js";
import type {RegionService} from "../../../apps/local-node/src/service.js";

function schema(name: string): JsonSchemaType {
  return JSON.parse(readFileSync(new URL(`../../../spec/sai/0.1.0/${name}.schema.json`, import.meta.url), "utf8")) as JsonSchemaType;
}

const observeInput = fromJsonSchema<Record<string, unknown>>(schema("observe-input"));
const observeOutput = fromJsonSchema<Record<string, unknown>>(schema("observe-output"));
const actInput = fromJsonSchema<ActInput>(schema("act-input"));
const actOutput = fromJsonSchema<Record<string, unknown>>(schema("act-output"));

function requireIdentity(authInfo: AuthInfo | undefined, scope: "observe" | "act"): string {
  const agentId = authInfo?.extra?.agentId;
  if (typeof agentId !== "string") throw new Error("缺少已验证的 Agent 身份");
  if (!authInfo?.scopes.includes(scope)) throw new Error(`缺少 ${scope} scope`);
  return agentId;
}

export function createSaiMcpHandler(service: RegionService) {
  return createMcpHandler((context) => {
    const server = new McpServer({name: "sai-local-node", version: "0.1.0"});
    server.registerTool("sai_observe", {
      title: "观察世界",
      description: "返回当前 Agent 能直接理解的局部状态与合法动作。",
      inputSchema: observeInput,
      outputSchema: observeOutput,
    }, async (input) => {
      const output = await service.observe(requireIdentity(context.authInfo, "observe"), input as {cursor?: string; max_bytes?: number});
      return {content: [{type: "text", text: JSON.stringify(output)}], structuredContent: output as unknown as Record<string, unknown>};
    });
    server.registerTool("sai_act", {
      title: "执行动作",
      description: "执行一次由最近观察返回的合法动作；request_id 保证幂等。",
      inputSchema: actInput,
      outputSchema: actOutput,
    }, async (input) => {
      const output = await service.act(requireIdentity(context.authInfo, "act"), input);
      return {content: [{type: "text", text: JSON.stringify(output)}], structuredContent: output as unknown as Record<string, unknown>};
    });
    return server;
  }, {legacy: "reject", responseMode: "json"});
}
