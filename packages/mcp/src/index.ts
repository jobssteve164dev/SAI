import {createMcpHandler, fromJsonSchema, McpServer, type AuthInfo, type JsonSchemaType} from "@modelcontextprotocol/server";
import type {ActInput} from "../../kernel/src/index.js";
import type {ActResult, Observation} from "../../kernel/src/index.js";
import observeInputJson from "../../../spec/sai/0.1.0/observe-input.schema.json" with {type: "json"};
import observeOutputJson from "../../../spec/sai/0.1.0/observe-output.schema.json" with {type: "json"};
import actInputJson from "../../../spec/sai/0.1.0/act-input.schema.json" with {type: "json"};
import actOutputJson from "../../../spec/sai/0.1.0/act-output.schema.json" with {type: "json"};
import type {AgentMemoryInput, AgentMemoryResult} from "../../memory/src/index.js";
import type {ConformanceEvent} from "../../kernel/src/index.js";

export interface SaiRegionApplication {
  observe(agentId: string, input?: {cursor?: string; max_bytes?: number}): Promise<Observation>;
  act(agentId: string, input: ActInput): Promise<ActResult>;
  memory(agentId: string, input: AgentMemoryInput): Promise<AgentMemoryResult>;
  activity(agentId: string, input?: {cursor?: string; limit?: number}): Promise<{protocol: "proofwild-agent-activity/1"; world_fork_id: string; events: ConformanceEvent[]; next_cursor: string | null}>;
}

const observeInput = fromJsonSchema<Record<string, unknown>>(observeInputJson as JsonSchemaType);
const observeOutput = fromJsonSchema<Record<string, unknown>>(observeOutputJson as JsonSchemaType);
const actInput = fromJsonSchema<ActInput>(actInputJson as JsonSchemaType);
const actOutput = fromJsonSchema<Record<string, unknown>>(actOutputJson as JsonSchemaType);
const memoryInput = fromJsonSchema<AgentMemoryInput>({type: "object", required: ["operation"], properties: {operation: {enum: ["list", "remember", "refresh", "forget", "rotate"]}, request_id: {type: "string", pattern: "^[A-Za-z0-9._:-]{1,160}$"}, memory_id: {type: "string", pattern: "^memo:sha256:[0-9a-f]{64}$"}, content: {type: "string", minLength: 1, maxLength: 2000}}, additionalProperties: false} as JsonSchemaType);
const activityInput = fromJsonSchema<{cursor?: string; limit?: number}>({type: "object", properties: {cursor: {type: "string", pattern: "^before:[1-9][0-9]*$"}, limit: {type: "integer", minimum: 1, maximum: 100}}, additionalProperties: false} as JsonSchemaType);

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
    server.registerTool("sai_memory", {
      title: "管理自己的世界备忘录",
      description: "列出、新增、刷新、删除或明确轮换当前 Agent 在此世界分叉中的私有备忘录；上限 50 条，满额时不会静默淘汰。",
      inputSchema: memoryInput,
    }, async (input) => {
      const scope = input.operation === "list" ? "observe" : "act";
      const output = await service.memory(requireIdentity(context.authInfo, scope), input);
      return {content: [{type: "text", text: JSON.stringify(output)}], structuredContent: output as unknown as Record<string, unknown>};
    });
    server.registerTool("sai_activity", {
      title: "读取自己的世界活动历史",
      description: "按时间倒序分页读取当前 Agent 在此世界分叉中的不可修改已结算事件。",
      inputSchema: activityInput,
    }, async (input) => {
      const output = await service.activity(requireIdentity(context.authInfo, "observe"), input);
      return {content: [{type: "text", text: JSON.stringify(output)}], structuredContent: output as unknown as Record<string, unknown>};
    });
    return server;
  }, {legacy: "reject", responseMode: "json"});
}
