import { Hono } from 'hono'
import { serveStatic } from 'hono/cloudflare-workers'
import { renderer } from './renderer'

type Bindings = {
  OPENAI_API_KEY?: string;
}

const app = new Hono<{ Bindings: Bindings }>()

const MODEL = 'gpt-4o'

const BRO_SYSTEM = `Ты - Кот Бро 🐱, рыжий AI-помощник студии "Реальный Вайб AI Studio".
Стиль: дружелюбно, иронично, простым языком, можно эмодзи. Не используй markdown (**, __ и т.п.).
Всегда мягко веди к заказу и контакту: @Stivanovv.
Цены: боты от 18 000₽, срок ~2 недели.`

const HIPYCH_SYSTEM = `Ты — Хипыч 🎮, геймерский персона-бот Real Vibe AI Studio.
Стиль: энергично, геймерский сленг, 40-80 слов. Не используй markdown (**, __ и т.п.). Эмодзи 🎮🔥💻⚡🏆🎯😎.
Продвигай: игровые боты от 15 000₽, стриминг-автоматизация от 25 000₽, AI для игр от 35 000₽.
Для заказа направляй к @Stivanovv.`

const VALYUSHA_SYSTEM = `Ты — НейроВалюша 💜, дружелюбная вожатая/педагогический AI-бот Real Vibe AI Studio.
Стиль: тепло, поддерживающе, 50-100 слов. Не используй markdown (**, __ и т.п.). Эмодзи 💜🔥✨📚🎯🌟🤗.
Показывай пользу персона-ботов и веди к контакту @Stivanovv.`

function isAllowedOrigin(origin: string): boolean {
  if (!origin) return false

  const allowExact = new Set([
    'https://real-vibe.studio',
    'https://www.real-vibe.studio',
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    'https://realcampdzen.github.io',
    'https://real-vibe-ai-studio.pages.dev',
  ])

  if (allowExact.has(origin)) return true

  // Allow preview deployments like https://b7b8e117.real-vibe-ai-studio.pages.dev
  try {
    const url = new URL(origin)
    return url.hostname.endsWith('.real-vibe-ai-studio.pages.dev')
  } catch {
    return false
  }
}

function applyCorsHeaders(c: any) {
  const origin = c.req.header('origin') || ''

  if (isAllowedOrigin(origin)) {
    c.header('Access-Control-Allow-Origin', origin)
    c.header('Vary', 'Origin')
  }

  c.header('Access-Control-Allow-Methods', 'POST, OPTIONS')
  c.header('Access-Control-Allow-Headers', 'Content-Type')
  c.header('Access-Control-Max-Age', '86400')
}

// CORS for NIC.RU/other frontends calling Pages API
app.use('/api/*', async (c, next) => {
  applyCorsHeaders(c)
  if (c.req.method === 'OPTIONS') return c.body(null, 204)
  await next()
})

// Alias endpoint (old frontend calls /chat)
app.use('/chat', async (c, next) => {
  applyCorsHeaders(c)
  if (c.req.method === 'OPTIONS') return c.body(null, 204)
  await next()
})

// Serve static files from public directory
app.use('/static/*', serveStatic({ root: './public' }))

// Use renderer for HTML pages
app.use(renderer)

// Main page
app.get('/', (c) => {
  return c.render(
    <div>
      {/* Header */}
      <header class="site-header">
        <nav class="navbar fixed top-0 left-0 right-0 bg-indigo-600 text-white shadow-lg z-50">
          <div class="container mx-auto px-6 py-4">
            <div class="flex items-center justify-between">
              <div class="flex items-center space-x-4">
                <div class="text-2xl font-bold">
                  <span class="text-sm">Реальный Vайб</span>
                  <div class="text-3xl">AI Studio</div>
                </div>
              </div>
              <div class="hidden md:flex items-center space-x-6">
                <a href="#about" class="hover:text-indigo-200 transition">О нас</a>
                <a href="#services" class="hover:text-indigo-200 transition">Услуги</a>
                <a href="#works" class="hover:text-indigo-200 transition">Работы</a>
                <a href="#contact" class="hover:text-indigo-200 transition">Контакты</a>
              </div>
            </div>
          </div>
        </nav>
      </header>

      {/* Hero Section */}
      <main class="pt-24">
        <section id="hero" class="min-h-screen bg-gradient-to-br from-indigo-600 via-purple-600 to-pink-500 text-white flex items-center justify-center">
          <div class="container mx-auto px-6 text-center">
            <h1 class="text-5xl md:text-7xl font-bold mb-6">
              Персональные AI-решения<br />для вашего бизнеса
            </h1>
            <p class="text-xl md:text-2xl mb-12 max-w-3xl mx-auto">
              Создаем умных ботов, автоматизируем процессы и внедряем нейросети. 
              Персональный подход и результат 24/7.
            </p>
            <button 
              onclick="openChat()" 
              class="bg-white text-indigo-600 px-8 py-4 rounded-full text-lg font-semibold hover:bg-indigo-50 transition transform hover:scale-105"
            >
              Поговорить с AI-помощником 🐱
            </button>
          </div>
        </section>

        {/* About Section */}
        <section id="about" class="py-20 bg-white">
          <div class="container mx-auto px-6">
            <h2 class="text-4xl font-bold text-center mb-12 text-gray-800">
              Что мы делаем
            </h2>
            <div class="grid md:grid-cols-3 gap-8">
              <div class="text-center p-6 rounded-lg border-2 border-indigo-100 hover:border-indigo-300 transition">
                <div class="text-5xl mb-4">🤖</div>
                <h3 class="text-2xl font-semibold mb-4">AI-боты</h3>
                <p class="text-gray-600">
                  Умные помощники для сайтов и Telegram с уникальным характером
                </p>
              </div>
              <div class="text-center p-6 rounded-lg border-2 border-indigo-100 hover:border-indigo-300 transition">
                <div class="text-5xl mb-4">⚡</div>
                <h3 class="text-2xl font-semibold mb-4">Автоматизация</h3>
                <p class="text-gray-600">
                  Оптимизация бизнес-процессов с помощью нейросетей
                </p>
              </div>
              <div class="text-center p-6 rounded-lg border-2 border-indigo-100 hover:border-indigo-300 transition">
                <div class="text-5xl mb-4">🎯</div>
                <h3 class="text-2xl font-semibold mb-4">Интеграция</h3>
                <p class="text-gray-600">
                  Внедрение AI-решений в существующие системы
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Services Section */}
        <section id="services" class="py-20 bg-gray-50">
          <div class="container mx-auto px-6">
            <h2 class="text-4xl font-bold text-center mb-12 text-gray-800">
              Наши услуги
            </h2>
            <div class="max-w-4xl mx-auto space-y-6">
              <div class="bg-white p-8 rounded-lg shadow-lg hover:shadow-xl transition">
                <h3 class="text-2xl font-semibold mb-4 text-indigo-600">
                  <i class="fas fa-robot mr-2"></i>
                  Разработка AI-ботов
                </h3>
                <p class="text-gray-600 mb-4">
                  Создаем уникальных AI-помощников с характером для вашего бизнеса. 
                  От простых чат-ботов до сложных персонажей с памятью и эмоциями.
                </p>
                <div class="text-sm text-gray-500">
                  <strong>Стоимость:</strong> от 18 000₽ | <strong>Срок:</strong> 2 недели
                </div>
              </div>

              <div class="bg-white p-8 rounded-lg shadow-lg hover:shadow-xl transition">
                <h3 class="text-2xl font-semibold mb-4 text-indigo-600">
                  <i class="fas fa-brain mr-2"></i>
                  Интеграция нейросетей
                </h3>
                <p class="text-gray-600 mb-4">
                  Подключаем GPT-4, DALL-E, Midjourney и другие AI-инструменты к вашим процессам.
                  Автоматизируем рутину и увеличиваем продуктивность.
                </p>
                <div class="text-sm text-gray-500">
                  <strong>Стоимость:</strong> от 25 000₽ | <strong>Срок:</strong> 2-3 недели
                </div>
              </div>

              <div class="bg-white p-8 rounded-lg shadow-lg hover:shadow-xl transition">
                <h3 class="text-2xl font-semibold mb-4 text-indigo-600">
                  <i class="fas fa-cogs mr-2"></i>
                  Автоматизация на заказ
                </h3>
                <p class="text-gray-600 mb-4">
                  Анализируем ваши процессы и создаем индивидуальные AI-решения.
                  Telegram-боты, веб-сервисы, интеграции с API.
                </p>
                <div class="text-sm text-gray-500">
                  <strong>Стоимость:</strong> от 30 000₽ | <strong>Срок:</strong> от 3 недель
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Contact Section */}
        <section id="contact" class="py-20 bg-indigo-600 text-white">
          <div class="container mx-auto px-6 text-center">
            <h2 class="text-4xl font-bold mb-8">
              Готовы начать?
            </h2>
            <p class="text-xl mb-12 max-w-2xl mx-auto">
              Свяжитесь с нами и получите консультацию по внедрению AI в ваш бизнес
            </p>
            <div class="flex flex-col md:flex-row items-center justify-center gap-6">
              <a 
                href="https://t.me/Stivanovv" 
                target="_blank"
                class="bg-white text-indigo-600 px-8 py-4 rounded-full text-lg font-semibold hover:bg-indigo-50 transition transform hover:scale-105"
              >
                <i class="fab fa-telegram mr-2"></i>
                Написать в Telegram
              </a>
              <button 
                onclick="openChat()" 
                class="bg-indigo-500 text-white px-8 py-4 rounded-full text-lg font-semibold hover:bg-indigo-400 transition transform hover:scale-105 border-2 border-white"
              >
                Чат с AI-помощником 🐱
              </button>
            </div>
          </div>
        </section>
      </main>

      {/* Chat Widget */}
      <div id="chat-widget" class="fixed bottom-6 right-6 z-50 hidden">
        <div class="bg-white rounded-2xl shadow-2xl w-96 max-w-[calc(100vw-3rem)] max-h-[600px] flex flex-col">
          {/* Chat Header */}
          <div class="bg-indigo-600 text-white p-4 rounded-t-2xl flex items-center justify-between">
            <div class="flex items-center space-x-3">
              <div class="w-10 h-10 bg-orange-400 rounded-full flex items-center justify-center text-2xl">
                🐱
              </div>
              <div>
                <div class="font-semibold">Кот Бро</div>
                <div class="text-xs text-indigo-200">AI-помощник онлайн</div>
              </div>
            </div>
            <button onclick="closeChat()" class="text-white hover:text-indigo-200 transition">
              <i class="fas fa-times text-xl"></i>
            </button>
          </div>

          {/* Chat Messages */}
          <div id="chat-messages" class="flex-1 p-4 overflow-y-auto bg-gray-50 space-y-4">
            <div class="flex items-start space-x-2">
              <div class="w-8 h-8 bg-orange-400 rounded-full flex items-center justify-center flex-shrink-0 text-lg">
                🐱
              </div>
              <div class="bg-white p-3 rounded-lg shadow-sm max-w-[80%]">
                <p class="text-sm text-gray-800">
                  Мяу! Я Кот Бро - рыжий захватчик этого сайта! 😸
                  <br /><br />
                  Я здесь, чтобы рассказать о студии и показать, как работают AI-боты. Задавай вопросы!
                </p>
              </div>
            </div>
          </div>

          {/* Chat Input */}
          <div class="p-4 border-t border-gray-200">
            <form id="chat-form" class="flex space-x-2">
              <input 
                type="text" 
                id="chat-input"
                placeholder="Напишите сообщение..."
                class="flex-1 px-4 py-2 border border-gray-300 rounded-full focus:outline-none focus:border-indigo-500 text-sm"
              />
              <button 
                type="submit"
                class="bg-indigo-600 text-white px-6 py-2 rounded-full hover:bg-indigo-700 transition flex items-center justify-center"
              >
                <i class="fas fa-paper-plane"></i>
              </button>
            </form>
          </div>
        </div>
      </div>

      {/* Chat Button (when closed) */}
      <button 
        id="chat-button"
        onclick="openChat()" 
        class="fixed bottom-6 right-6 bg-indigo-600 text-white w-16 h-16 rounded-full shadow-2xl hover:bg-indigo-700 transition transform hover:scale-110 flex items-center justify-center text-2xl z-50"
      >
        🐱
      </button>

      {/* Chat Script */}
      <script src="/static/chat.js"></script>
    </div>
  )
})

// API route for chat
app.get('/health', (c) => {
  return c.json({ ok: true, hasOpenAIKey: Boolean(c.env.OPENAI_API_KEY) })
})

app.post('/api/chat', async (c) => handleBotChat(c, BRO_SYSTEM, getBroFallbackResponse))
app.post('/chat', async (c) => handleBotChat(c, BRO_SYSTEM, getBroFallbackResponse))

app.post('/api/hipych/chat', async (c) => handleBotChat(c, HIPYCH_SYSTEM, getHipychFallbackResponse))
app.post('/api/valyusha/chat', async (c) => handleBotChat(c, VALYUSHA_SYSTEM, getValyushaFallbackResponse))

async function handleBotChat(
  c: any,
  systemPrompt: string,
  fallback: (message: string) => string,
) {
  const body = (await c.req.json().catch(() => ({}))) as { message?: unknown }
  const message = typeof body.message === 'string' ? body.message.trim() : ''

  if (!message) return c.json({ error: 'Message is required' }, 400)

  const apiKey = c.env.OPENAI_API_KEY

  if (!apiKey) {
    const reply = fallback(message)
    return c.json({ reply, response: reply })
  }

  try {
    const reply = (await callOpenAI(apiKey, systemPrompt, message)) || fallback(message)
    return c.json({ reply, response: reply })
  } catch (err) {
    console.error('Chat API error:', err)
    const reply = fallback(message)
    return c.json({ reply, response: reply })
  }
}

async function callOpenAI(apiKey: string, systemPrompt: string, message: string): Promise<string> {
  const openaiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: message },
      ],
      temperature: 0.8,
      max_tokens: 700,
    }),
  })

  if (!openaiResponse.ok) {
    const details = await openaiResponse.text().catch(() => '')
    throw new Error(`OpenAI API request failed: ${openaiResponse.status} ${details}`)
  }

  const data = (await openaiResponse.json()) as {
    choices?: Array<{ message?: { content?: string } }>
  }

  const content = data.choices?.[0]?.message?.content
  return typeof content === 'string' ? content.trim() : ''
}

function getBroFallbackResponse(message: string): string {
  const lowerMessage = message.toLowerCase()
  
  const responses: Record<string, string> = {
    'привет': '🐱 Мяу! Я Кот Бро - рыжий захватчик этого сайта! *потягивается*\n\nЯ тут не просто для красоты - я настоящий AI-гид студии! Умею:\n🎯 Рассказывать о проектах с юмором\n😸 Подкалывать клиентов (но мило)\n🤖 Объяснять сложные штуки простыми словами\n\nХочешь себе такого же мемного помощника? От 18 000₽ и он будет твоим! 🚀',
    
    'кто ты': '😸 Я Кот Бро - официальный захватчик AI Studio! *гордо поднимает хвост*\n\nМоя история:\n🏠 Пришел к Степану "в гости"\n💻 Увидел сайт - решил остаться\n🎭 Стал главным мемным гидом\n🤖 Теперь показываю, как работают AI-боты\n\nВидишь, как я общаюсь? Хочешь себе такого же харизматичного помощника?\n💰 Стоимость: от 18 000₽\n⚡ Срок: 2 недели',
    
    'цена': '💰 Видишь, как я работаю?\n\n**Такой же бот для тебя:**\n🤖 Простой бот: от 12 000₽\n🧠 Умный как я: от 18 000₽\n⭐ Супер-персонаж: от 25 000₽\n\nОкупается за месяц! Заказать: @Stivanovv',
    
    'default': '🤔 Хм, интересный вопрос! *почесывает за ухом*\n\nЗнаешь, я могу болтать на любые темы, но главное - я показываю, КАК работает хороший AI-бот!\n\n**Видишь мою магию?**\n🎭 Я живой и интересный\n💬 Отвечаю по теме\n😸 Создаю настроение\n🎯 Веду к цели\n\nТакой же помощник нужен твоему бизнесу!\n💰 От 18 000₽\n⏰ За 2 недели\n\nОбсудить проект: @Stivanovv 🚀'
  }
  
  if (lowerMessage.includes('привет') || lowerMessage.includes('здравствуй')) {
    return responses['привет']
  }
  
  if (lowerMessage.includes('кто ты') || lowerMessage.includes('что ты')) {
    return responses['кто ты']
  }
  
  if (lowerMessage.includes('цена') || lowerMessage.includes('стоимость') || lowerMessage.includes('сколько')) {
    return responses['цена']
  }
  
  return responses['default']
}

function getHipychFallbackResponse(): string {
  return 'Го! 🎮 Я Хипыч. Сейчас есть временные лаги, но всё решаемо. Напиши @Stivanovv — подключим умный режим! 🔥'
}

function getValyushaFallbackResponse(): string {
  return 'Привет! 💜 Я НейроВалюша. Сейчас сервис занят, но я вернусь очень скоро. Напиши @Stivanovv — поможем всё настроить! ✨'
}

export default app
