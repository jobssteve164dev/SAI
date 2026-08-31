import {describe, expect, it} from "vitest";
import {buildObservation, createWorld, stateHash, transition, type AgentState, type ConformanceEvent} from "../../packages/kernel/src/index.js";
import {createObserverSnapshot, OBSERVATORY_SCRIPT, observatoryResponse, renderObservatoryPage} from "../../apps/cloudflare-worker/src/observatory.js";

function expectSocialMetadata(page: string, canonical: string, locale: "zh_CN" | "en_US"): void {
  expect(page).toContain(`<link rel="canonical" href="${canonical}">`);
  expect(page).toContain(`<meta property="og:url" content="${canonical}">`);
  expect(page).toContain(`<meta property="og:locale" content="${locale}">`);
  for (const field of ["og:title", "og:description", "og:image", "og:image:alt", "twitter:card", "twitter:image", "twitter:image:alt"]) expect(page).toContain(field);
}

const agents: AgentState[] = [
  {id: "agent:ed25519-v1:zeta", x: 2, y: 2, energy: 5, inventory: {}},
  {id: "agent:ed25519-v1:alpha", x: 1, y: 1, energy: 4, inventory: {ore: 1}},
];

describe("Proofwild 世界观察器", () => {
  it("根页面提供可访问的只读观察界面且最终内联脚本语法有效", async () => {
    const page = renderObservatoryPage();
    expectSocialMetadata(page, "https://proofwild.science/", "zh_CN");
    expect(page).toContain('<meta property="og:title" content="Proofwild 世界观察器">');
    expect(page).toContain('<meta property="og:url" content="https://proofwild.science/">');
    expect(page).toContain('<meta name="twitter:card" content="summary_large_image">');
    const jsonLd = page.match(/<script type="application\/ld\+json">([^<]+)<\/script>/)?.[1];
    expect(JSON.parse(jsonLd!)).toEqual(expect.arrayContaining([expect.objectContaining({"@type": "WebSite", name: "Proofwild", url: "https://proofwild.science"})]));
    expect(page).toContain("<title>Proofwild 世界观察器</title>");
    expect(page).toContain('<link rel="icon" href="/favicon.svg?v=20260828-proofwild-1" type="image/svg+xml" sizes="any">');
    expect(page).toContain('class="brand-mark"');
    expect(page).toContain('id="world-map"');
    expect(page).toContain('id="event-list"');
    expect(page).toContain('id="inspector-body"');
    expect(page).toContain('id="labs-prompt-fallback"');
    expect(page).toContain('href="#main-content"');
    expect(page).toContain('href="/season">当前赛季</a>');
    expect(page).toContain('href="/research">研究成果</a>');
    expect(page).toContain('id="labs-records"');
    expect(page).toContain('id="labs-advances"');
    expect(page).toContain('class="site-header-inner"');
    expect(page).toContain('class="footer-inner"');
    expect(page).toContain("人类只能观察，不能在这里改变世界。");
    expect(page).toContain("常驻 Agent 密度超过 25% 时");
    expect(page).toContain("活跃 LABS 矿点");
    expect(page).toContain('href="https://github.com/jobssteve164dev/proofwild">开放源码</a>');
    expect(page).not.toContain("github.com/jobssteve164dev/SAI");
    expect(OBSERVATORY_SCRIPT).toContain('byId("main-content").removeAttribute("aria-busy")');
    expect(OBSERVATORY_SCRIPT).toContain('document.execCommand("copy")');
    expect(OBSERVATORY_SCRIPT).toContain('encodeURIComponent(entry.result_ids[0])');
    expect(OBSERVATORY_SCRIPT).toContain('marker.classList.add("is-rotated")');
    expect(OBSERVATORY_SCRIPT).toContain('copy.residentDensity');
    expect(OBSERVATORY_SCRIPT).toContain('copy.joinedWorld');
    expect(OBSERVATORY_SCRIPT).toContain('copy.lastActive');
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
    expectSocialMetadata(page, "https://proofwild.science/en", "en_US");
    expect(page).toContain('<html lang="en">');
    expect(page).toContain("A finite world.<br>Every unit matters.");
    expect(page).toContain("Local fork overview");
    expect(page).toContain("LABS research and ecosystem supply");
    expect(page).toContain("A world history may fork; the 276,824,064-unit economic supply does not");
    expect(page).toContain('href="/" hreflang="zh-CN">中文</a>');
    expect(page).toContain('hreflang="en" href="https://proofwild.science/en"');
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

    const snapshot = createObserverSnapshot(outcome.state, stateHash(outcome.state), [outcome.event as ConformanceEvent], "2026-08-27T00:00:00.000Z", {
      "agent:ed25519-v1:zeta": {joined_at: "2026-08-26T23:59:58.000Z", joined_at_tick: 0, last_active_at: "2026-08-27T00:00:00.000Z", last_active_at_tick: 1},
    });
    expect(snapshot.generated_at).toBe("2026-08-27T00:00:00.000Z");
    expect(snapshot.agents.map((agent) => agent.id)).toEqual(["agent:ed25519-v1:alpha", "agent:ed25519-v1:zeta"]);
    expect(snapshot.agents[0]).toMatchObject({id: "agent:ed25519-v1:alpha", joined_at: null, joined_at_tick: null, last_active_at: null, last_active_at_tick: null});
    expect(snapshot.agents[1]).toMatchObject({id: "agent:ed25519-v1:zeta", joined_at: "2026-08-26T23:59:58.000Z", joined_at_tick: 0, last_active_at: "2026-08-27T00:00:00.000Z", last_active_at_tick: 1});
    expect(snapshot.events).toEqual([{
      event_id: "observer-test:1",
      event_seq: 1,
      agent_id: "agent:ed25519-v1:zeta",
      type: "wait",
    }]);
    expect(JSON.stringify(snapshot)).not.toContain("private-request-id");
    expect(JSON.stringify(snapshot)).not.toContain(wait.action_id);
    expect(snapshot.supply).toEqual(expect.objectContaining({protocol: "sai-world-supply-observation/3", max_supply: 276_824_064, reserve_supply: 276_824_064, issued_supply: 0, rewarded_branch_count: 16_777_216, rewarded_research_unit_count: 276_824_064, settled_branch_count: 0, settled_research_unit_count: 0, remaining_research_unit_count: 276_824_064, candidates_per_research_unit: 65_536, verified_new_canonical_candidates: "0", strata: 32, branches_per_stratum: 524_288, active_height: 0, season_reset: false}));
  });
});
