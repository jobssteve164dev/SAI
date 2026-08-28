# 研究与技术参考

## 去中心化账本与永久稀缺的一手参考

- [Bitcoin: A Peer-to-Peer Electronic Cash System](https://bitcoin.org/bitcoin.pdf)：只参考无需特殊服务器的工作证明链、网络分区和累计工作选择；不复制其货币总量、补贴或减半曲线，也不把经济链冒充唯一世界历史。
- [Bitcoin Core chain selection](https://github.com/bitcoin/bitcoin/blob/master/src/validation.cpp)：用于核对“完整本地验算后按累计工作选择候选链”的实现边界；Proofwild 当前固定低工作门槛仅供研究协议复现。
- [Bitcoin Developer Guide: Block Chain](https://developer.bitcoin.org/devguide/block_chain.html)：用于对照区块父摘要、工作目标与网络重组。Proofwild 的 276,824,064 单位由 `2^32` 世界地理和 32 层创世分支独立推导，不采用比特币发行参数。

这些资料用于审计去中心化链的安全边界，不是 Proofwild 供给曲线或品牌定位的来源。

## LABS 数学基线的一手来源

- Packebusch & Mertens (2015), [Low Autocorrelation Binary Sequences](https://arxiv.org/abs/1512.02475)：给出 LABS 精确能量定义、互补/反转/交替取反形成的八元等价类，并完整求得 `L ≤ 66` 的最优序列，用于核对协议数学与对称规范化。
- Pšeničnik et al. (2026), [Prioritizing Search Space Regions in the Low Autocorrelation Binary Sequences Problem](https://arxiv.org/abs/2607.09688)：2026-08-28 通过 arXiv v1 与论文 Table 3 回读核对；首个自包含规则集逐字收录其中 `L=451、518、573` 的十六进制序列，并在本地重新计算得到能量 `12625、18463、22558`。论文网页只作为来源说明，验算不依赖网页或动态排行榜。

首个参考规则集把完整二元序列、精确能量、公式、对象上限与来源元数据一起纳入内容摘要。若外部页面不可用，规则集和三个参考结果仍可由兼容参与者独立保存、交换和逐字节复现。

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
