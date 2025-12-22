import type { KVNamespace } from '@cloudflare/workers-types'

export async function kvGetJson<T>(kv: KVNamespace | undefined, key: string): Promise<T | null> {
  if (!kv) return null
  const raw = await kv.get(key)
  if (!raw) return null
  try {
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

export async function kvPutJson(
  kv: KVNamespace | undefined,
  key: string,
  value: unknown,
  params?: { ttlSeconds?: number },
): Promise<void> {
  if (!kv) return
  const ttlSeconds = params?.ttlSeconds
  if (ttlSeconds && ttlSeconds > 0) {
    await kv.put(key, JSON.stringify(value), { expirationTtl: ttlSeconds })
    return
  }
  await kv.put(key, JSON.stringify(value))
}

export async function kvPutText(
  kv: KVNamespace | undefined,
  key: string,
  value: string,
  params?: { ttlSeconds?: number },
): Promise<void> {
  if (!kv) return
  const ttlSeconds = params?.ttlSeconds
  if (ttlSeconds && ttlSeconds > 0) {
    await kv.put(key, value, { expirationTtl: ttlSeconds })
    return
  }
  await kv.put(key, value)
}

export async function kvGetText(kv: KVNamespace | undefined, key: string): Promise<string | null> {
  if (!kv) return null
  return await kv.get(key)
}

// Returns true when key was already present (duplicate). Otherwise marks it and returns false.
export async function kvIsDuplicate(
  kv: KVNamespace | undefined,
  key: string,
  params?: { ttlSeconds?: number },
): Promise<boolean> {
  if (!kv) return false
  const existing = await kv.get(key)
  if (existing) return true
  await kvPutText(kv, key, '1', { ttlSeconds: params?.ttlSeconds ?? 86400 })
  return false
}


