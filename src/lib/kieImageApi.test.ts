import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { DEFAULT_PARAMS } from '../types'
import { createDefaultKieProfile, DEFAULT_KIE_BASE_URL, DEFAULT_KIE_MODEL, DEFAULT_SETTINGS } from './apiProfiles'
import { callKieImageApi } from './kieImageApi'

function jsonRes(data: unknown, status = 200): Promise<Response> {
  return Promise.resolve(
    new Response(JSON.stringify(data), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  )
}

function imageBlobRes(): Response {
  const bytes = new Uint8Array(32)
  bytes[0] = 0x89
  bytes[1] = 0x50
  return new Response(new Blob([bytes], { type: 'image/png' }))
}

function successPoll(resultUrls: string[]) {
  return jsonRes({
    code: 200,
    data: {
      state: 'success',
      resultJson: JSON.stringify({ resultUrls }),
    },
  })
}

function pendingPoll(status = 'generating') {
  return jsonRes({ code: 200, data: { state: status } })
}

function createTaskRes(taskId: string) {
  return jsonRes({ code: 200, data: { taskId } })
}

const baseProfile = createDefaultKieProfile({ apiKey: 'test-key' })
const baseOpts = {
  settings: DEFAULT_SETTINGS,
  prompt: 'a cat',
  params: { ...DEFAULT_PARAMS, output_format: 'png' as const },
  inputImageDataUrls: [],
}

describe('callKieImageApi', () => {
  let fetchMock: Mock

  beforeEach(() => {
    vi.useFakeTimers()
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  async function advancePoll(): Promise<void> {
    await vi.advanceTimersByTimeAsync(3000)
  }

  it('submits task with correct API key and model', async () => {
    fetchMock
      .mockResolvedValueOnce(createTaskRes('task-1'))
      .mockResolvedValueOnce(successPoll(['https://example.com/img.png']))
      .mockResolvedValueOnce(Promise.resolve(imageBlobRes()))

    const promise = callKieImageApi(baseOpts, baseProfile)
    await advancePoll()
    await promise

    const createCall = fetchMock.mock.calls[0]
    const [url, init] = createCall as [string, RequestInit]
    expect(url).toBe(`${DEFAULT_KIE_BASE_URL}/jobs/createTask`)
    expect(init.headers).toHaveProperty('Authorization', 'Bearer test-key')
    const body = JSON.parse(init.body as string)
    expect(body.model).toBe(DEFAULT_KIE_MODEL)
    expect(body.input.prompt).toBe('a cat')
    expect(body.input.aspect_ratio).toBeUndefined()
    expect(body.input.resolution).toBeUndefined()
  })

  it('includes aspect_ratio and resolution when size is not auto', async () => {
    fetchMock
      .mockResolvedValueOnce(createTaskRes('task-1'))
      .mockResolvedValueOnce(successPoll(['https://example.com/img.png']))
      .mockResolvedValueOnce(Promise.resolve(imageBlobRes()))

    const promise = callKieImageApi(
      { ...baseOpts, params: { ...baseOpts.params, size: '2560x1440' } },
      baseProfile,
    )
    await advancePoll()
    await promise

    const createCall = fetchMock.mock.calls[0]
    const body = JSON.parse((createCall as [string, RequestInit])[1].body as string)
    expect(body.input.aspect_ratio).toBe('16:9')
    expect(body.input.resolution).toBe('2K')
  })

  it('returns images on first poll success', async () => {
    fetchMock
      .mockResolvedValueOnce(createTaskRes('task-1'))
      .mockResolvedValueOnce(successPoll(['https://example.com/img.png']))
      .mockResolvedValueOnce(Promise.resolve(imageBlobRes()))

    const promise = callKieImageApi(baseOpts, baseProfile)
    await advancePoll()
    const result = await promise

    expect(result.images).toHaveLength(1)
    expect(result.images[0]).toMatch(/^data:image\/png;base64,/)
    expect(result.rawImageUrls).toEqual(['https://example.com/img.png'])
  })

  it('returns images after pending polls then success', async () => {
    fetchMock
      .mockResolvedValueOnce(createTaskRes('task-1'))
      .mockResolvedValueOnce(pendingPoll('waiting'))
      .mockResolvedValueOnce(pendingPoll('generating'))
      .mockResolvedValueOnce(successPoll(['https://example.com/img.png']))
      .mockResolvedValueOnce(Promise.resolve(imageBlobRes()))

    const promise = callKieImageApi(baseOpts, baseProfile)
    await advancePoll()
    await advancePoll()
    await advancePoll()
    const result = await promise

    expect(result.images).toHaveLength(1)
    expect(result.rawImageUrls).toEqual(['https://example.com/img.png'])
  })

  it('reports custom task ID for store-layer recovery', async () => {
    const onEnqueued = vi.fn()
    fetchMock
      .mockResolvedValueOnce(createTaskRes('task-kie-123'))
      .mockResolvedValueOnce(successPoll(['https://example.com/img.png']))
      .mockResolvedValueOnce(Promise.resolve(imageBlobRes()))

    const promise = callKieImageApi({ ...baseOpts, onCustomTaskEnqueued: onEnqueued }, baseProfile)
    await advancePoll()
    await promise

    expect(onEnqueued).toHaveBeenCalledWith({ taskId: 'task-kie-123' })
  })

  it('throws on 401 create task response', async () => {
    fetchMock.mockResolvedValueOnce(jsonRes({ msg: 'Unauthorized' }, 401))

    await expect(callKieImageApi(baseOpts, baseProfile)).rejects.toThrow('KIE.ai API 错误 (401)')
  })

  it('throws on 402 create task response', async () => {
    fetchMock.mockResolvedValueOnce(jsonRes({ msg: 'Payment Required' }, 402))

    await expect(callKieImageApi(baseOpts, baseProfile)).rejects.toThrow('KIE.ai API 错误 (402)')
  })

  it('throws on 422 create task response', async () => {
    fetchMock.mockResolvedValueOnce(jsonRes({ msg: 'Unprocessable Entity' }, 422))

    await expect(callKieImageApi(baseOpts, baseProfile)).rejects.toThrow('KIE.ai API 错误 (422)')
  })

  it('throws on 429 create task response', async () => {
    fetchMock.mockResolvedValueOnce(jsonRes({ msg: 'Too Many Requests' }, 429))

    await expect(callKieImageApi(baseOpts, baseProfile)).rejects.toThrow('KIE.ai API 错误 (429)')
  })

  it('throws when resultJson is empty string', async () => {
    fetchMock
      .mockResolvedValueOnce(createTaskRes('task-1'))
      .mockResolvedValueOnce(jsonRes({ code: 200, data: { state: 'success', resultJson: '' } }))

    const promise = callKieImageApi(baseOpts, baseProfile)
    promise.catch(() => {}) // suppress unhandled rejection from fake timers
    await advancePoll()
    await expect(promise).rejects.toThrow('结果数据异常')
  })

  it('throws when resultJson is null', async () => {
    fetchMock
      .mockResolvedValueOnce(createTaskRes('task-1'))
      .mockResolvedValueOnce(jsonRes({ code: 200, data: { state: 'success', resultJson: null } }))

    const promise = callKieImageApi(baseOpts, baseProfile)
    promise.catch(() => {})
    await advancePoll()
    await expect(promise).rejects.toThrow('结果数据异常')
  })

  it('throws when inputImages are provided (editing not supported)', async () => {
    await expect(
      callKieImageApi(
        { ...baseOpts, inputImageDataUrls: ['data:image/png;base64,abc'] },
        baseProfile,
      ),
    ).rejects.toThrow('暂不支持图片编辑')
  })

  it('throws on task failure status', async () => {
    fetchMock
      .mockResolvedValueOnce(createTaskRes('task-1'))
      .mockResolvedValueOnce(jsonRes({
        code: 200,
        data: { state: 'fail', failMsg: '内容审核不通过' },
      }))

    const promise = callKieImageApi(baseOpts, baseProfile)
    promise.catch(() => {})
    await advancePoll()
    await expect(promise).rejects.toThrow('图片生成失败：内容审核不通过')
  })

  it('throws on timeout after 10 minutes of pending', async () => {
    fetchMock
      .mockResolvedValueOnce(createTaskRes('task-1'))
    for (let i = 0; i < 250; i++) {
      fetchMock.mockResolvedValueOnce(pendingPoll('generating'))
    }

    const promise = callKieImageApi(baseOpts, baseProfile)
    promise.catch(() => {})
    await vi.advanceTimersByTimeAsync(10 * 60 * 1000 + 5000)
    await expect(promise).rejects.toThrow('超时')
  })
})
