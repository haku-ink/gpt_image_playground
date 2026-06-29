## Problem Statement

用户希望在项目中调用 KIE.ai 的 GPT Image 2 文生图模型，该服务提供高质量的 AI 图片生成能力，返回 HTTP URL 格式的图片。目前项目仅支持 OpenAI 兼容接口和 fal.ai 两种服务商，无法直接使用这种异步任务型（提交→轮询）的第三方 API。

## Solution

新增一个 KIE.ai 专用适配器（`kieImageApi.ts`），实现 KIE API 的异步任务提交/轮询流程，并在 API 路由、Profile 管理、设置界面中注册为内置服务商。用户只需在设置中创建一个 KIE.ai profile 并填入 API Key，即可像使用 fal.ai 一样提交图片生成任务。

## User Stories

1. 作为普通用户，我想在设置中选择 "KIE.ai" 作为 API 服务商，这样我可以使用自己的 KIE API Key 生成图片
2. 作为普通用户，我想用 KIE.ai 提交文生图任务，输入提示词后点击提交，系统自动轮询直到出图
3. 作为普通用户，我想在任务完成后看到生成的图片出现在任务卡片中，和 OpenAI/fal.ai 任务表现一致
4. 作为普通用户，我想在任务详情中看到图片的原始 URL（rawImageUrls），方便我手动下载原图
5. 作为普通用户，提交 KIE 任务后如果关闭了浏览器，重启后系统应该能从 IndexedDB 恢复 taskId 并继续轮询
6. 作为普通用户，如果 KIE 任务生成失败，我应该能看到包含失败原因的中文错误提示
7. 作为普通用户，KIE.ai 不支持 mask/图片编辑功能，当我尝试对输入图片进行遮罩编辑时，应该有清晰的提示告知不支持
8. 作为开发者，我希望 KIE 适配器的测试代码能覆盖成功路径、失败路径、resultJson 解析异常等关键分支

## Implementation Decisions

### 路由层：走专用适配器而非自定义服务商模板

KIE API 的响应格式特殊——`data.resultJson` 是一个 JSON 字符串而非对象，需要二次解析。现有的 CustomProvider 模板机制无法自动穿透 JSON 字符串路径。因此创建专用适配器 `kieImageApi.ts`，而非依赖用户在前端填 JSON mapping。

### 接口契约：对齐 CallApiOptions → CallApiResult

KIE 适配器导出 `callKieImageApi(opts: CallApiOptions, profile: ApiProfile): Promise<CallApiResult>`，与 `callFalAiImageApi` 和 `callOpenAICompatibleImageApi` 完全对齐。在 `callImageApi()` 中新增一个 `provider === 'kie'` 分支。

### 异步轮询逻辑

API 模式为提交→轮询（非流式、非回调），KIE 适配器内部实现轮询循环：
- 提交后每 3 秒轮询一次 `/jobs/recordInfo` 端点
- 总超时 10 分钟
- 状态流转：waiting → queuing → generating → success / fail
- 成功时从 `data.resultJson`（JSON 字符串）中解析 `resultUrls[]`
- 使用已有的 `fetchImageUrlAsDataUrl()` 将每个 HTTP 链接转为 base64 data URL

### 错误处理

轮询过程中若网络断开（`TypeError` / `AbortError`），适配器重新抛出，让 `store.ts` 的上层恢复逻辑处理。API 返回 fail 状态时，抛出带中文描述的 Error。

### Provider 注册

- `BuiltInApiProvider` 无需修改——`ApiProvider` 类型本身是 `BuiltInApiProvider | string`，已在现有类型系统覆盖范围内
- 新增 `DEFAULT_KIE_BASE_URL` 和 `DEFAULT_KIE_MODEL` 常量
- 新增 `createDefaultKieProfile()`，参照 `createDefaultFalProfile` 的模式
- `switchApiProfileProvider()`、`getApiProviderLabel()` 各加一个 `'kie'` 分支
- SettingsModal 的 provider 下拉列表加一条 `{ label: 'KIE.ai', value: 'kie' }`

### store.ts 适配

- `executeTask` 中确保 KIE 任务不启动 OpenAI watchdog（它是异步轮询模式），且 `isAsyncCustomTask` 判断覆盖 KIE
- `markInterruptedOpenAIRunningTasks` 中的排除逻辑加上 `apiProvider === 'kie'`

### 首版限制

- 仅支持文生图，不支持图片编辑 / mask
- 参数层面暂不暴露 KIE 特有的 `aspect_ratio` 和 `resolution`，使用默认值（`aspect_ratio: 'auto'`，不传 resolution 即默认 1K）
- `n` 参数（多图生成）KIE API 不支持，固定为 1

## Testing Decisions

### 测试接缝

最高测试接缝是 **`callKieImageApi(opts, profile)`** 函数本身——它是纯 I/O 函数，输入 `CallApiOptions` + `ApiProfile`，输出 `CallApiResult`。所有业务逻辑（请求构建、轮询控制、响应解析、错误处理）都在这个函数内，不依赖 React / Zustand / DOM。

测试时 mock 全局 `fetch`（使用 vitest 的 `vi.stubGlobal`），注入假的 createTask 和 recordInfo 响应。

### 好的测试的标准

- 只测外部行为（mock fetch → 验证 CallApiResult 内容），不测内部实现（不 test 轮询间隔具体是几毫秒）
- 失败路径验证 Error.message 包含有意义的用户可见文本

### 参照现有测试

`src/lib/falAiImageApi.test.ts` 是直接参照——mock 外部 SDK，调用导出函数，验证参数传递和返回值。

### 建议测试用例

- 提交成功 → 第一次轮询就 success → 返回 CallApiResult.images
- 提交成功 → 2 次 pending 后 success → 返回 CallApiResult.images 和 rawImageUrls
- 提交失败（401 / 402 / 422 / 429）→ 抛出 Error
- resultJson 为非标准格式（空字符串、null）→ 抛出 Error
- 有 inputImages 时 → 抛出 Error（不支持编辑）
- 超时（mock 超过 10 分钟后还是 pending）→ 抛出 Error

## Out of Scope

- KIE 特有的 `aspect_ratio` 和 `resolution` 参数暴露
- 图片编辑 / mask 支持
- KIE Agent 模式（多轮对话）
- KIE 的 `callBackUrl` 回调模式
- 批量 / 并发 KIE 任务优化

## Further Notes

- KIE.ai 文档：https://docs.kie.ai/cn/market/gpt/gpt-image-2-text-to-image
- 该 API 与 fal.ai 的模式高度一致（异步队列），falAiImageApi.ts 是主要的设计参考
- `fetchImageUrlAsDataUrl`（imageApiShared.ts:137）已经处理了 CORS 探测和错误降级提示，KIE 适配器直接复用，无需重复实现
