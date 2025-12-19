import { jsxRenderer } from 'hono/jsx-renderer'

export const renderer = jsxRenderer(({ children }) => {
  return (
    <html lang="ru">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>Реальный Vайб AI Studio | Персональные AI-решения для бизнеса</title>
        <meta name="description" content="AI Studio - создаем умные боты, автоматизируем процессы и внедряем нейросети для вашего бизнеса. Персональный подход и результат 24/7." />
        
        {/* Google Fonts */}
        <link href="https://fonts.googleapis.com/css2?family=Unbounded:wght@400;500;600;700&family=Spline+Sans:wght@400;500;600&family=Space+Grotesk:wght@500;600;700&display=swap" rel="stylesheet" />
        
        {/* FontAwesome Icons */}
        <link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.2/css/all.min.css" rel="stylesheet" />
        
        {/* TailwindCSS */}
        <script src="https://cdn.tailwindcss.com"></script>
        
        {/* Custom Styles */}
        <link href="/static/style.css" rel="stylesheet" />
      </head>
      <body class="home-page">
        {children}
      </body>
    </html>
  )
})
