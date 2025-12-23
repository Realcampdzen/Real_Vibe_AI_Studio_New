import type { Fetcher, KVNamespace } from '@cloudflare/workers-types'
import { NEUROVALYUSHA_MODEL, NEUROVALYUSHA_SOCIAL_SYSTEM } from './constants'
import { callOpenAIChat, type OpenAIChatMessage } from './openai'
import { kvGetJson, kvGetText, kvIsDuplicate, kvPutJson, kvPutText } from './kv'
import { appendConversationMemory, getConversationMemory, truncate, type MemoryMessage } from './memory'
import { loadBadgeIndex, scoreBadges, type BadgeIndexEntry } from './guidebook_index'

export type NeuroValyushaBindings = {
  OPENAI_API_KEY?: string
  OPENAI_PROXY_BASE_URL?: string
  OPENAI_PROXY_TOKEN?: string
  NEUROVALYUSHA_KV?: KVNamespace
  ASSETS?: Fetcher

  // VK
  VK_SECRET?: string
  VK_CONFIRMATION_CODE?: string
  VK_GROUP_ID?: string
  VK_ACCESS_TOKEN?: string

  // Telegram
  TELEGRAM_BOT_TOKEN?: string
  TELEGRAM_WEBHOOK_SECRET?: string
  // Optional: limit bot to a specific discussion group (chat id, usually -100...)
  TELEGRAM_DISCUSSION_GROUP_ID?: string
  // Backward-compatible alias (some older envs use this name)
  DISCUSSION_GROUP_ID?: string
  TELEGRAM_CHANNEL_ID?: string
  // Optional: limit bot to a specific channel by username (e.g. "@realcampspb")
  TELEGRAM_CHANNEL_ID_USERNAME?: string
}

type VkCallbackPayload = {
  type?: string
  group_id?: number
  secret?: string
  event_id?: string
  object?: any
}

type TgUpdate = {
  update_id?: number
  message?: TgMessage
  channel_post?: TgMessage
  edited_message?: TgMessage
}

type TgMessage = {
  message_id: number
  date?: number
  chat: { id: number; type?: string; title?: string; username?: string }
  from?: { id: number; is_bot?: boolean; first_name?: string; username?: string }
  text?: string
  caption?: string
  is_automatic_forward?: boolean
  forward_from_chat?: { id: number; type?: string; title?: string; username?: string }
  forward_from_message_id?: number
  reply_to_message?: TgMessage
}

function nowTs(): number {
  return Date.now()
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0
}

function normalizeOutgoingText(text: string, maxChars: number): string {
  // No markdown formatting; keep it short.
  const cleaned = text
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/\*\*/g, '')
    .replace(/__/g, '')
    .trim()
  return truncate(cleaned, maxChars)
}

const VK_MESSAGE_PREFIX = 'Сообщение от НейроVалюши:'

function withVkPrefix(text: string): string {
  const t = (text || '').trim()
  if (!t) return VK_MESSAGE_PREFIX
  if (t.startsWith(VK_MESSAGE_PREFIX)) return t
  return `${VK_MESSAGE_PREFIX} ${t}`
}

function shouldReplyToText(text: string): boolean {
  const t = text.toLowerCase()
  if (t.includes('?') || t.includes('？')) return true
  const keywords = [
    'лагер',
    'вожат',
    '4к',
    '4к ',
    'soft',
    'софт',
    'навык',
    'ии',
    'нейро',
    'проект',
    'кружок',
    'обуч',
    'творч',
    'команд',
    'лидер',
  ]
  return keywords.some((k) => t.includes(k))
}

const BADGE_ID_RE = /\b\d{1,2}\.\d{1,2}(?:\.\d{1,2})?\b/g

function extractBadgeIds(text: string): string[] {
  if (!text) return []
  const matches = text.match(BADGE_ID_RE) || []
  return [...new Set(matches)]
}

function extractBadgeIdsFromMemory(memory: MemoryMessage[]): string[] {
  const ids: string[] = []
  for (const m of memory) {
    if (m.role !== 'assistant') continue
    ids.push(...extractBadgeIds(m.content))
  }
  return [...new Set(ids)]
}

async function getRecentBadgeIds(kv: KVNamespace | undefined, key: string): Promise<string[]> {
  const list = (await kvGetJson<string[]>(kv, key)) ?? []
  return Array.isArray(list) ? list.filter((x) => typeof x === 'string') : []
}

async function pushRecentBadgeId(kv: KVNamespace | undefined, key: string, badgeId: string): Promise<void> {
  if (!badgeId) return
  const current = await getRecentBadgeIds(kv, key)
  const next = [badgeId, ...current.filter((x) => x !== badgeId)].slice(0, 50)
  await kvPutJson(kv, key, next, { ttlSeconds: 60 * 60 * 24 * 45 }) // 45 дней
}

async function selectBadgeCandidate(params: {
  env: NeuroValyushaBindings
  kv: KVNamespace | undefined
  platform: 'vk' | 'tg'
  searchText: string
  threadMemory?: MemoryMessage[]
}): Promise<BadgeIndexEntry | null> {
  const { env, kv, platform, searchText, threadMemory } = params

  const index = await loadBadgeIndex(env)
  if (!index.length) return null

  const scored = scoreBadges(index, searchText)
  const top = scored[0]
  if (!top || top.score <= 0) return null

  // “Упоминать значок только если он реально ложится” → достаточно строгий порог
  const isStrong = top.score >= 8 || (top.score >= 6 && top.titleHits > 0)
  if (!isStrong) return null

  const avoid = new Set<string>()

  // Глобальная ротация, чтобы не повторяться по кругу
  const recentKey = platform === 'vk' ? 'nv:vk:recentBadges' : 'nv:tg:recentBadges'
  const recent = await getRecentBadgeIds(kv, recentKey)
  for (const id of recent) avoid.add(id)

  // Внутри одной ветки — тоже стараемся не повторять
  if (threadMemory && threadMemory.length) {
    for (const id of extractBadgeIdsFromMemory(threadMemory)) avoid.add(id)
  }

  // Не падаем в “слабые” кандидаты: берём только верхушку списка
  const topSlice = scored.slice(0, 12)
  const minScore = Math.max(5, top.score - 2)

  const strongCandidates = topSlice.filter((x) => x.score >= minScore)
  const pool = strongCandidates.length ? strongCandidates : topSlice

  const picked = pool.find((x) => !avoid.has(x.badge.id))?.badge ?? top.badge
  return picked
}

function buildMessagesForNewPost(platform: 'vk' | 'tg', postText: string): OpenAIChatMessage[] {
  const clipped = truncate(postText.trim(), 1800)
  return [
    { role: 'system', content: NEUROVALYUSHA_SOCIAL_SYSTEM },
    {
      role: 'system',
      content:
        platform === 'vk'
          ? 'СЕЙЧАС: напиши один комментарий к новому посту ВК (2–4 коротких абзаца, 400–900 знаков, 0–3 эмодзи, без markdown). В конце можно 1 вопрос.'
          : 'СЕЙЧАС: напиши один комментарий к новому посту в Telegram (2–4 коротких абзаца, 400–900 знаков, 0–3 эмодзи, без markdown). В конце можно 1 вопрос.',
    },
    { role: 'user', content: `Текст поста:\n${clipped}` },
  ]
}

function buildMessagesForReply(
  platform: 'vk' | 'tg',
  memory: MemoryMessage[],
): OpenAIChatMessage[] {
  return [
    { role: 'system', content: NEUROVALYUSHA_SOCIAL_SYSTEM },
    {
      role: 'system',
      content:
        platform === 'vk'
          ? 'СЕЙЧАС: ответь как комментарий ВК, учитывая контекст переписки выше. 2–4 коротких абзаца, 200–900 знаков, 0–3 эмодзи, без markdown. Не повторяй дословно чужие слова.'
          : 'СЕЙЧАС: ответь как комментарий в Telegram, учитывая контекст переписки выше. 2–4 коротких абзаца, 200–900 знаков, 0–3 эмодзи, без markdown. Не повторяй дословно чужие слова.',
    },
    ...memory.map((m) => ({ role: m.role, content: m.content })),
  ]
}

async function generateValyushaText(
  env: NeuroValyushaBindings,
  messages: OpenAIChatMessage[],
  opts?: { temperature?: number; maxTokens?: number; platform?: 'vk' | 'tg' },
): Promise<string> {
  const apiKey = env.OPENAI_API_KEY
  if (!apiKey) {
    return 'Спасибо за тему! 💜 Давайте развернём её в сторону 4K‑навыков: что здесь про критическое мышление/креатив/команду?'
  }
  // VK: не используем proxy (как в коммите a8ccff7, когда бот заработал)
  // Telegram: может использовать proxy если настроен
  const useProxy = opts?.platform !== 'vk'
  const proxyBaseUrl = useProxy && isNonEmptyString(env.OPENAI_PROXY_BASE_URL) ? env.OPENAI_PROXY_BASE_URL : undefined
  const proxyToken = useProxy && isNonEmptyString(env.OPENAI_PROXY_TOKEN) ? env.OPENAI_PROXY_TOKEN : undefined
  const raw = await callOpenAIChat({
    apiKey,
    model: NEUROVALYUSHA_MODEL,
    messages,
    temperature: typeof opts?.temperature === 'number' ? opts.temperature : 0.75,
    maxTokens: typeof opts?.maxTokens === 'number' ? opts.maxTokens : 450,
    baseUrl: proxyBaseUrl,
    proxyToken,
  })
  return raw || 'Классная мысль! 💜 А как вы думаете, какая 4K‑навык тут прокачивается сильнее всего?'
}

// ---------------- VK ----------------

export function getVkConfirmationResponse(env: NeuroValyushaBindings, payload: VkCallbackPayload): string | null {
  if (payload?.type !== 'confirmation') return null
  return env.VK_CONFIRMATION_CODE || ''
}

export function isValidVkRequest(env: NeuroValyushaBindings, payload: VkCallbackPayload): boolean {
  if (!payload || typeof payload !== 'object') return false

  // If configured, enforce group_id match
  if (isNonEmptyString(env.VK_GROUP_ID) && typeof payload.group_id === 'number') {
    const expected = Number(env.VK_GROUP_ID)
    if (Number.isFinite(expected) && expected > 0 && payload.group_id !== expected) return false
  }

  // If configured, enforce secret match
  if (isNonEmptyString(env.VK_SECRET)) {
    if (!isNonEmptyString(payload.secret)) return false
    if (payload.secret !== env.VK_SECRET) return false
  }

  return true
}

export async function processVkCallbackEvent(env: NeuroValyushaBindings, payload: VkCallbackPayload): Promise<void> {
  const kv = env.NEUROVALYUSHA_KV
  const type = payload.type || ''
  const object = payload.object || {}

  const dedupeId =
    payload.event_id ||
    `${type}:${String(object?.id ?? '')}:${String(object?.post_id ?? '')}:${String(object?.owner_id ?? '')}`
  const dedupeKey = `nv:vk:dedupe:${dedupeId}`
  if (await kvIsDuplicate(kv, dedupeKey, { ttlSeconds: 60 * 60 * 24 })) return

  // Debug breadcrumb: prove the worker actually processed the event (even if it later returns early)
  await kvPutJson(
    kv,
    'nv:vk:lastEvent',
    {
      ts: nowTs(),
      type,
      event_id: payload.event_id,
      object_id: object?.id,
      post_id: object?.post_id,
      owner_id: object?.owner_id,
    },
    { ttlSeconds: 60 * 60 * 24 * 14 },
  )

  if (type === 'wall_post_new') {
    const postId = Number(object?.id)
    const ownerId = Number(object?.owner_id) || (isNonEmptyString(env.VK_GROUP_ID) ? -Number(env.VK_GROUP_ID) : 0)
    const postText = isNonEmptyString(object?.text) ? object.text : ''
    if (!Number.isFinite(postId) || postId <= 0) {
      await kvPutJson(kv, 'nv:vk:lastWallPostNew', { ts: nowTs(), ok: false, reason: 'bad_post_id', postId }, { ttlSeconds: 60 * 60 * 24 * 14 })
      return
    }
    if (!Number.isFinite(ownerId) || ownerId === 0) {
      await kvPutJson(kv, 'nv:vk:lastWallPostNew', { ts: nowTs(), ok: false, reason: 'bad_owner_id', ownerId }, { ttlSeconds: 60 * 60 * 24 * 14 })
      return
    }
    if (!isNonEmptyString(env.VK_ACCESS_TOKEN)) {
      await kvPutJson(
        kv,
        'nv:vk:lastWallPostNew',
        { ts: nowTs(), ok: false, reason: 'missing_vk_access_token', ownerId, postId },
        { ttlSeconds: 60 * 60 * 24 * 14 },
      )
      return
    }

    const postKey = `nv:vk:post:${ownerId}:${postId}:commented`
    const already = await kvGetText(kv, postKey)
    if (already) {
      await kvPutJson(
        kv,
        'nv:vk:lastWallPostNew',
        { ts: nowTs(), ok: true, skipped: true, reason: 'already_commented', ownerId, postId, existing: already },
        { ttlSeconds: 60 * 60 * 24 * 14 },
      )
      return
    }

    const conversationKey = `nv:vk:conv:${ownerId}:${postId}`

    // Store the post context (as "user" message)
    await appendConversationMemory(kv, conversationKey, {
      role: 'user',
      content: `Пост (ВК): ${truncate(postText || '(без текста)', 1800)}`,
      ts: nowTs(),
    })

    const selectedBadge = await selectBadgeCandidate({
      env,
      kv,
      platform: 'vk',
      searchText: postText || '',
    })

    const aiMessages = [
      ...buildMessagesForNewPost('vk', postText || ''),
      ...(selectedBadge
        ? [
            {
              role: 'system' as const,
              content: `В этом комментарии упомяни ровно один значок Путеводителя (ID + название), он хорошо подходит к теме поста:\n- ${selectedBadge.id} «${selectedBadge.title}»\nНе упоминай другие значки.`,
            },
          ]
        : [
            {
              role: 'system' as const,
              content: 'Для этого комментария значок не подходит — НЕ упоминай значки Путеводителя.',
            },
          ]),
    ]
    // VK: используем старую версию без опций (как в a8ccff7, когда бот заработал)
    const comment = normalizeOutgoingText(await generateValyushaText(env, aiMessages, { platform: 'vk' }), 1200)
    const vkComment = withVkPrefix(comment)

    const commentId = await vkCreateComment({
      kv,
      accessToken: env.VK_ACCESS_TOKEN,
      ownerId,
      postId,
      message: vkComment,
      guid: dedupeId,
      replyToCommentId: undefined,
    })

    if (commentId) {
      await kvPutText(kv, postKey, String(commentId), { ttlSeconds: 60 * 60 * 24 * 30 })
      await kvPutText(kv, `nv:vk:myComment:${commentId}`, '1', { ttlSeconds: 60 * 60 * 24 * 60 })
      if (selectedBadge) await pushRecentBadgeId(kv, 'nv:vk:recentBadges', selectedBadge.id)
      await kvPutJson(
        kv,
        'nv:vk:lastWallPostNew',
        { ts: nowTs(), ok: true, ownerId, postId, commentId, badgeId: selectedBadge?.id },
        { ttlSeconds: 60 * 60 * 24 * 14 },
      )
    } else {
      await kvPutJson(
        kv,
        'nv:vk:lastWallPostNew',
        { ts: nowTs(), ok: false, reason: 'vk_create_comment_failed', ownerId, postId, badgeId: selectedBadge?.id },
        { ttlSeconds: 60 * 60 * 24 * 14 },
      )
    }

    // Store without the technical VK prefix to keep the LLM context clean.
    await appendConversationMemory(kv, conversationKey, { role: 'assistant', content: comment, ts: nowTs() })
    return
  }

  if (type === 'wall_reply_new') {
    const commentId = Number(object?.id)
    const postId = Number(object?.post_id)
    const ownerId = Number(object?.owner_id) || (isNonEmptyString(env.VK_GROUP_ID) ? -Number(env.VK_GROUP_ID) : 0)
    const fromId = Number(object?.from_id)
    const replyToCommentId = Number(object?.reply_to_comment) || undefined
    const text = isNonEmptyString(object?.text) ? object.text : ''
    if (!Number.isFinite(commentId) || commentId <= 0) return
    if (!Number.isFinite(postId) || postId <= 0) return
    if (!Number.isFinite(ownerId) || ownerId === 0) return
    if (!isNonEmptyString(env.VK_ACCESS_TOKEN)) {
      await kvPutJson(
        kv,
        'nv:vk:lastWallReplyNew',
        { ts: nowTs(), ok: false, reason: 'missing_vk_access_token', ownerId, postId, commentId },
        { ttlSeconds: 60 * 60 * 24 * 14 },
      )
      return
    }

    // Ignore our own comments (community author id is negative group id)
    if (Number.isFinite(fromId) && isNonEmptyString(env.VK_GROUP_ID) && fromId === -Number(env.VK_GROUP_ID)) return

    const isReplyToUs =
      typeof replyToCommentId === 'number' && replyToCommentId > 0
        ? Boolean(await kvGetText(kv, `nv:vk:myComment:${replyToCommentId}`))
        : false

    if (!isReplyToUs && !shouldReplyToText(text)) {
      await kvPutJson(
        kv,
        'nv:vk:lastWallReplyNew',
        { ts: nowTs(), ok: true, skipped: true, reason: 'no_trigger', ownerId, postId, commentId },
        { ttlSeconds: 60 * 60 * 24 * 14 },
      )
      return
    }

    const conversationKey = `nv:vk:conv:${ownerId}:${postId}`
    await appendConversationMemory(kv, conversationKey, {
      role: 'user',
      content: `Комментарий участника (ВК): ${truncate(text || '(без текста)', 1200)}`,
      ts: nowTs(),
    })

    const memory = await getConversationMemory(kv, conversationKey, { limit: 10 })
    const searchText = [text || '', ...memory.map((m) => m.content)].join('\n')
    const selectedBadge = await selectBadgeCandidate({
      env,
      kv,
      platform: 'vk',
      searchText,
      threadMemory: memory,
    })

    const aiMessages = [
      ...buildMessagesForReply('vk', memory),
      ...(selectedBadge
        ? [
            {
              role: 'system' as const,
              content: `Если это реально уместно в ответе, можешь упомянуть один значок (ID + название):\n- ${selectedBadge.id} «${selectedBadge.title}»\nЕсли не уместно — не упоминай значки вообще.`,
            },
          ]
        : [
            {
              role: 'system' as const,
              content: 'Значок к этой реплике не подходит — НЕ упоминай значки Путеводителя.',
            },
          ]),
    ]
    // VK: используем старую версию без опций (как в a8ccff7, когда бот заработал)
    const reply = normalizeOutgoingText(await generateValyushaText(env, aiMessages, { platform: 'vk' }), 1200)
    const vkReply = withVkPrefix(reply)

    const newCommentId = await vkCreateComment({
      kv,
      accessToken: env.VK_ACCESS_TOKEN,
      ownerId,
      postId,
      message: vkReply,
      guid: dedupeId,
      replyToCommentId: commentId,
    })

    if (newCommentId) {
      await kvPutText(kv, `nv:vk:myComment:${newCommentId}`, '1', { ttlSeconds: 60 * 60 * 24 * 60 })
      if (selectedBadge) await pushRecentBadgeId(kv, 'nv:vk:recentBadges', selectedBadge.id)
      await kvPutJson(
        kv,
        'nv:vk:lastWallReplyNew',
        { ts: nowTs(), ok: true, ownerId, postId, replyTo: commentId, commentId: newCommentId, badgeId: selectedBadge?.id },
        { ttlSeconds: 60 * 60 * 24 * 14 },
      )
    } else {
      await kvPutJson(
        kv,
        'nv:vk:lastWallReplyNew',
        { ts: nowTs(), ok: false, reason: 'vk_create_comment_failed', ownerId, postId, replyTo: commentId, badgeId: selectedBadge?.id },
        { ttlSeconds: 60 * 60 * 24 * 14 },
      )
    }

    // Store without the technical VK prefix to keep the LLM context clean.
    await appendConversationMemory(kv, conversationKey, { role: 'assistant', content: reply, ts: nowTs() })
    return
  }
}

async function vkCreateComment(params: {
  kv?: KVNamespace
  accessToken: string
  ownerId: number
  postId: number
  message: string
  guid: string
  replyToCommentId?: number
}): Promise<number | null> {
  const { kv, accessToken, ownerId, postId, message, guid, replyToCommentId } = params
  const url = new URL('https://api.vk.com/method/wall.createComment')
  const qs = new URLSearchParams()

  qs.set('owner_id', String(ownerId))
  qs.set('post_id', String(postId))
  qs.set('from_group', '1')
  qs.set('message', message)
  qs.set('guid', guid)
  // Reply directly to a comment when possible
  if (typeof replyToCommentId === 'number' && Number.isFinite(replyToCommentId) && replyToCommentId > 0) {
    qs.set('reply_to_comment', String(replyToCommentId))
  }

  qs.set('access_token', accessToken)
  // Use a modern VK API version (match Callback API server settings)
  qs.set('v', '5.199')

  // Send params in POST body (avoid URL length limits)
  const res = await fetch(url.toString(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
    body: qs.toString(),
  })

  const text = await res.text().catch(() => '')
  const data = (() => {
    try {
      return JSON.parse(text) as any
    } catch {
      return null
    }
  })()

  const commentId = Number(data?.response?.comment_id)
  if (Number.isFinite(commentId) && commentId > 0) return commentId

  // Store last error for quick debugging (no tokens, no full message)
  const err = data?.error
  if (kv) {
    const safeParams = Array.isArray(err?.request_params)
      ? err.request_params.filter((p: any) => p?.key !== 'access_token' && p?.key !== 'message')
      : undefined

    await kvPutJson(
      kv,
      'nv:vk:lastCreateCommentError',
      {
        ts: nowTs(),
        ownerId,
        postId,
        httpStatus: res.status,
        error_code: err?.error_code,
        error_msg: err?.error_msg,
        request_params: safeParams,
        raw: typeof text === 'string' ? text.slice(0, 2000) : undefined,
      },
      { ttlSeconds: 60 * 60 * 24 * 7 },
    )
  }
  return null
}

// ---------------- Telegram ----------------

export function isValidTelegramRequest(env: NeuroValyushaBindings, secretHeader: string | undefined): boolean {
  if (!isNonEmptyString(env.TELEGRAM_WEBHOOK_SECRET)) {
    // If secret is not configured, allow (dev), but production should set it.
    return true
  }
  return isNonEmptyString(secretHeader) && secretHeader === env.TELEGRAM_WEBHOOK_SECRET
}

export async function processTelegramUpdate(env: NeuroValyushaBindings, update: TgUpdate): Promise<void> {
  const kv = env.NEUROVALYUSHA_KV
  const updateId = typeof update?.update_id === 'number' ? update.update_id : null
  const dedupeKey = updateId !== null ? `nv:tg:dedupe:${updateId}` : `nv:tg:dedupe:${nowTs()}`
  if (await kvIsDuplicate(kv, dedupeKey, { ttlSeconds: 60 * 60 * 24 })) return

  const msg = update.message || update.channel_post || update.edited_message
  if (!msg) return
  if (msg.from?.is_bot) return
  if (!isNonEmptyString(env.TELEGRAM_BOT_TOKEN)) return

  const chatId = Number(msg.chat?.id)
  if (!Number.isFinite(chatId)) return

  // Optional: hard-limit to a specific discussion group (prevents reacting in DMs/other chats)
  const allowedGroupIdRaw = env.TELEGRAM_DISCUSSION_GROUP_ID || env.DISCUSSION_GROUP_ID
  if (isNonEmptyString(allowedGroupIdRaw)) {
    const allowedGroupId = Number(allowedGroupIdRaw)
    if (Number.isFinite(allowedGroupId) && allowedGroupId !== chatId) return
  }

  const text = (msg.text || msg.caption || '').trim()

  // New channel post forwarded into discussion group
  if (msg.is_automatic_forward && msg.forward_from_chat?.id) {
    // Optional: limit to a specific channel
    if (isNonEmptyString(env.TELEGRAM_CHANNEL_ID) && Number(env.TELEGRAM_CHANNEL_ID) !== msg.forward_from_chat.id) {
      return
    }
    // Optional: limit to a specific channel by username (handy when you only have @name)
    if (isNonEmptyString(env.TELEGRAM_CHANNEL_ID_USERNAME)) {
      const expected = env.TELEGRAM_CHANNEL_ID_USERNAME.trim().replace(/^@/, '').toLowerCase()
      const actual = (msg.forward_from_chat.username || '').trim().replace(/^@/, '').toLowerCase()
      if (!expected || !actual || expected !== actual) return
    }

    const rootId = msg.message_id
    const postKey = `nv:tg:post:${chatId}:${rootId}:commented`
    const already = await kvGetText(kv, postKey)
    if (already) return

    const conversationKey = `nv:tg:conv:${chatId}:${rootId}`

    await appendConversationMemory(kv, conversationKey, {
      role: 'user',
      content: `Пост (Telegram): ${truncate(text || '(без текста)', 1800)}`,
      ts: nowTs(),
    })

    const selectedBadge = await selectBadgeCandidate({
      env,
      kv,
      platform: 'tg',
      searchText: text || '',
    })

    const aiMessages = [
      ...buildMessagesForNewPost('tg', text || ''),
      ...(selectedBadge
        ? [
            {
              role: 'system' as const,
              content: `В этом комментарии упомяни ровно один значок Путеводителя (ID + название), он хорошо подходит к теме поста:\n- ${selectedBadge.id} «${selectedBadge.title}»\nНе упоминай другие значки.`,
            },
          ]
        : [
            {
              role: 'system' as const,
              content: 'Для этого комментария значок не подходит — НЕ упоминай значки Путеводителя.',
            },
          ]),
    ]
    const commentRaw = await generateValyushaText(env, aiMessages, { temperature: 0.75, maxTokens: 450, platform: 'tg' })
    const comment = normalizeOutgoingText(commentRaw, 1200)

    const sent = await tgSendMessage({
      botToken: env.TELEGRAM_BOT_TOKEN,
      chatId,
      text: comment,
      replyToMessageId: rootId,
      kv,
    })

    if (sent?.message_id) {
      await kvPutText(kv, postKey, String(sent.message_id), { ttlSeconds: 60 * 60 * 24 * 30 })
      await kvPutText(kv, `nv:tg:myMessage:${chatId}:${sent.message_id}`, '1', { ttlSeconds: 60 * 60 * 24 * 60 })
      if (selectedBadge) await pushRecentBadgeId(kv, 'nv:tg:recentBadges', selectedBadge.id)
    }

    await kvPutText(kv, `nv:tg:root:${chatId}:${rootId}`, String(rootId), { ttlSeconds: 60 * 60 * 24 * 60 })
    await appendConversationMemory(kv, conversationKey, { role: 'assistant', content: comment, ts: nowTs() })
    return
  }

  // Comment in discussion group (reply chain)
  if (msg.reply_to_message) {
    const parentId = msg.reply_to_message.message_id
    const rootId = await resolveTelegramRootId(kv, chatId, msg.reply_to_message)
    const conversationKey = `nv:tg:conv:${chatId}:${rootId}`

    // Mark this message's root id for future nested replies
    await kvPutText(kv, `nv:tg:root:${chatId}:${msg.message_id}`, String(rootId), { ttlSeconds: 60 * 60 * 24 * 60 })

    const isReplyToUs = Boolean(await kvGetText(kv, `nv:tg:myMessage:${chatId}:${parentId}`))
    if (!isReplyToUs && !shouldReplyToText(text)) return

    await appendConversationMemory(kv, conversationKey, {
      role: 'user',
      content: `Комментарий участника (Telegram): ${truncate(text || '(без текста)', 1200)}`,
      ts: nowTs(),
    })

    const memory = await getConversationMemory(kv, conversationKey, { limit: 10 })
    const searchText = [text || '', ...memory.map((m) => m.content)].join('\n')
    const selectedBadge = await selectBadgeCandidate({
      env,
      kv,
      platform: 'tg',
      searchText,
      threadMemory: memory,
    })

    const aiMessages = [
      ...buildMessagesForReply('tg', memory),
      ...(selectedBadge
        ? [
            {
              role: 'system' as const,
              content: `Если это реально уместно в ответе, можешь упомянуть один значок (ID + название):\n- ${selectedBadge.id} «${selectedBadge.title}»\nЕсли не уместно — не упоминай значки вообще.`,
            },
          ]
        : [
            {
              role: 'system' as const,
              content: 'Значок к этой реплике не подходит — НЕ упоминай значки Путеводителя.',
            },
          ]),
    ]
    const replyRaw = await generateValyushaText(env, aiMessages, { temperature: 0.75, maxTokens: 450, platform: 'tg' })
    const reply = normalizeOutgoingText(replyRaw, 1200)

    const sent = await tgSendMessage({
      botToken: env.TELEGRAM_BOT_TOKEN,
      chatId,
      text: reply,
      replyToMessageId: msg.message_id,
      kv,
    })

    if (sent?.message_id) {
      await kvPutText(kv, `nv:tg:myMessage:${chatId}:${sent.message_id}`, '1', { ttlSeconds: 60 * 60 * 24 * 60 })
      if (selectedBadge) await pushRecentBadgeId(kv, 'nv:tg:recentBadges', selectedBadge.id)
    }

    await appendConversationMemory(kv, conversationKey, { role: 'assistant', content: reply, ts: nowTs() })
    return
  }
}

async function resolveTelegramRootId(kv: KVNamespace | undefined, chatId: number, parent: TgMessage): Promise<number> {
  // If parent is the auto-forward (root), use it
  if (parent.is_automatic_forward) return parent.message_id

  // Otherwise try to look up stored root mapping
  const mapped = await kvGetText(kv, `nv:tg:root:${chatId}:${parent.message_id}`)
  const mappedNum = mapped ? Number(mapped) : NaN
  if (Number.isFinite(mappedNum) && mappedNum > 0) return mappedNum

  // Fallback: treat parent as root (best effort)
  return parent.message_id
}

async function tgSendMessage(params: {
  botToken: string
  chatId: number
  text: string
  replyToMessageId?: number
  kv?: KVNamespace
}): Promise<{ message_id: number } | null> {
  const { botToken, chatId, text, replyToMessageId, kv } = params
  const url = `https://api.telegram.org/bot${botToken}/sendMessage`

  const body: any = {
    chat_id: chatId,
    text,
    disable_web_page_preview: true,
  }
  if (typeof replyToMessageId === 'number' && Number.isFinite(replyToMessageId)) {
    body.reply_to_message_id = replyToMessageId
    body.allow_sending_without_reply = true
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  const data = (await res.json().catch(() => null)) as any
  const mid = Number(data?.result?.message_id)
  if (Number.isFinite(mid) && mid > 0) return { message_id: mid }

  // Store last send error for quick debugging (no secrets)
  if (kv) {
    await kvPutJson(
      kv,
      'nv:tg:lastSendError',
      {
        ts: nowTs(),
        chatId,
        replyToMessageId: typeof replyToMessageId === 'number' ? replyToMessageId : undefined,
        httpStatus: res.status,
        error_code: data?.error_code,
        description: data?.description,
        // Avoid storing full generated text; keep only a tiny preview
        textPreview: typeof text === 'string' ? text.slice(0, 160) : undefined,
        raw: typeof data === 'object' && data ? JSON.stringify(data).slice(0, 2000) : undefined,
      },
      { ttlSeconds: 60 * 60 * 24 * 14 },
    )
  }
  return null
}


