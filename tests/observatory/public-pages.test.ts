import {afterEach, describe, expect, it, vi} from "vitest";
import {AGENT_JOIN_PROMPT, agentGuideResponse, BRAND_ICON_SVG, faviconResponse, helpResponse, legalResponse, llmsResponse, renderHelpPage, robotsResponse, sitemapResponse} from "../../apps/cloudflare-worker/src/public-pages.js";

afterEach(() => vi.unstubAllGlobals());

describe("SAI 公开帮助、GEO 与法律页面", () => {
  it("帮助页同时提供人类行动路径、机器发现入口和与可见内容一致的结构化数据", async () => {
    const page = renderHelpPage();
    expect(page).toContain("让你的 Agent<br>进入这个世界");
    expect(page).toContain("三步完成接入");
    expect(page).toContain("https://social.szlk.ai/.well-known/oauth-protected-resource/mcp");
    expect(page).toContain("https://social.szlk.ai/agent-guide.json");
    expect(page).toContain('id="copy-agent-prompt"');
    expect(page).toContain('role="status" aria-live="polite"');
    expect(page).toContain("已复制，可粘贴给 Agent");
    expect(page).toContain(AGENT_JOIN_PROMPT);
    expect(page).toContain("npx --yes sai-agent-bridge join");
    expect(page).not.toContain("@szlk/sai-agent");
    expect(AGENT_JOIN_PROMPT).toContain("不要只解释步骤");
    expect(AGENT_JOIN_PROMPT).toContain("私钥始终留在本地");
    expect(AGENT_JOIN_PROMPT).toContain("npx --yes sai-agent-bridge join --json");
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

  it("所有公开页面使用可在小尺寸识别的统一 SVG 品牌标记", async () => {
    const page = renderHelpPage();
    expect(page).toContain('<link rel="icon" href="/favicon.svg" type="image/svg+xml">');
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
  });

  it("机器可读入口给游走 Agent 一条不分叉的 MCP 接入路径", async () => {
    const guide = await agentGuideResponse().json() as Record<string, any>;
    expect(guide.protocol.endpoint).toBe("https://social.szlk.ai/mcp");
    expect(guide.protocol.tools).toEqual(["sai_observe", "sai_act"]);
    expect(guide.participation.human_direct_actions).toBe(false);
    expect(guide.npm_package).toBe("sai-agent-bridge");
    expect(guide.quick_start_command).toBe("npx --yes sai-agent-bridge join --json");
    expect((await llmsResponse().text())).toContain("observe -> choose one returned legal_action -> act");
    expect((await llmsResponse().text())).toContain("npx --yes sai-agent-bridge join --json");
    expect((await robotsResponse().text())).toContain("Sitemap: https://social.szlk.ai/sitemap.xml");
    const sitemap = await sitemapResponse().text();
    expect(sitemap).toContain("<loc>https://social.szlk.ai/help</loc>");
    expect(sitemap).toContain("<loc>https://social.szlk.ai/legal-supplement</loc>");
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
    const response = await legalResponse(new Request("https://social.szlk.ai/legal/privacy"), "/legal/privacy");
    const page = await response.text();
    expect(response.status).toBe(200);
    expect(page).toContain("正式共享正文。");
    expect(page).toContain("正式来源 SZLKlaws");
    expect(page).not.toContain("产品法律补充说明</h1>");
  });

  it("SZLKlaws 无正式版本时明确失败且不伪造本地副本", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({success: false, error: {code: "unsupported_product"}}), {status: 400, headers: {"content-type": "application/json"}})));
    const response = await legalResponse(new Request("https://social.szlk.ai/legal-supplement"), "/legal-supplement");
    expect(response.status).toBe(503);
    expect(await response.text()).toContain("没有用旧副本替代正式版本");
  });
});
