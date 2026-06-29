# Slice 2: KIE API 适配器 + 全链路接入

## What to build

新建 KIE.ai 专用适配器 `kieImageApi.ts`，实现异步任务提交→轮询→解析的完整流程，并在 API 路由和 store 中接入，让 KIE 任务走通全链路。

**适配器核心逻辑：**

1. 提交阶段：POST 到 KIE API 创建任务，获取 taskId
2. 轮询阶段：每 3 秒 GET 任务状态，总超时 10 分钟；状态流转 waiting → queuing → generating → success / fail
3. 解析阶段：成功时从 `data.resultJson`（JSON 字符串）中解析出 `resultUrls[]`，调用已有的 `fetchImageUrlAsDataUrl()` 将每个 HTTP URL 转为 base64 data URL
4. 错误处理：API 返回 fail 状态时抛出中文 Error；网络断开（TypeError / AbortError）重新抛出，由 store 层恢复机制处理；有 inputImages 时直接抛出错误提示不支持编辑
5. 函数签名对齐 `callFalAiImageApi`：`callKieImageApi(opts: CallApiOptions, profile: ApiProfile): Promise<CallApiResult>`

**路由接入：**

- `callImageApi()` 新增 `provider === 'kie'` 分支，调用 `callKieImageApi`
- `executeTask` 中 KIE 任务不启动 OpenAI watchdog（它是异步轮询模式）
- `markInterruptedOpenAIRunningTasks` 排除 `apiProvider === 'kie'`
- `isAsyncCustomTask` / `isOpenAITask` 等判断逻辑覆盖 KIE

**首版限制（按 PRD）：**

- 仅支持文生图，n 固定为 1
- 不暴露 `aspect_ratio` 和 `resolution` 参数
- 不支持 mask / 图片编辑

## Acceptance criteria

- [ ] `callKieImageApi` 函数导出，提交 POST 请求到 KIE API，正确携带 API Key 和提示词
- [ ] 轮询逻辑：首次轮询即 success → 返回 `CallApiResult.images`（base64 data URL）
- [ ] 多次 pending 后 success → 返回 `CallApiResult.images` 且 `rawImageUrls` 包含 HTTP 原图链接
- [ ] 任务失败 → 抛出包含中文描述的 Error
- [ ] 有 inputImages 时 → 抛出明确提示 "KIE.ai 暂不支持图片编辑功能"
- [ ] `callImageApi` 中 `provider === 'kie'` 正确路由到 `callKieImageApi`
- [ ] KIE 任务在 `executeTask` 中不启动 OpenAI watchdog timer
- [ ] `markInterruptedOpenAIRunningTasks` 不将 KIE 任务标记为中断
- [ ] 浏览器重启后，KIE 任务的 taskId 能从 IndexedDB 恢复并继续轮询（store 层已有的 customRecoverable 机制覆盖 KIE）
- [ ] 现有 fal / openai 任务行为不受影响

## Blocked by

- [Slice 1: KIE.ai 服务商注册](kie-gpt-image-2-issue-1.md)
