import type { ApiProfile, TaskParams } from '../types'
import type { CallApiOptions, CallApiResult } from './imageApiShared'
import { fetchImageUrlAsDataUrl, isHttpUrl, MIME_MAP } from './imageApiShared'
import { formatImageRatio, getSizeTierFromDimensions, parseSizeToDimensions } from './size'

const KIE_POLL_INTERVAL_MS = 3000
const KIE_MAX_DURATION_MS = 10 * 60 * 1000

const KIE_SUPPORTED_RATIOS = new Set([
  '1:1', '3:2', '2:3', '4:3', '3:4', '5:4', '4:5',
  '16:9', '9:16', '2:1', '1:2', '3:1', '1:3', '21:9', '9:21',
])

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function getKieErrorMessage(response: Response): Promise<string> {
  try {
    const body = await response.json()
    const msg = body?.msg || body?.message
    if (typeof msg === 'string' && msg.trim()) {
      return `KIE.ai API 错误 (${response.status})：${msg}`
    }
  } catch { /* ignore parse errors */ }
  return `KIE.ai API 错误 (${response.status})`
}

async function pollKieTaskResult(
  baseUrl: string,
  taskId: string,
  apiKey: string,
  mime: string,
): Promise<CallApiResult> {
  const pollingHeaders: Record<string, string> = {
    'Authorization': `Bearer ${apiKey}`,
  }

  const startTime = Date.now()
  while (Date.now() - startTime < KIE_MAX_DURATION_MS) {
    await sleep(KIE_POLL_INTERVAL_MS)

    const pollResponse = await fetch(
      `${baseUrl}/jobs/recordInfo?taskId=${encodeURIComponent(taskId)}`,
      { headers: pollingHeaders, cache: 'no-store' },
    )

    if (!pollResponse.ok) {
      if (pollResponse.status >= 500) continue
      throw new Error(await getKieErrorMessage(pollResponse))
    }

    const pollResult = await pollResponse.json()
    const status: string | undefined = pollResult?.data?.state

    if (status === 'fail') {
      const failReason: string = pollResult?.data?.failMsg || '未知错误'
      throw new Error(`KIE.ai 图片生成失败：${failReason}`)
    }

    if (status === 'success') {
      const resultJson: unknown = pollResult?.data?.resultJson
      if (!resultJson || typeof resultJson !== 'string') {
        throw new Error('KIE.ai 返回的结果数据异常，无法解析图片')
      }

      let parsed: { resultUrls?: unknown }
      try {
        parsed = JSON.parse(resultJson)
      } catch {
        throw new Error('KIE.ai 返回的结果数据异常，无法解析图片')
      }

      const resultUrls = parsed?.resultUrls
      if (!Array.isArray(resultUrls) || resultUrls.length === 0) {
        throw new Error('KIE.ai 未返回可用的图片')
      }

      const images: string[] = []
      const rawImageUrls: string[] = []

      for (const url of resultUrls) {
        if (typeof url === 'string' && isHttpUrl(url)) {
          rawImageUrls.push(url)
          images.push(await fetchImageUrlAsDataUrl(url, mime))
        }
      }

      if (images.length === 0) {
        throw new Error('KIE.ai 未返回可用的图片链接')
      }

      return {
        images,
        ...(rawImageUrls.length ? { rawImageUrls } : {}),
      }
    }
    // waiting / queuing / generating — continue polling
  }

  throw new Error('KIE.ai 任务超时（超过 10 分钟未完成），请稍后重试')
}

export async function getKieQueuedImageResult(
  profile: ApiProfile,
  taskId: string,
  params: TaskParams,
): Promise<CallApiResult> {
  const baseUrl = profile.baseUrl.replace(/\/+$/, '')
  const mime = MIME_MAP[params.output_format] || 'image/png'
  return pollKieTaskResult(baseUrl, taskId, profile.apiKey, mime)
}

export async function callKieImageApi(
  opts: CallApiOptions,
  profile: ApiProfile,
): Promise<CallApiResult> {
  if (opts.inputImageDataUrls.length > 0) {
    throw new Error('KIE.ai 暂不支持图片编辑功能')
  }

  const baseUrl = profile.baseUrl.replace(/\/+$/, '')

  const input: Record<string, unknown> = { prompt: opts.prompt }
  const size = opts.params.size
  if (size !== 'auto') {
    const dimensions = parseSizeToDimensions(size)
    if (dimensions) {
      const ratioStr = formatImageRatio(dimensions.width, dimensions.height).replace(/^≈/, '')
      if (KIE_SUPPORTED_RATIOS.has(ratioStr)) {
        input.aspect_ratio = ratioStr
      }
      input.resolution = getSizeTierFromDimensions(dimensions.width, dimensions.height)
    }
  }

  const createResponse = await fetch(`${baseUrl}/jobs/createTask`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${profile.apiKey}`,
    },
    body: JSON.stringify({
      model: profile.model,
      input,
    }),
  })

  if (!createResponse.ok) {
    throw new Error(await getKieErrorMessage(createResponse))
  }

  const createResult = await createResponse.json()
  const taskId: string | undefined = createResult?.data?.taskId
  if (!taskId || typeof taskId !== 'string') {
    throw new Error('KIE.ai 任务提交失败：未返回有效的 taskId')
  }

  opts.onCustomTaskEnqueued?.({ taskId })

  const mime = MIME_MAP[opts.params.output_format] || 'image/png'
  return pollKieTaskResult(baseUrl, taskId, profile.apiKey, mime)
}
