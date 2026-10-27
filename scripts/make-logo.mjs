import { deflateSync } from 'node:zlib'
import { writeFileSync } from 'node:fs'

// Minimal PNG writer: no dependencies, just a deterministic geometric mark.
const W = 512, H = 512
const px = Buffer.alloc(W * H * 3)

const bg = [11, 14, 20]
const accent = [110, 168, 255]
const green = [61, 220, 151]
const dim = [84, 97, 122]

for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const i = (y * W + x) * 3
  px[i] = bg[0]; px[i + 1] = bg[1]; px[i + 2] = bg[2]
}

function rect(x0, y0, x1, y1, c, radius = 10) {
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const dx = Math.min(x - x0, x1 - 1 - x)
    const dy = Math.min(y - y0, y1 - 1 - y)
    if (dx < radius && dy < radius) {
      const d = Math.hypot(radius - dx, radius - dy)
      if (d > radius) continue
    }
    const i = (y * W + x) * 3
    px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2]
  }
}

function line(x0, y0, x1, y1, c, thick = 6) {
  const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) * 2
  for (let s = 0; s <= steps; s++) {
    const t = s / steps
    const x = Math.round(x0 + (x1 - x0) * t)
    const y = Math.round(y0 + (y1 - y0) * t)
    rect(x - thick, y - thick, x + thick, y + thick, c, thick)
  }
}

// three linked blocks: evidence -> decision -> trade
line(150, 256, 232, 256, dim, 5)
line(280, 256, 362, 256, dim, 5)
rect(72, 196, 152, 316, accent, 14)
rect(202, 196, 282, 316, accent, 14)
rect(332, 196, 412, 316, green, 14)

// chain ticks inside each block
for (const bx of [72, 202, 332]) {
  for (let k = 0; k < 3; k++) rect(bx + 20, 232 + k * 26, bx + 60, 238 + k * 26, bg, 3)
}

function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
  const t = Buffer.from(type, 'ascii')
  const body = Buffer.concat([t, data])
  let crcTable = chunk.table
  if (!crcTable) {
    crcTable = chunk.table = []
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcTable[n] = c >>> 0 }
  }
  let crc = 0xffffffff
  for (const b of body) crc = crcTable[(crc ^ b) & 0xff] ^ (crc >>> 8)
  crc = (crc ^ 0xffffffff) >>> 0
  const c = Buffer.alloc(4); c.writeUInt32BE(crc)
  return Buffer.concat([len, body, c])
}

const ihdr = Buffer.alloc(13)
ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4)
ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0

const raw = Buffer.alloc((W * 3 + 1) * H)
for (let y = 0; y < H; y++) {
  raw[y * (W * 3 + 1)] = 0
  px.copy(raw, y * (W * 3 + 1) + 1, y * W * 3, (y + 1) * W * 3)
}

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
])

const out = process.argv[2] || 'docs/logo.png'
writeFileSync(out, png)
console.log('wrote', out, png.length, 'bytes')
