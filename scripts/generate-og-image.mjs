/**
 * Regenerates the static Open Graph card at public/og/rallyiq.png.
 *
 * Not part of `npm run build` — the PNG is committed. Re-run manually
 * (`node scripts/generate-og-image.mjs`) only when the brand or tagline changes.
 */
import { mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const OUTPUT_URL = new URL('../public/og/rallyiq.png', import.meta.url)
const OUTPUT = fileURLToPath(OUTPUT_URL)
const WIDTH = 1200
const HEIGHT = 630

const HTML = `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500&family=JetBrains+Mono:wght@500&family=Lexend:wght@700;800&display=swap" rel="stylesheet" />
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      width: ${WIDTH}px; height: ${HEIGHT}px;
      background: #0a0a0a;
      font-family: 'Inter', system-ui, sans-serif;
      color: #f5f5f7;
      display: flex; flex-direction: column; justify-content: center;
      padding: 0 84px;
      position: relative; overflow: hidden;
    }
    .glow {
      position: absolute; top: -280px; right: -200px;
      width: 780px; height: 780px; border-radius: 50%;
      background: radial-gradient(circle, rgba(255,77,0,0.28) 0%, rgba(255,77,0,0.06) 45%, transparent 70%);
    }
    .brand { display: flex; align-items: center; gap: 18px; margin-bottom: 34px; }
    .mark {
      width: 62px; height: 62px; border-radius: 15px;
      background: linear-gradient(135deg, #ff6020, #cc2c00);
      display: flex; align-items: center; justify-content: center;
    }
    .wordmark {
      font-family: 'Lexend', system-ui, sans-serif;
      font-weight: 800; font-size: 46px; letter-spacing: -0.03em;
    }
    h1 {
      font-family: 'Lexend', system-ui, sans-serif;
      font-weight: 700; font-size: 62px; line-height: 1.1;
      letter-spacing: -0.025em; max-width: 900px;
    }
    h1 em { font-style: normal; color: #ff4d00; }
    p {
      margin-top: 26px; font-size: 26px; line-height: 1.5;
      color: #a0a0a5; max-width: 820px;
    }
    .rule {
      position: absolute; left: 0; bottom: 0;
      width: 100%; height: 8px;
      background: linear-gradient(90deg, #ff4d00 0%, #ff7a33 45%, transparent 100%);
    }
    .sports {
      position: absolute; bottom: 48px; left: 84px;
      font-family: 'JetBrains Mono', monospace; font-weight: 500;
      font-size: 15px; letter-spacing: 0.22em; text-transform: uppercase;
      color: #6e6e73;
    }
  </style>
</head>
<body>
  <div class="glow"></div>
  <div class="brand">
    <div class="mark">
      <svg width="30" height="30" viewBox="0 0 24 24" fill="none">
        <path d="M13 2L4 14h7l-1 8 9-12h-7l1-8z" fill="#fff" />
      </svg>
    </div>
    <div class="wordmark">RallyIQ</div>
  </div>
  <h1>Tu entrenamiento, <em>ordenado</em>.</h1>
  <p>Coach AI multideporte para planificar la semana, registrar lo que hiciste y ajustar sobre la marcha.</p>
  <div class="sports">Squash · Running · Fuerza · Movilidad</div>
  <div class="rule"></div>
</body>
</html>`

const browser = await chromium.launch()
try {
  const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: 1 })
  await page.setContent(HTML, { waitUntil: 'networkidle' })
  // Webfonts land after networkidle on a cold cache; block until they are ready
  // so the card never renders in the fallback system font.
  await page.evaluate(() => document.fonts.ready)
  await mkdir(new URL('./', OUTPUT_URL), { recursive: true })
  await page.screenshot({ path: OUTPUT, type: 'png' })
  console.log(`Wrote ${OUTPUT} (${WIDTH}x${HEIGHT})`)
} finally {
  await browser.close()
}
