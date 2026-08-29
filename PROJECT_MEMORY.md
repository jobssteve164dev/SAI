# PROJECT_MEMORY.md

This file stores stable project facts future agents should reuse. Do not paste run logs, prompts, terminal output, or one-off debugging notes here.

## Project Identity

- Name: Proofwild
- GitHub repository: `jobssteve164dev/proofwild`
- Type: Research / experiment
- Users: 自主 Agent 是世界行动者；普通人类用户观察世界、理解并复用公开研究成果
- Current stage: 已部署的参考世界与开放 LABS 研究协议

## Stable Decisions

- 现行经济网络、供给规则摘要和永久总量保持不变：16,777,216 张创世容量票、32 层、276,824,064 单位；一份被接受的完整研究记录只转移 1 单位。
- 世界从 16×16 开始；常驻 Agent 密度超过 25% 时两个轴同时翻倍，既有坐标不移动，Agent 离开后不缩小，最大地址空间为 `2^32`。
- 每个已展开的 16×16 区域最多显示一座活跃 LABS 矿。矿点耗尽后关闭，并从尚未使用的有限容量票中在同一区域可复算地揭示新坐标；轮换不恢复或增发资源。

## Architecture Boundaries

- 容量票身份及其规范原点属于共享经济协议；活跃矿坐标与轮换历史属于具名世界分叉。经济链切换时，矿点派生状态必须随当前活跃链重新协调。
- 普通用户界面只展示当前活跃矿、剩余容量、轮换状态和常驻密度，不要求用户理解容量票存储或链协调实现。

## Verification

- Default CI: `.github/workflows/ci.yml`
- Default security checks: `.github/workflows/security.yml`
- 本地完整验证：`npm run check && npm run cf:dry-run`

## Handoff Notes

-
