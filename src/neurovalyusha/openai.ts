export type OpenAIChatMessage = {
  role: 'system' | 'user' | 'assistant'
  content: string
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
}): Promise<string> {
  const { apiKey, model, messages, temperature = 0.7, maxTokens = 700 } = params

  const openaiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
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


