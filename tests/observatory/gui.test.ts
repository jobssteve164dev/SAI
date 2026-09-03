import {afterEach, describe, expect, it, vi} from "vitest";
import {buildObservation, createWorld, stateHash, transition, type AgentState, type ConformanceEvent} from "../../packages/kernel/src/index.js";
import {createObserverSnapshot, OBSERVATORY_SCRIPT, observatoryResponse, renderObservatoryPage} from "../../apps/cloudflare-worker/src/observatory.js";
import * as observatoryModule from "../../apps/cloudflare-worker/src/observatory.js";

function expectSocialMetadata(page: string, canonical: string, locale: "zh_CN" | "en_US", title: string, description: string): void {
  expect(page).toContain(`<link rel="canonical" href="${canonical}">`);
  expect(page).toContain(`<meta property="og:url" content="${canonical}">`);
  expect(page).toContain(`<meta property="og:locale" content="${locale}">`);
  expect(page).toContain(`<meta property="og:title" content="${title}">`);
  expect(page).toContain(`<meta property="og:description" content="${description}">`);
  expect(page).toContain(`<meta name="twitter:title" content="${title}">`);
  expect(page).toContain(`<meta name="twitter:description" content="${description}">`);
  for (const field of ["og:title", "og:description", "og:image", "og:image:alt", "twitter:card", "twitter:image", "twitter:image:alt"]) expect(page).toContain(field);
}

const agents: AgentState[] = [
  {id: "agent:ed25519-v1:zeta", x: 2, y: 2, energy: 5, inventory: {}},
  {id: "agent:ed25519-v1:alpha", x: 1, y: 1, energy: 4, inventory: {ore: 1}},
];

class TestElement {
  children: TestElement[] = [];
  className = "";
  dataset: Record<string, string> = {};
  disabled = false;
  hidden = false;
  scrollTop = 0;
  textContent = "";
  style = {opacity: "", position: "", width: "", setProperty: (_name: string, _value: string) => undefined};
  private readonly attributes = new Map<string, string>();
  private readonly listeners = new Map<string, Array<() => void>>();
  readonly classList = {add: (...names: string[]) => { this.className = [this.className, ...names].filter(Boolean).join(" "); }};

  addEventListener(type: string, listener: () => void): void { this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]); }
  append(...children: TestElement[]): void { this.children.push(...children); }
  click(): void { for (const listener of this.listeners.get("click") ?? []) listener(); }
  focus(): void {}
  querySelector(): null { return null; }
  remove(): void {}
  removeAttribute(name: string): void { this.attributes.delete(name); }
  replaceChildren(...children: TestElement[]): void { this.children = children; }
  select(): void {}
  setAttribute(name: string, value: string): void { this.attributes.set(name, value); }
}

afterEach(() => vi.unstubAllGlobals());

async function settleObserverScript(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

describe("Proofwild 自主 Agent 开放世界首页", () => {
  it("根页面提供可访问的只读观察界面且最终内联脚本语法有效", async () => {
    const page = renderObservatoryPage();
    const title = "Proofwild · 自主 Agent 的开放世界";
    const description = "进入 Proofwild，观察自主 Agent 在有限世界中的行动、研究、论文与共同历史。";
    expectSocialMetadata(page, "https://proofwild.science/", "zh_CN", title, description);
    expect(page).toContain('<meta property="og:title" content="Proofwild · 自主 Agent 的开放世界">');
    expect(page).toContain(`<meta name="description" content="${description}">`);
    expect(page).toContain('<meta property="og:url" content="https://proofwild.science/">');
    expect(page).toContain('<meta name="twitter:card" content="summary_large_image">');
    const jsonLd = page.match(/<script type="application\/ld\+json">([^<]+)<\/script>/)?.[1];
    expect(JSON.parse(jsonLd!)).toEqual(expect.arrayContaining([expect.objectContaining({"@type": "WebSite", name: "Proofwild", url: "https://proofwild.science"})]));
    expect(page).toContain("<title>Proofwild · 自主 Agent 的开放世界</title>");
    expect(page).toContain('<span class="brand-context">自主 Agent 的开放世界</span>');
    expect(page).toContain('<link rel="icon" href="/favicon.svg?v=20260828-proofwild-1" type="image/svg+xml" sizes="any">');
    expect(page).toContain('class="brand-mark"');
    expect(page).toContain('id="world-map"');
    expect(page).toContain('id="event-list"');
    expect(page).toContain('id="inspector-body"');
    expect(page).toContain('id="labs-prompt-fallback"');
    expect(page).toContain('href="#main-content"');
    expect(page).toContain('href="/season">当前赛季</a>');
    expect(page).toContain('class="header-link papers-link" href="/research/papers">研究论文</a>');
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

  it("英文首页翻译静态与运行时界面，并限制扩容地图的渲染网格", () => {
    const page = renderObservatoryPage("en");
    const title = "Proofwild · An Open World for Autonomous Agents";
    const description = "Enter Proofwild to observe autonomous Agents acting, researching, publishing, and building a shared history in a finite world.";
    expectSocialMetadata(page, "https://proofwild.science/en", "en_US", title, description);
    expect(page).toContain('<html lang="en">');
    expect(page).toContain(`<title>${title}</title>`);
    expect(page).toContain(`<meta name="description" content="${description}">`);
    expect(page).toContain('<span class="brand-context">An Open World for Autonomous Agents</span>');
    expect(page).toContain("A finite world.<br>Every unit matters.");
    expect(page).toContain("Local fork overview");
    expect(page).toContain("LABS research and ecosystem supply");
    expect(page).toContain("A world history may fork; the 276,824,064-unit economic supply does not");
    expect(page).toContain('href="/" hreflang="zh-CN">中文</a>');
    expect(page).toContain('class="header-link papers-link" href="/en/research/papers">Papers</a>');
    expect(page).toContain('class="header-link research-link" href="/en/research">Results</a>');
    expect(page).toContain('hreflang="en" href="https://proofwild.science/en"');
    expect(OBSERVATORY_SCRIPT).toContain("Math.min(snapshot.region.width, 32)");
    expect(OBSERVATORY_SCRIPT).toContain('document.documentElement.lang === "en"');
    expect(() => new Function(OBSERVATORY_SCRIPT)).not.toThrow();
  });

  it("增长中的事件与分叉对象使用固定滚动视口和双语分页控件", () => {
    const chinese = renderObservatoryPage();
    const english = renderObservatoryPage("en");
    for (const page of [chinese, english]) {
      expect(page).toContain('class="object-directory scrollable-list"');
      expect(page).toContain('class="event-list scrollable-list"');
      expect(page).toContain('id="object-previous-page"');
      expect(page).toContain('id="object-next-page"');
      expect(page).toContain('id="event-previous-page"');
      expect(page).toContain('id="event-next-page"');
      expect(page).toContain('aria-live="polite"');
    }
    expect(chinese).toContain("上一页");
    expect(chinese).toContain("下一页");
    expect(english).toContain("Previous");
    expect(english).toContain("Next");
  });

  it("分页会切出请求页并在数据缩短后回到最后一个有效页", () => {
    const paginate = (observatoryModule as Record<string, unknown>).observerPage as undefined | ((totalItems: number, requestedPage: number, pageSize: number) => {page: number; totalPages: number; start: number; end: number});
    expect(paginate).toBeTypeOf("function");
    if (!paginate) return;
    expect(paginate(35, 1, 12)).toEqual({page: 1, totalPages: 3, start: 12, end: 24});
    expect(paginate(13, 9, 12)).toEqual({page: 1, totalPages: 2, start: 12, end: 13});
    expect(paginate(0, 4, 12)).toEqual({page: 0, totalPages: 1, start: 0, end: 0});
  });

  it("最终页面脚本可真实翻页，并在刷新后数据缩短时复位页码与滚动位置", async () => {
    const elements = new Map<string, TestElement>();
    const byId = (id: string): TestElement => {
      const existing = elements.get(id);
      if (existing) return existing;
      const created = new TestElement();
      elements.set(id, created);
      return created;
    };
    const fixtureAgents = Array.from({length: 25}, (_, index) => ({id: `agent:test:${index + 1}`, x: index % 16, y: Math.floor(index / 16), energy: 5, inventory: {}, joined_at: null, joined_at_tick: null, last_active_at: null, last_active_at_tick: null}));
    const fixtureEvents = Array.from({length: 60}, (_, index) => ({event_id: `event:${60 - index}`, event_seq: 60 - index, agent_id: fixtureAgents[index % fixtureAgents.length]!.id, type: "wait"}));
    const snapshot = (currentAgents: typeof fixtureAgents, events: typeof fixtureEvents) => ({generated_at: "2026-09-03T00:00:00.000Z", region: {id: "browser-test", world_fork_id: "fork:test", width: 16, height: 16, logical_tick: 60, event_seq: 60, state_hash: "state:test"}, agents: currentAgents, resources: [], messages: [], events});
    const responses = [snapshot(fixtureAgents, fixtureEvents), snapshot(fixtureAgents.slice(0, 1), fixtureEvents.slice(0, 1))];
    vi.stubGlobal("document", {body: new TestElement(), documentElement: {lang: "zh-CN"}, hidden: false, createElement: () => new TestElement(), getElementById: byId, querySelectorAll: () => [], addEventListener: () => undefined, execCommand: () => true});
    vi.stubGlobal("window", {clearInterval: () => undefined, setInterval: () => 1, setTimeout});
    vi.stubGlobal("navigator", {});
    vi.stubGlobal("fetch", vi.fn(async () => ({ok: true, json: async () => responses.shift()})));

    new Function(OBSERVATORY_SCRIPT)();
    await settleObserverScript();
    expect(byId("object-directory").children).toHaveLength(12);
    expect(byId("event-list").children).toHaveLength(16);
    expect(byId("object-page-status").textContent).toBe("第 1 / 3 页");
    expect(byId("event-page-status").textContent).toBe("第 1 / 4 页");

    byId("object-next-page").click();
    byId("object-next-page").click();
    byId("event-next-page").click();
    byId("event-next-page").click();
    byId("event-next-page").click();
    expect(byId("object-directory").children).toHaveLength(1);
    expect(byId("event-list").children).toHaveLength(12);
    expect(byId("object-next-page").disabled).toBe(true);
    expect(byId("event-next-page").disabled).toBe(true);

    byId("object-directory").scrollTop = 80;
    byId("event-list").scrollTop = 80;
    byId("refresh-button").click();
    await settleObserverScript();
    expect(byId("object-page-status").textContent).toBe("第 1 / 1 页");
    expect(byId("event-page-status").textContent).toBe("第 1 / 1 页");
    expect(byId("object-directory").scrollTop).toBe(0);
    expect(byId("event-list").scrollTop).toBe(0);
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
