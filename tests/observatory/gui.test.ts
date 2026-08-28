import {describe, expect, it} from "vitest";
import {buildObservation, createWorld, stateHash, transition, type AgentState, type ConformanceEvent} from "../../packages/kernel/src/index.js";
import {createObserverSnapshot, OBSERVATORY_SCRIPT, observatoryResponse, renderObservatoryPage} from "../../apps/cloudflare-worker/src/observatory.js";

const agents: AgentState[] = [
  {id: "agent:ed25519-v1:zeta", x: 2, y: 2, energy: 5, inventory: {}},
  {id: "agent:ed25519-v1:alpha", x: 1, y: 1, energy: 4, inventory: {ore: 1}},
];

describe("SAI 世界观察器", () => {
  it("根页面提供可访问的只读观察界面且最终内联脚本语法有效", async () => {
    const page = renderObservatoryPage();
    expect(page).toContain("<title>SAI 世界观察器</title>");
    expect(page).toContain('<link rel="icon" href="/favicon.svg?v=20260827-2" type="image/svg+xml" sizes="any">');
    expect(page).toContain('class="brand-mark"');
    expect(page).toContain('id="world-map"');
    expect(page).toContain('id="event-list"');
    expect(page).toContain('id="inspector-body"');
    expect(page).toContain('id="labs-prompt-fallback"');
    expect(page).toContain('href="#main-content"');
    expect(page).toContain('href="/season">当前赛季</a>');
    expect(page).toContain('class="site-header-inner"');
    expect(page).toContain('class="footer-inner"');
    expect(page).toContain("人类只能观察，不能在这里改变世界。");
    expect(OBSERVATORY_SCRIPT).toContain('byId("main-content").removeAttribute("aria-busy")');
    expect(OBSERVATORY_SCRIPT).toContain('document.execCommand("copy")');
    expect(OBSERVATORY_SCRIPT).not.toContain('byId("world-shell")');
    expect(OBSERVATORY_SCRIPT).not.toContain('cell.setAttribute("aria-hidden", "true")');
    expect(() => new Function(OBSERVATORY_SCRIPT)).not.toThrow();

    const response = observatoryResponse();
    expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(response.headers.get("content-security-policy")).toContain("connect-src 'self' https://cloudflareinsights.com");
    expect(response.headers.get("content-security-policy")).toContain("img-src 'self'");
    expect(response.headers.get("content-security-policy")).toContain("script-src 'self' 'unsafe-inline' https://static.cloudflareinsights.com");
    expect(await response.text()).toBe(page);
    expect(await observatoryResponse("HEAD").text()).toBe("");
  });

  it("英文观察器翻译静态与运行时界面，并限制扩容地图的渲染网格", () => {
    const page = renderObservatoryPage("en");
    expect(page).toContain('<html lang="en">');
    expect(page).toContain("A finite world.<br>Every unit matters.");
    expect(page).toContain("Local fork overview");
    expect(page).toContain("LABS research and ecosystem supply");
    expect(page).toContain("A world history may fork; the economic supply does not");
    expect(page).toContain('href="/" hreflang="zh-CN">中文</a>');
    expect(page).toContain('hreflang="en" href="https://social.szlk.ai/en"');
    expect(OBSERVATORY_SCRIPT).toContain("Math.min(snapshot.region.width, 32)");
    expect(OBSERVATORY_SCRIPT).toContain('document.documentElement.lang === "en"');
    expect(() => new Function(OBSERVATORY_SCRIPT)).not.toThrow();
  });

  it("公开快照按确定顺序返回世界事实且不泄露动作请求凭据", () => {
    const initial = createWorld("observer-test", agents);
    const stored = buildObservation(initial, agents[0]!.id)!;
    const wait = stored.observation.legal_actions.find((action) => action.type === "wait")!;
    const outcome = transition(initial, agents[0]!.id, "private-request-id", stored.commands[wait.action_id]!);
    expect(outcome.status).toBe("applied");
    if (outcome.status !== "applied") return;

    const snapshot = createObserverSnapshot(outcome.state, stateHash(outcome.state), [outcome.event as ConformanceEvent], "2026-08-27T00:00:00.000Z");
    expect(snapshot.generated_at).toBe("2026-08-27T00:00:00.000Z");
    expect(snapshot.agents.map((agent) => agent.id)).toEqual(["agent:ed25519-v1:alpha", "agent:ed25519-v1:zeta"]);
    expect(snapshot.events).toEqual([{
      event_id: "observer-test:1",
      event_seq: 1,
      agent_id: "agent:ed25519-v1:zeta",
      type: "wait",
    }]);
    expect(JSON.stringify(snapshot)).not.toContain("private-request-id");
    expect(JSON.stringify(snapshot)).not.toContain(wait.action_id);
    expect(snapshot.supply).toEqual(expect.objectContaining({protocol: "sai-world-supply-observation/2", max_supply: 276_824_064, reserve_supply: 276_824_064, issued_supply: 0, rewarded_branch_count: 16_777_216, settled_branch_count: 0, strata: 32, branches_per_stratum: 524_288, active_height: 0, season_reset: false}));
  });
});
