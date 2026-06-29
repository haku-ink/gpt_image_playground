# Slice 3: KIE 适配器测试

## What to build

为 `callKieImageApi` 编写单元测试，覆盖成功路径、失败路径、异常分支。参照 `falAiImageApi.test.ts` 的测试模式：使用 vitest 的 `vi.stubGlobal('fetch', ...)` mock 全局 fetch，注入假的 API 响应，验证函数的外部行为（返回值和抛出的 Error）。

**不测内部实现细节**（不 test 轮询间隔具体是几毫秒），只测输入→输出的契约。

## Acceptance criteria

- [ ] 提交成功 → 第一次轮询就 success → 返回 `CallApiResult.images`
- [ ] 提交成功 → 2 次 pending 后 success → 返回 `CallApiResult.images` 且 `rawImageUrls` 包含 HTTP URL
- [ ] 提交失败（401 状态码）→ 抛出 Error
- [ ] 提交失败（402 状态码）→ 抛出 Error
- [ ] 提交失败（422 状态码）→ 抛出 Error
- [ ] 提交失败（429 状态码）→ 抛出 Error
- [ ] `resultJson` 为空字符串 → 抛出 Error
- [ ] `resultJson` 为 null → 抛出 Error
- [ ] 有 `inputImages` 时 → 抛出 Error（不支持编辑）
- [ ] 超时（mock 超过 10 分钟后仍 pending）→ 抛出 Error
- [ ] `pnpm test` 全部通过

## Blocked by

- [Slice 2: KIE API 适配器 + 全链路接入](kie-gpt-image-2-issue-2.md)
