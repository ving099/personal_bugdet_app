// Regenerates the PNG icons from public/icon.svg. Run with `npm run icons`; outputs are committed.
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const pub = (name) => fileURLToPath(new URL(`../public/${name}`, import.meta.url))
const svg = await readFile(pub('icon.svg'))
const PETROL = '#0F4C6B'

async function plain(size, name) {
  await sharp(svg, { density: 384 }).resize(size, size).png().toFile(pub(name))
}

// Maskable: full-bleed petrol with the artwork inside the central 80% safe zone.
async function maskable(size, name) {
  const inner = Math.round(size * 0.7)
  const art = await sharp(svg, { density: 384 }).resize(inner, inner).png().toBuffer()
  await sharp({ create: { width: size, height: size, channels: 4, background: PETROL } })
    .composite([{ input: art, gravity: 'centre' }])
    .png()
    .toFile(pub(name))
}

await plain(192, 'icon-192.png')
await plain(512, 'icon-512.png')
await plain(180, 'apple-touch-icon.png')
await maskable(512, 'icon-maskable-512.png')
console.log('Icons written to public/')
