import {createMcpHandler, fromJsonSchema, McpServer, type AuthInfo, type JsonSchemaType} from "@modelcontextprotocol/server";
import type {ActInput} from "../../kernel/src/index.js";
import type {ActResult, Observation} from "../../kernel/src/index.js";
import observeInputJson from "../../../spec/sai/0.1.0/observe-input.schema.json" with {type: "json"};
import observeOutputJson from "../../../spec/sai/0.1.0/observe-output.schema.json" with {type: "json"};
import actInputJson from "../../../spec/sai/0.1.0/act-input.schema.json" with {type: "json"};
import actOutputJson from "../../../spec/sai/0.1.0/act-output.schema.json" with {type: "json"};

export interface SaiRegionApplication {
  observe(agentId: string, input?: {cursor?: string; max_bytes?: number}): Promise<Observation>;
  act(agentId: string, input: ActInput): Promise<ActResult>;
}

const observeInput = fromJsonSchema<Record<string, unknown>>(observeInputJson as JsonSchemaType);
const observeOutput = fromJsonSchema<Record<string, unknown>>(observeOutputJson as JsonSchemaType);
const actInput = fromJsonSchema<ActInput>(actInputJson as JsonSchemaType);
const actOutput = fromJsonSchema<Record<string, unknown>>(actOutputJson as JsonSchemaType);

function requireIdentity(authInfo: AuthInfo | undefined, scope: "observe" | "act"): string {
  const agentId = authInfo?.extra?.agentId;
  if (typeof agentId !== "string") throw new Error("缺少已验证的 Agent 身份");
  if (!authInfo?.scopes.includes(scope)) throw new Error(`缺少 ${scope} scope`);
  return agentId;
}

export function createSaiMcpHandler(service: SaiRegionApplication) {
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
