import fs from 'node:fs'
import path from 'node:path'

function clip(text, max = 220) {
  const t = String(text || '').replace(/\s+/g, ' ').trim()
  if (!t) return ''
  if (t.length <= max) return t
  return t.slice(0, max).trim() + '…'
}

function isBaseBadgeId(id) {
  // base badge: N.X (2 parts). levels are N.X.Y
  return typeof id === 'string' && id.split('.').length === 2
}

function main() {
  const srcAiData = process.argv[2]
  const outFile = process.argv[3]
  if (!srcAiData || !outFile) {
    console.error('Usage: node scripts/build-guidebook-badges-index.mjs <ai-data-path> <out-file>')
    process.exit(1)
  }

  const masterPath = path.join(srcAiData, 'MASTER_INDEX.json')
  const master = JSON.parse(fs.readFileSync(masterPath, 'utf8'))
  const categories = Array.isArray(master?.categories) ? master.categories : []

  const entries = []

  for (const cat of categories) {
    const categoryId = String(cat.id || '').trim()
    const categoryTitle = String(cat.title || '').trim()
    const categoryPath = String(cat.path || '').replace(/\/$/, '')
    if (!categoryId || !categoryPath) continue

    const indexPath = path.join(srcAiData, categoryPath, 'index.json')
    if (!fs.existsSync(indexPath)) continue
    const catIndex = JSON.parse(fs.readFileSync(indexPath, 'utf8'))
    const badgesData = Array.isArray(catIndex?.badgesData) ? catIndex.badgesData : []

    for (const b of badgesData) {
      const id = String(b?.id || '').trim()
      if (!isBaseBadgeId(id)) continue

      const badgePath = path.join(srcAiData, categoryPath, `${id}.json`)
      if (!fs.existsSync(badgePath)) continue

      const badge = JSON.parse(fs.readFileSync(badgePath, 'utf8'))
      entries.push({
        id,
        title: String(badge?.title || b?.title || '').trim(),
        emoji: String(badge?.emoji || b?.emoji || '').trim() || undefined,
        categoryId: String(badge?.categoryId || categoryId).trim(),
        categoryTitle,
        description: clip(badge?.description, 240) || undefined,
        skillTips: clip(badge?.skillTips, 240) || undefined,
      })
    }
  }

  entries.sort((a, b) => a.id.localeCompare(b.id, 'ru'))
  fs.mkdirSync(path.dirname(outFile), { recursive: true })
  fs.writeFileSync(outFile, JSON.stringify(entries, null, 2), 'utf8')
  console.log(`OK: wrote ${entries.length} badges to ${outFile}`)
}

main()


