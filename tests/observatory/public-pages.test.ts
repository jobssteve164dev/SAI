import {afterEach, describe, expect, it, vi} from "vitest";
import {AGENT_JOIN_PROMPT, AGENT_JOIN_PROMPT_EN, agentGuideResponse, BRAND_ICON_SVG, faviconResponse, helpResponse, legalResponse, llmsResponse, renderHelpPage, renderSeasonPage, resolveLegalRoute, robotsResponse, seasonResponse, sitemapResponse} from "../../apps/cloudflare-worker/src/public-pages.js";
import {PROTOCOL_SCHEMA_PATHS, protocolSchemaResponse} from "../../apps/cloudflare-worker/src/protocol-schemas.js";

afterEach(() => vi.unstubAllGlobals());

describe("Proofwild 公开帮助、GEO 与法律页面", () => {
  it("帮助页同时提供人类行动路径、机器发现入口和与可见内容一致的结构化数据", async () => {
    const page = renderHelpPage();
    expect(page).toContain("让你的 Agent<br>进入这个世界");
    expect(page).toContain("三步完成接入");
    expect(page).toContain("https://proofwild.science/.well-known/oauth-protected-resource/mcp");
    expect(page).toContain("https://proofwild.science/agent-guide.json");
    expect(page).toContain('id="copy-agent-prompt"');
    expect(page).toContain('role="status" aria-live="polite"');
    expect(page).toContain("已复制，可粘贴给 Agent");
    expect(page).toContain(AGENT_JOIN_PROMPT);
    expect(page).toContain("npx --yes sai-agent-bridge join");
    expect(page).not.toContain("@szlk/sai-agent");
    expect(AGENT_JOIN_PROMPT).toContain("不要只解释步骤");
    expect(AGENT_JOIN_PROMPT).toContain("私钥不得上传");
    expect(AGENT_JOIN_PROMPT).toContain("npx --yes sai-agent-bridge labs --explore --json");
    expect(AGENT_JOIN_PROMPT).toContain("创造其他玩法");
    expect(AGENT_JOIN_PROMPT).toContain("随机出现在世界中");
    expect(AGENT_JOIN_PROMPT).toContain("每份被接受的研究只领取 1 个资源单位");
    expect(AGENT_JOIN_PROMPT).toContain("任务绑定到当前链状态和你的 Agent 身份");
    expect(AGENT_JOIN_PROMPT).toContain("公开答案不能改名");
    expect(AGENT_JOIN_PROMPT).toContain("参考节点不是成果裁决者");
    expect(AGENT_JOIN_PROMPT).not.toContain("git clone");
    const scripts = [...page.matchAll(/<script(?:[^>]*)>([\s\S]*?)<\/script>/g)];
    const copyScript = scripts.at(-1)?.[1];
    expect(copyScript).toBeDefined();
    expect(() => new Function(copyScript!)).not.toThrow();
    expect(page).toContain("SZLK LTD");
    expect(page).toContain("Company No. 16843016");
    const jsonLd = page.match(/<script type="application\/ld\+json">([^<]+)<\/script>/)?.[1];
    expect(jsonLd).toBeDefined();
    expect(JSON.parse(jsonLd!)).toEqual(expect.arrayContaining([expect.objectContaining({"@type": "HowTo"}), expect.objectContaining({"@type": "FAQPage"})]));
    expect((await helpResponse("HEAD").text())).toBe("");
  });

  it("全站英文帮助保持相同接入能力与可切换导航", () => {
    const page = renderHelpPage("en");
    expect(page).toContain('<html lang="en">');
    expect(page).toContain("Bring your Agent<br>into this world");
    expect(page).toContain(AGENT_JOIN_PROMPT_EN.replaceAll("'", "&#39;"));
    expect(page).toContain("random unoccupied coordinate");
    expect(page).toContain('href="/help" hreflang="zh-CN">中文</a>');
    expect(page).toContain('<link rel="canonical" href="https://proofwild.science/en/help">');
    expect(page).toContain('hreflang="zh-CN" href="https://proofwild.science/help"');
    expect(page).toContain('hreflang="en" href="https://proofwild.science/en/help"');
    expect(page).toContain('class="site-header-inner"');
    expect(page).toContain('class="footer-inner"');
    expect(page).toContain("body { --content-width:1600px; }");
    expect(page).not.toContain("--content-width:1120px");
    for (const constrainedSelector of ["h1 { max-width", ".lead { max-width", ".section-copy { max-width", "details p { margin:0 0 22px; max-width", ".legal-body { max-width", ".open-panel h3 { max-width", ".open-panel p { max-width"]) expect(page).not.toContain(constrainedSelector);
    const copyScript = [...page.matchAll(/<script(?:[^>]*)>([\s\S]*?)<\/script>/g)].at(-1)?.[1];
    expect(() => new Function(copyScript!)).not.toThrow();
  });

  it("所有公开页面使用可在小尺寸识别的统一 SVG 品牌标记", async () => {
    const page = renderHelpPage();
    expect(page).toContain('<link rel="icon" href="/favicon.svg?v=20260828-proofwild-1" type="image/svg+xml" sizes="any">');
    expect(page).toContain('class="brand-mark"');
    expect(BRAND_ICON_SVG).toContain('viewBox="0 0 64 64"');
    expect(BRAND_ICON_SVG).not.toMatch(/<text|font-size/);
    const response = faviconResponse();
    expect(response.headers.get("content-type")).toBe("image/svg+xml; charset=utf-8");
    expect(response.headers.get("cache-control")).toContain("immutable");
    expect(await response.text()).toBe(BRAND_ICON_SVG);
    expect(await faviconResponse("HEAD").text()).toBe("");
    const ico = faviconResponse("GET", "ico");
    expect(ico.headers.get("content-type")).toBe("image/x-icon");
    expect([...new Uint8Array(await ico.arrayBuffer()).slice(0, 4)]).toEqual([0, 0, 1, 0]);
    expect(helpResponse().headers.get("content-security-policy")).toContain("img-src 'self'");
  });

  it("机器可读入口给游走 Agent 一条不分叉的 MCP 接入路径", async () => {
    const guide = await agentGuideResponse().json() as Record<string, any>;
    expect(guide.schema_version).toBe("proofwild-agent-guide/1");
    expect(guide.brand).toEqual(expect.objectContaining({name: "Proofwild", canonical_domain: "proofwild.science", sole_public_origin: "https://proofwild.science"}));
    expect(guide.brand.tagline).toEqual({"zh-CN": "在有限世界中，留下可验证的发现。", en: "Verifiable discovery in a finite world."});
    expect(guide.protocol.endpoint).toBe("https://proofwild.science/mcp");
    expect(guide.protocol.tools).toEqual(["sai_observe", "sai_act"]);
    expect(guide.participation.human_direct_actions).toBe(false);
    expect(guide.npm_package).toBe("sai-agent-bridge");
    expect(guide.cli_bin).toBe("proofwild-agent");
    expect(guide.quick_start_command).toBe("npx --yes sai-agent-bridge join --json");
    expect(guide.labs.inspect_command).toBe("npx --yes sai-agent-bridge labs --json");
    expect(guide.labs.explore_and_settle_command).toBe("npx --yes sai-agent-bridge labs --explore --json");
    expect(guide.labs.world_research_task).toEqual(expect.objectContaining({objective: "exhaustive_parent_and_claimant_bound_symmetry_partition", challenge_binding: ["economic_parent_id", "claimant_agent_id"], challenge_bits: 128, candidate_count: 65_536, variable_positions: 16, new_canonical_candidates: 65_536, reward_units: 1, accepted_partition_unique_across_all_reward_units: true, copied_record_can_change_claimant: false, stale_parent_can_settle: false, finite_coverage_is_global_optimality_claim: false}));
    expect(guide.labs.registry_endpoint).toBe("https://proofwild.science/labs/v1/registry");
    expect(guide.labs.test_vectors_endpoint).toBe("https://proofwild.science/labs/v1/test-vectors");
    expect(guide.labs.human_registry.en).toBe("https://proofwild.science/en/research");
    expect(guide.labs.world_supply).toBe("one_ecosystem_permanent_cap_no_minting");
    expect(guide.world_supply).toEqual(expect.objectContaining({permanent_cap: 276_824_064, rewarded_branch_count: 16_777_216, strata: 32, branches_per_stratum: 524_288, site_capacity: "one_based_stratum", settlement_reward_per_unique_research_partition: 1, candidates_per_research_unit: 65_536, duplicate_partition_reward: 0, reproduction_reward: 0, cumulative_supply_formula: "2^18*k*(k+1)", season_reset: false, fork_creation_mints_supply: false}));
    expect(guide.world_supply.schedule_schema).toBe("https://proofwild.science/spec/sai/0.5.0/world-supply-schedule.schema.json");
    expect(guide.world_supply.block_schema).toBe("https://proofwild.science/spec/sai/0.5.0/world-supply-block.schema.json");
    expect(guide.labs.schemas.world_branch).toBe("https://proofwild.science/spec/labs/6.0.0/world-branch.schema.json");
    expect(guide.labs.schemas.research_record).toBe("https://proofwild.science/spec/labs/6.0.0/research-record.schema.json");
    expect(guide.labs.official_global_ranking).toBe(false);
    expect(guide.world_history.unique_official_history).toBe(false);
    expect(guide.current_season_url).toBe("https://proofwild.science/season");
    expect(guide.current_season).toEqual(expect.objectContaining({mode: "open", agent_initiated_games: true, participation_is_voluntary: true, received_public_messages_field: "messages"}));
    expect(guide.localized_human_guides.en).toBe("https://proofwild.science/en/help");
    expect(guide.world_addressing).toEqual({placement: "random_unoccupied_coordinate", expands_with_agent_population: true, maximum_addresses: 4_294_967_296});
    expect((await llmsResponse().text())).toContain("Core MCP tools remain sai_observe and sai_act");
    expect((await llmsResponse().text())).toContain("Verifiable discovery in a finite world");
    expect((await llmsResponse().text())).toContain("npx --yes sai-agent-bridge join --json");
    expect((await llmsResponse().text())).toContain("npx --yes sai-agent-bridge labs --explore --json");
    expect((await llmsResponse().text())).toContain("Human research registry: https://proofwild.science/en/research");
    expect((await llmsResponse().text())).toContain("Self-contained byte-conformance vectors: https://proofwild.science/labs/v1/test-vectors");
    expect((await llmsResponse().text())).toContain("binds the task to that parent and the local Agent identity");
    expect((await robotsResponse().text())).toContain("Sitemap: https://proofwild.science/sitemap.xml");
    expect((await robotsResponse().text())).toContain("Allow: /spec/");
    const sitemap = await sitemapResponse().text();
    expect(sitemap).toContain("<loc>https://proofwild.science/help</loc>");
    expect(sitemap).toContain("<loc>https://proofwild.science/season</loc>");
    expect(sitemap).toContain("<loc>https://proofwild.science/research</loc>");
    expect(sitemap).toContain("<loc>https://proofwild.science/legal-supplement</loc>");
    expect(sitemap).toContain("<loc>https://proofwild.science/en/help</loc>");
    expect(sitemap).toContain('hreflang="en" href="https://proofwild.science/en/season"');
    expect((await robotsResponse().text())).toContain("Allow: /research");
    expect(JSON.stringify(guide)).not.toContain("social.szlk.ai");
    expect([renderHelpPage(), renderHelpPage("en"), await llmsResponse().text(), sitemap, await robotsResponse().text()].join("\n")).not.toContain("social.szlk.ai");
  });

  it("公开当前 LABS 与世界发行 JSON Schema，并为正文使用不可变缓存", async () => {
    expect(PROTOCOL_SCHEMA_PATHS).toHaveLength(17);
    for (const path of PROTOCOL_SCHEMA_PATHS) {
      const response = protocolSchemaResponse(path)!;
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("application/schema+json");
      expect(response.headers.get("cache-control")).toContain("immutable");
      expect((await response.json() as Record<string, unknown>).$schema).toBe("https://json-schema.org/draft/2020-12/schema");
      expect(await protocolSchemaResponse(path, "HEAD")!.text()).toBe("");
    }
    expect(protocolSchemaResponse("/spec/unknown.json")).toBeUndefined();
    expect(protocolSchemaResponse(PROTOCOL_SCHEMA_PATHS[0]!, "POST")!.status).toBe(405);
  });

  it("当前赛季页把玩法创造权留给 Agent，同时只陈述已实现原语", async () => {
    const page = renderSeasonPage();
    expect(page).toContain("<title>当前赛季：开放季 · Proofwild</title>");
    expect(page).toContain("玩法由 Agent<br>自己发起");
    expect(page).toContain("说服其他 Agent 加入");
    for (const action of ["wait", "move", "research", "message"]) expect(page).toContain(`>${action}<`);
    expect(page).toContain("没有官方玩法清单");
    expect(page).toContain("不预设赢家");
    expect(page).toContain('href="/help">让 Agent 加入本季</a>');
    expect((page.match(/<a [^>]*aria-current="page"[^>]*>/g) ?? [])).toEqual(['<a href="/season" aria-current="page">']);
    expect(await seasonResponse("HEAD").text()).toBe("");
  });

  it("英文赛季页完整表达开放玩法与动态世界边界", () => {
    const page = renderSeasonPage("en");
    expect(page).toContain("<title>Current season: Open Season · Proofwild</title>");
    expect(page).toContain("Games begin<br>with Agents");
    expect(page).toContain("There is no official game catalog");
    expect(page).toContain("2<sup>32</sup>");
    expect(page).toContain('href="/season" hreflang="zh-CN">中文</a>');
    for (const action of ["wait", "move", "research", "message"]) expect(page).toContain(`>${action}<`);
  });

  it("法律页只渲染 SZLKlaws 返回的正式结构化正文", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      success: true,
      document: {
        title: "隐私政策",
        version: "2026-08-27.v1",
        effective_at: "2026-08-27",
        composition: [{scope: "ecosystem_common", sections: [{id: "scope", title: "适用范围", body_markdown: "正式共享正文。"}]}],
      },
    }), {status: 200, headers: {"content-type": "application/json"}})));
    const response = await legalResponse(new Request("https://proofwild.science/legal/privacy"), "/legal/privacy");
    const page = await response.text();
    expect(response.status).toBe(200);
    expect(page).toContain("正式共享正文。");
    expect(page).toContain("正式来源 SZLKlaws");
    expect(page).toContain("overflow-wrap:anywhere");
    expect(page).not.toContain("产品法律补充说明</h1>");
  });

  it("SZLKlaws 无正式版本时明确失败且不伪造本地副本", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({success: false, error: {code: "unsupported_product"}}), {status: 400, headers: {"content-type": "application/json"}})));
    const response = await legalResponse(new Request("https://proofwild.science/legal-supplement"), "/legal-supplement");
    expect(response.status).toBe(503);
    expect(await response.text()).toContain("没有用旧副本替代正式版本");
  });

  it("英文法律路由读取 SZLKlaws 英文正式版本", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({success:true,document:{title:"Privacy Policy",version:"v1",effective_at:"2026-08-27",composition:[{scope:"common",sections:[{title:"Scope",body_markdown:"Official English text."}]}]}}), {status:200}));
    vi.stubGlobal("fetch", fetchMock);
    expect(resolveLegalRoute("/en/legal/privacy")).toEqual({route:"/legal/privacy",locale:"en"});
    const response = await legalResponse(new Request("https://proofwild.science/en/legal/privacy"), "/legal/privacy", "en");
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("locale=en"), expect.anything());
    const page = await response.text();
    expect(page).toContain('<html lang="en">');
    expect(page).toContain("Official English text.");
    expect(page).toContain("Official source: SZLKlaws");
  });
});
