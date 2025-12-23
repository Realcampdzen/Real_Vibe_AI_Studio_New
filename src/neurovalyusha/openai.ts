export type OpenAIChatMessage = {
  role: 'system' | 'user' | 'assistant'
  content: string | Array<{ type: 'text' | 'image_url'; text?: string; image_url?: { url: string } }>
}

type OpenAIChatCompletionResponse = {
  choices?: Array<{ message?: { content?: string } }>
}

export async function callOpenAIChat(params: {
  apiKey: string
  model: string
  messages: OpenAIChatMessage[]
  temperature?: number
  maxTokens?: number
  baseUrl?: string
  proxyToken?: string
}): Promise<string> {
  const { apiKey, model, messages, temperature = 0.7, maxTokens = 700, baseUrl, proxyToken } = params
  const normalizedBaseUrl =
    typeof baseUrl === 'string' && baseUrl.trim().length > 0 ? baseUrl.trim().replace(/\/+$/, '') : 'https://api.openai.com'

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
  }
  if (typeof proxyToken === 'string' && proxyToken.trim().length > 0) {
    headers['X-Proxy-Token'] = proxyToken.trim()
  }

  const openaiResponse = await fetch(`${normalizedBaseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model,
      messages,
      temperature,
      max_tokens: maxTokens,
    }),
  })

  if (!openaiResponse.ok) {
    const details = await openaiResponse.text().catch(() => '')
    throw new Error(`OpenAI API request failed: ${openaiResponse.status} ${details}`)
  }

  const data = (await openaiResponse.json()) as OpenAIChatCompletionResponse
  const content = data.choices?.[0]?.message?.content
  return typeof content === 'string' ? content.trim() : ''
}


