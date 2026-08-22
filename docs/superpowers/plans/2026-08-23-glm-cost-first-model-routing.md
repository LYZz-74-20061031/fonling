# Fonling GLM 成本优先模型路由 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 将 Fonling 的默认剧情、摘要与记忆分析迁移到免费 `glm-4.7-flash`，并提供严格一次性的 `glm-4.5-air` 高质量入口，同时保留手动 DeepSeek 备用且不泄露任何 API Key。

**Architecture:** 新增独立的全局模型配置模块和统一模型请求网关，由 `index.html` 只负责生成计划、驱动界面和提交角色状态。后台任务使用固定免费计划；输入区一次性 Air 和最新回复重新生成使用显式高质量计划。角色存储与导入导出继续由现有逻辑负责，但不再持有或导出密钥。

**Tech Stack:** 原生 HTML/CSS/JavaScript、LocalStorage、Fetch/SSE、Node.js 内置 `node:test` 与 `vm`。

---

## Task 1: 全局模型配置模块

**Files:**
- Create: `js/model/model-config.js`
- Create: `tests/model-config.test.js`

1. 先写失败测试，覆盖默认配置、规范化、原子保存失败回滚、旧角色 DeepSeek Key 仅迁移一次，以及配置副本不暴露可变引用。
2. 运行 `node --test tests/model-config.test.js`，确认因模块不存在或接口缺失而失败。
3. 实现版本化全局配置、固定模型常量、LocalStorage 适配器和旧 Key 迁移。
4. 再次运行聚焦测试并确认通过。

## Task 2: 统一模型请求网关

**Files:**
- Create: `js/model/model-gateway.js`
- Create: `tests/model-gateway.test.js`

1. 先写失败测试，覆盖 GLM 免费/Air 请求体、DeepSeek 兼容请求体、流式与非流式解析、UTF-8 跨分片、重试分类及 Air 永不自动重试。
2. 运行 `node --test tests/model-gateway.test.js`，确认红灯原因符合预期。
3. 实现不可变请求计划、供应商适配、SSE 解析、错误类型和受控重试。
4. 运行聚焦测试并确认通过。

## Task 3: 角色数据与全局凭据解耦

**Files:**
- Modify: `index.html`
- Modify: `tests/import-data.test.js`
- Modify: `tests/memory-import-export.test.js`
- Modify: `tests/memory-migration.test.js`
- Create: `tests/model-config-integration.test.js`

1. 先更新/新增失败测试，要求新导出不含 API Key、旧 JSON 不覆盖已有全局 Key、旧角色 Key 只在全局 DeepSeek Key 为空时迁移。
2. 运行相关测试并确认旧行为导致失败。
3. 在页面加载全局配置模块，移除角色运行状态对 `apiKey` 的依赖，并保留旧数据兼容读取。
4. 调整导入、导出、创建/切换/删除角色路径，确保它们不会修改全局配置。
5. 运行本任务测试并确认通过。

## Task 4: 接入剧情、摘要和记忆分析路由

**Files:**
- Modify: `index.html`
- Modify: `tests/summary-memory.test.js`
- Modify: `tests/memory-api-context.test.js`
- Modify: `tests/memory-conversation-lifecycle.test.js`
- Modify: `tests/memory-regenerate-analysis-race.test.js`
- Create: `tests/model-routing-integration.test.js`

1. 先写失败测试，证明普通剧情按全局供应商路由，而摘要和记忆分析始终固定 GLM 免费计划。
2. 运行相关测试并观察预期失败。
3. 用统一网关替换聊天、摘要和分析器配置中的硬编码 DeepSeek 请求。
4. 保持现有上下文、摘要门槛、记忆分析时序和保存事务不变。
5. 运行相关测试并确认通过。

## Task 5: 一次性 Air、重新深度思考与生成来源

**Files:**
- Create: `js/model/model-session.js`
- Create: `tests/model-session.test.js`
- Modify: `index.html`
- Modify: `tests/memory-conversation-lifecycle.test.js`
- Modify: `tests/memory-regenerate-analysis-race.test.js`
- Create: `tests/model-provenance.test.js`

1. 先写失败测试，覆盖一次性状态的激活、捕获与所有退出路径恢复；角色/智能体切换取消；后台任务不能读取该状态。
2. 先写失败测试，覆盖最新回复 Air 原子替换、失败保留旧回复，以及消息生成来源的保存/导出。
3. 实现独立的一次性会话状态机，并在发送与重新生成事务中捕获固定计划。
4. 给 AI 消息写入最小生成来源，免费回复不显示标签，Air 回复可识别。
5. 运行本任务测试并确认通过。

## Task 6: 全局设置与输入区界面

**Files:**
- Create: `css/model.css`
- Modify: `index.html`
- Create: `tests/model-ui-structure.test.js`

1. 先写失败的静态结构测试，覆盖全局模型设置、GLM/DeepSeek 控件、轻量状态栏、一次性 Air 按钮、右侧角色圆点、Air 标签入口和发送按钮样式。
2. 运行聚焦测试并确认失败。
3. 实现全局设置保存/回滚、连接测试状态、DeepSeek 折叠区和默认供应商切换提示。
4. 删除旧的大块身份条，添加左右轻量状态栏；发送按钮固定白底黑图；补齐手机宽度下的截断和禁用态。
5. 运行界面结构测试并确认通过。

## Task 7: 失败恢复、成本保护与回归

**Files:**
- Modify: `index.html`
- Modify: `tests/model-routing-integration.test.js`
- Modify: `tests/model-ui-structure.test.js`

1. 增加失败测试：免费请求仅对网络/429/5xx重试一次，失败后只出现“再次免费尝试”和“深度思考本条”；Air 不重试且状态恢复。
2. 实现错误操作入口、明确错误文案和后台静默失败保护。
3. 运行 `node --test tests/model-*.test.js`。
4. 运行完整回归 `node --test tests/*.test.js`。
5. 用 `vm.Script` 检查 `index.html` 内嵌 JavaScript 语法，并运行 `git diff --check`。
6. 在 Chrome 手机视口检查设置抽屉、输入区、角色切换、Air 状态和失败恢复。
7. 仅在用户于页面中手动录入临时 GLM Key 后，执行一次极短 `glm-4.7-flash` 连接测试；不测试 Air、DeepSeek、摘要或记忆分析。

## 交付约束

- 所有编辑直接落在 `D:\github\fonling` 主目录。
- 不创建工作树，不提交、不推送、不改写 Git 历史。
- 不在仓库文件、测试、命令或输出中写入用户真实 API Key。
- 每个实现步骤先观察对应测试失败，再写最小实现使其通过。
- 遇到非预期失败时先定位根因，不以放宽断言掩盖回归。
