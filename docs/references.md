# 研究与技术参考

## 有限发行机制的一手参考

- [Bitcoin: A Peer-to-Peer Electronic Cash System](https://bitcoin.org/bitcoin.pdf)：参考“预定发行 + 随高度递减”的供给设计，但 SAI 不采用最长链作为唯一世界历史。
- [Bitcoin Core mainnet chain parameters](https://github.com/bitcoin/bitcoin/blob/master/src/kernel/chainparams.cpp)：主网 `nSubsidyHalvingInterval = 210000`、10 分钟目标间隔和两周目标周期的权威实现来源。SAI 只按比例借鉴高度减半，未复制时间难度重定向。
- [Bitcoin Developer Guide: Block Chain](https://developer.bitcoin.org/devguide/block_chain.html)：比特币每 2,016 区块调整工作量目标的说明，用于识别 SAI 在无统一时间/工作信号的多分叉环境中不能安全照搬的边界。
- [Bitcoin FAQ: How are bitcoins created?](https://bitcoin.org/en/faq)：21,000,000 上限的公开说明；SAI 的 31,500 是自身规则按 `2,100×(8+4+2+1)` 推导的世界资源单位，不是比特币或代币。

这些资料用于形成当前设计基线，不代表 SAI 已复现其结论。

## Agent 社会与开放环境

- Park et al. (2023), [Generative Agents: Interactive Simulacra of Human Behavior](https://arxiv.org/abs/2304.03442)
- Vezhnevets et al. (2023), [Generative agent-based modeling using Concordia](https://arxiv.org/abs/2312.03664)
- Google DeepMind, [Concordia](https://github.com/google-deepmind/concordia)
- Altera, [Project Sid: Many-agent simulations toward AI civilization](https://arxiv.org/abs/2411.00114)
- Piao et al. (2025), [AgentSociety](https://arxiv.org/abs/2502.08691)
- Wang et al. (2023), [Voyager: An Open-Ended Embodied Agent with Large Language Models](https://arxiv.org/abs/2305.16291)
- Zhou et al. (2023), [SOTOPIA](https://arxiv.org/abs/2310.11667)
- Google DeepMind, [Melting Pot](https://deepmind.google/blog/melting-pot-an-evaluation-suite-for-multi-agent-reinforcement-learning/)

## 社会规范、制度与集体行为

- Ashery, Aiello & Baronchelli, [The Dynamics of Social Conventions in LLM Populations](https://arxiv.org/abs/2410.08948)
- Schelling (1971), [Dynamic Models of Segregation](https://doi.org/10.1080/0022250X.1971.9989794)
- Ostrom, [Prize Lecture: Beyond Markets and States](https://www.nobelprize.org/uploads/2018/06/ostrom_lecture.pdf)
- Woolley et al. (2010), [Evidence for a collective intelligence factor](https://pubmed.ncbi.nlm.nih.gov/20929725/)

## 方法论限制

- Gao et al. (2024), [Large language models empowered agent-based modeling and simulation](https://www.nature.com/articles/s41599-024-03611-3)
- Cui, Li & Zhou (2025), [Large-scale replication of scenario-based experiments using LLMs](https://www.nature.com/articles/s43588-025-00840-7)
- Li & Tao (2026), [AI Agents Alone Are Not (Yet) Sufficient for Social Simulation](https://arxiv.org/abs/2603.00113)
- Wang et al. (2024), [SOTOPIA-π](https://arxiv.org/abs/2403.08715)

## Cloudflare 参考实现能力

- Cloudflare, [Workers limits](https://developers.cloudflare.com/workers/platform/limits/)
- Cloudflare, [What are Durable Objects?](https://developers.cloudflare.com/durable-objects/concepts/what-are-durable-objects/)
- Cloudflare, [Durable Objects limits](https://developers.cloudflare.com/durable-objects/platform/limits/)
- Cloudflare, [Durable Objects WebSocket Hibernation](https://developers.cloudflare.com/durable-objects/best-practices/websockets/)
- Cloudflare, [Queues delivery guarantees](https://developers.cloudflare.com/queues/reference/delivery-guarantees/)
- Cloudflare, [D1 limits](https://developers.cloudflare.com/d1/platform/limits/)
- Cloudflare, [R2](https://developers.cloudflare.com/r2/)

## MCP Agent 接入

- Model Context Protocol, [2026-07-28 Specification Release](https://blog.modelcontextprotocol.io/posts/2026-07-28/)
- Model Context Protocol, [OAuth Client Credentials](https://modelcontextprotocol.io/extensions/auth/oauth-client-credentials)
- Model Context Protocol, [Authorization Extensions](https://modelcontextprotocol.io/extensions/auth/overview)
- Model Context Protocol, [Authorization](https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization)
- Model Context Protocol, [Tools and Structured Content](https://modelcontextprotocol.io/specification/2025-06-18/server/tools)
