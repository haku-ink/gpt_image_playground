# Slice 1: KIE.ai 服务商注册

## What to build

将 KIE.ai 注册为一个内置服务商选项，让用户能在设置界面中创建 KIE.ai profile 并填入 API Key。

这一步是预重构——只做完 profile 管理层面的注册（常量、创建函数、切换分支、UI 下拉选项），不涉及实际的 API 调用逻辑。选择 KIE profile 提交任务时走现有 fallback 路径即可。

**关键行为：**

- 用户在设置中打开 provider 下拉，看到 "KIE.ai" 选项
- 选择 KIE.ai 后，base URL 自动填入 `https://api.kie.ai/v1`，model 自动填入 `gpt-image-2`
- 切换 profile 的 provider 时，ProviderDrafts 机制正确保留/恢复 KIE 相关字段
- `getApiProviderLabel()` 对 `'kie'` 返回 `'KIE.ai'`
- SettingsModal 中 KIE profile 的 base URL 可编辑、model 可编辑、API Key 可正常保存

## Acceptance criteria

- [ ] `DEFAULT_KIE_BASE_URL` 和 `DEFAULT_KIE_MODEL` 常量定义在 `apiProfiles.ts` 中
- [ ] `createDefaultKieProfile()` 函数存在，参照 `createDefaultFalProfile` 模式，包含正确的默认超时、base URL、model
- [ ] `switchApiProfileProvider()` 包含 `'kie'` 分支，正确处理 provider 切换时的字段迁移
- [ ] `getApiProviderLabel()` 对 `'kie'` 返回 `'KIE.ai'`
- [ ] SettingsModal 的 provider 下拉列表中包含 `{ label: 'KIE.ai', value: 'kie' }`，排在 fal.ai 之后
- [ ] 选择 KIE profile 时，base URL 和 model 输入框正常显示并可编辑
- [ ] 现有 fal / openai profile 的行为不受影响

## Blocked by

None — 可立即开始。
