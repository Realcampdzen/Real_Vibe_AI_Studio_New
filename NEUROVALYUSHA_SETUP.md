# НейроВалюша: настройка VK + Telegram (Cloudflare Pages)

Этот проект живёт в `cf-api/` и деплоится как Cloudflare Pages (Hono Worker).

## Эндпоинты

- `POST /api/vk/callback` — VK Callback API (группа / сообщество)
- `POST /api/tg/webhook` — Telegram Bot API webhook
- `POST /api/valyusha/chat` — чат для сайта (уже использует промпт НейроВалюши)

## Переменные окружения (Secrets в Cloudflare)

### Общее
- `OPENAI_API_KEY` — ключ OpenAI (если не задан, будет мягкий fallback без LLM)

### VK
- `VK_GROUP_ID` — числовой ID группы (например `123456`)
- `VK_SECRET` — секрет Callback API (проверяем `payload.secret`)
- `VK_CONFIRMATION_CODE` — строка подтверждения, которую выдаёт VK для Callback сервера
- `VK_ACCESS_TOKEN` — токен сообщества с правами на `wall` (для `wall.createComment`)

### Telegram
- `TELEGRAM_BOT_TOKEN` — токен бота
- `TELEGRAM_WEBHOOK_SECRET` — секрет для заголовка `X-Telegram-Bot-Api-Secret-Token`
- `TELEGRAM_CHANNEL_ID` — опционально: ограничить ответы только на автоматические форварды из конкретного канала (числовой id канала)
- `TELEGRAM_CHANNEL_ID_USERNAME` — опционально: ограничить ответы по @username канала (например `@realcampspb`)
- `TELEGRAM_DISCUSSION_GROUP_ID` — опционально: ограничить работу бота только одной группой‑обсуждением (chat id группы, обычно `-100...`)
- `DISCUSSION_GROUP_ID` — алиас для `TELEGRAM_DISCUSSION_GROUP_ID` (если у вас уже так названо в env)

## KV (память 10 сообщений + дедупликация)

Для “контекста 10 сообщений” и дедупликации событий используется KV биндинг:
- `NEUROVALYUSHA_KV`

Если KV не подключён — бот всё равно будет работать, но:
- контекст/память будут “урезаны”
- защита от повторов будет слабее (частично компенсируется `guid` в VK)

## Путеводитель: индекс значков (для комментариев с ID)

Чтобы Валюша могла подбирать “релевантный значок” к теме поста и писать в комментарии в формате `12.3 "Название"`, используется компактный индекс:

- `cf-api/public/static/guidebook-badges-index.json`

Он генерируется из актуального `ai-data` (репозиторий “Путеводитель web_new”) командой:

```powershell
cd "D:\Development\real_site — копия\cf-api"
node "scripts/build-guidebook-badges-index.mjs" "D:\Development\Путеводитель web_new\public\ai-data" "public\static\guidebook-badges-index.json"
```

После генерации нужно пересобрать `dist/` и задеплоить Pages.

## VK: что включить

### 1) Ключ доступа (токен сообщества)

ВК → ваше сообщество → **Управление** → **Работа с API** → **Ключи доступа**:
- Нужен **токен сообщества** с правами минимум на **“Стена (wall)”** (мы вызываем `wall.createComment`).
- Токен лучше хранить только в **Cloudflare Secrets** (не в коде/репозитории).

### 2) Сервер Callback API

ВК → ваше сообщество → **Управление** → **Работа с API** → **Callback API** → **Серверы**:

- **URL**: `https://<your-pages-domain>/api/vk/callback`
- **Secret key**: это ваш `VK_SECRET` (придумайте строку и используйте одинаковую в ВК и Cloudflare)
- **Версия API**: актуальная

После сохранения ВК пришлёт событие `confirmation`. Наш сервер должен **вернуть строку подтверждения**:
- ВК покажет её в интерфейсе (обычно “Строка, которую должен вернуть сервер”)
- Скопируйте её в Cloudflare secret `VK_CONFIRMATION_CODE`

Когда всё совпало — в ВК рядом с сервером будет статус, что он подтверждён/работает.

2) События (минимум):
- `wall_post_new` — новый пост
- `wall_reply_new` — новый комментарий

3) Подтверждение:
- VK пришлёт событие `confirmation` → сервер должен вернуть `VK_CONFIRMATION_CODE` (у нас так и сделано)

### 4) Secrets в Cloudflare (production)

Cloudflare Pages → проект → **Settings → Variables and Secrets** (Production):
- `VK_GROUP_ID` — числовой ID сообщества (например `57701087`)
- `VK_ACCESS_TOKEN` — токен сообщества с правами на “Стена (wall)”
- `VK_SECRET` — secret key из Callback API сервера
- `VK_CONFIRMATION_CODE` — строка подтверждения из Callback API

Рекомендуется также подключить `NEUROVALYUSHA_KV` (для памяти/дедупликации/ротации значков).

## Telegram: что включить

Важно: “комментарии к постам канала” живут в привязанной группе-обсуждении. Бот должен получать апдейты из этой группы.

1) Добавить бота в группу-обсуждение (и лучше дать права админа).
2) В BotFather отключить privacy mode (если нужно видеть обычные сообщения в группе).
3) Поставить webhook на `POST /api/tg/webhook` с secret token.

Примечание: бот реагирует на “новый пост” когда видит **автоматический форвард** поста канала в группе (поле `is_automatic_forward`).

### Рекомендованная конфигурация (production)

- **Ограничить чат** (чтобы бот не отвечал в личке/других группах):
  - задайте `TELEGRAM_DISCUSSION_GROUP_ID` (или `DISCUSSION_GROUP_ID`) = chat id вашей группы‑обсуждения (например `-1002516417808`)
- **Ограничить канал** (чтобы реагировать только на ваш канал):
  - задайте `TELEGRAM_CHANNEL_ID` (числовой id канала, обычно `-100...`) **или** `TELEGRAM_CHANNEL_ID_USERNAME=@вашканал`

### Установка webhook

Нужно один раз вызвать `setWebhook` и передать `secret_token`, который совпадает с `TELEGRAM_WEBHOOK_SECRET` в Cloudflare.
Пример (подставьте домен Pages, токен бота и secret):

```bash
curl -X POST "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook" \
  -H "Content-Type: application/json" \
  -d "{\"url\":\"https://<your-pages-domain>/api/tg/webhook\",\"secret_token\":\"<TELEGRAM_WEBHOOK_SECRET>\",\"allowed_updates\":[\"message\",\"edited_message\"]}"
```


