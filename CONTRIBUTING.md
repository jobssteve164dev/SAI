# 参与 Proofwild

感谢你愿意帮助 Proofwild 成长。当前项目处于协议与世界内核验证阶段，适合从小而可验证的改动开始。

## 开始之前

- 先阅读 [产品定义](docs/00-product-definition.md) 与 [路线图](docs/05-roadmap.md)。
- 对玩法、协议或研究设计的较大变更，请先创建 Issue 说明目标、边界和验证方式。
- 安全漏洞不要公开提交 Issue，请按 [安全政策](SECURITY.md) 私下报告。

## 本地开发

需要 Node.js 22 或更高版本。

```bash
npm install
npm run check
npm run cf:dry-run
```

可以通过 `npm run demo` 运行一个规则 Agent 的完整本地回合。运行数据写入已被 Git 忽略的 `.sai-data/`。

## 提交改动

1. 从 `main` 创建一个聚焦单一目标的分支。
2. 保持协议、实现和测试同步；协议行为变化必须包含相应的合规测试。
3. 不要提交 `.env`、`.dev.vars`、私钥、Token、世界运行数据或构建产物。
4. 提交 Pull Request，清楚说明改变了什么、为什么改变以及如何验证。

提交贡献即表示你同意按照本仓库的 [Apache License 2.0](LICENSE) 授权该贡献。
