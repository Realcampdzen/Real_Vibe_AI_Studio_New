import type { Fetcher } from '@cloudflare/workers-types'

export type BadgeIndexEntry = {
  id: string
  title: string
  emoji?: string
  categoryId?: string
  categoryTitle?: string
  description?: string
  skillTips?: string
}

export type ScoredBadge = {
  badge: BadgeIndexEntry
  score: number
  titleHits: number
}

type HasAssets = { ASSETS?: Fetcher }

let cachedIndex: BadgeIndexEntry[] | null = null
let cachedAt = 0

export async function loadBadgeIndex(env: HasAssets, params?: { maxAgeMs?: number }): Promise<BadgeIndexEntry[]> {
  const maxAgeMs = params?.maxAgeMs ?? 10 * 60 * 1000 // 10 минут
  if (cachedIndex && Date.now() - cachedAt < maxAgeMs) return cachedIndex

  const res = await fetchAsset(env, '/static/guidebook-badges-index.json')
  if (!res.ok) return cachedIndex ?? []
  const data = (await res.json().catch(() => null)) as unknown
  if (!Array.isArray(data)) return cachedIndex ?? []

  cachedIndex = data as BadgeIndexEntry[]
  cachedAt = Date.now()
  return cachedIndex
}

export function getSearchTokens(text: string): string[] {
  const q = normalize(text)
  const rawTokens = tokenize(q)

  const filtered = rawTokens
    .filter((t) => t.length >= 3)
    .filter((t) => !STOPWORDS.has(t))
    .filter((t) => !/^\d+$/.test(t))

  // de-dupe while preserving order
  const seen = new Set<string>()
  const unique: string[] = []
  for (const t of filtered) {
    if (seen.has(t)) continue
    seen.add(t)
    unique.push(t)
  }
  return unique.slice(0, 40)
}

export function scoreBadges(index: BadgeIndexEntry[], text: string): ScoredBadge[] {
  const tokens = getSearchTokens(text)
  if (tokens.length === 0) return []

  const boostedCategoryIds = getBoostedCategoryIds(tokens)

  return index
    .map((badge) => {
      const hay = normalize([badge.title, badge.description, badge.skillTips, badge.categoryTitle].filter(Boolean).join(' '))
      const titleHay = normalize(badge.title)

      let score = 0
      let titleHits = 0

      for (const t of tokens) {
        if (hay.includes(t)) score += 1
        if (titleHay.includes(t)) {
          score += 2
          titleHits += 1
        }
      }

      if (badge.categoryId && boostedCategoryIds.has(badge.categoryId)) score += 3
      return { badge, score, titleHits }
    })
    .sort((a, b) => b.score - a.score)
}

export function pickRelevantBadges(index: BadgeIndexEntry[], text: string, params?: { limit?: number }): BadgeIndexEntry[] {
  const limit = params?.limit ?? 5
  const scored = scoreBadges(index, text)
  return scored.filter((x) => x.score > 0).slice(0, limit).map((x) => x.badge)
}

export function formatBadgeSuggestions(badges: BadgeIndexEntry[]): string {
  if (!badges.length) return ''
  const lines = badges.map((b) => {
    const desc = (b.description || b.skillTips || '').trim().replace(/\s+/g, ' ')
    const snippet = desc.length > 140 ? `${desc.slice(0, 140).trim()}…` : desc
    const title = b.title.replace(/\s+/g, ' ').trim()
    const emoji = b.emoji ? `${b.emoji} ` : ''
    const extra = snippet ? ` — ${snippet}` : ''
    return `- ${emoji}${b.id} «${title}»${extra}`
  })
  return lines.join('\n')
}

async function fetchAsset(env: HasAssets, pathname: string): Promise<Response> {
  // Cloudflare Pages runtime provides ASSETS binding
  if (env.ASSETS) {
    return await env.ASSETS.fetch(new Request(`http://localhost${pathname}`))
  }
  // Best-effort fallback for non-pages envs
  return await fetch(pathname)
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^\p{L}\p{N}\s]+/gu, ' ').replace(/\s+/g, ' ').trim()
}

function tokenize(s: string): string[] {
  return s.split(' ').filter(Boolean)
}

const STOPWORDS = new Set([
  // RU function words
  'и',
  'а',
  'но',
  'или',
  'что',
  'как',
  'это',
  'этот',
  'эта',
  'эти',
  'так',
  'же',
  'то',
  'мы',
  'вы',
  'они',
  'она',
  'он',
  'оно',
  'я',
  'ты',
  'у',
  'в',
  'на',
  'по',
  'про',
  'для',
  'без',
  'из',
  'от',
  'до',
  'при',
  'над',
  'под',
  'если',
  'когда',
  'тогда',
  'тоже',
  'ещё',
  'уже',
  'очень',
  'просто',
  'сейчас',
  'сегодня',
  'вчера',
  'завтра',
  // common social noise
  'пост',
  'поста',
  'посты',
  'коммент',
  'комментари',
  'комментарий',
  'комментарии',
  // camp common words (слишком общие, чтобы выбирать значок)
  'лагерь',
  'лагеря',
  'смена',
  'смены',
  'дети',
  'ребята',
  'подростки',
])

function getBoostedCategoryIds(tokens: string[]): Set<string> {
  const t = new Set(tokens)
  const boosted = new Set<string>()

  // 12 — ИИ/нейросети (в путеводителе)
  if (t.has('ии') || t.has('нейросети') || t.has('нейросеть') || t.has('ai') || t.has('gpt') || t.has('чатгпт')) {
    boosted.add('12')
  }
  // 13 — софт‑скиллы (в путеводителе)
  if (t.has('софт') || t.has('soft') || t.has('команда') || t.has('команд') || t.has('коммуникация') || t.has('общение')) {
    boosted.add('13')
  }
  // 11 — осознанность/рефлексия
  if (t.has('осознанность') || t.has('рефлексия') || t.has('эмоции') || t.has('эмпатия')) {
    boosted.add('11')
  }

  return boosted
}


