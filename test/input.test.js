import test from 'node:test'
import assert from 'node:assert/strict'
import { extractAadhaar } from '../src/index.js'

test('requires a non-empty front and back Buffer', async () => {
  await assert.rejects(extractAadhaar(), /front image must be a non-empty Buffer/)
  await assert.rejects(extractAadhaar({ front: Buffer.from([1]) }), /back image must be a non-empty Buffer/)
  await assert.rejects(extractAadhaar({ front: Buffer.alloc(0), back: Buffer.from([1]) }), /front image must be a non-empty Buffer/)
})

test('rejects corrupt and unsupported image data before OCR', async () => {
  await assert.rejects(
    extractAadhaar({ front: Buffer.from('not an image'), back: Buffer.from('not an image') }),
  )

  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"></svg>')
  await assert.rejects(
    extractAadhaar({ front: svg, back: svg }),
    /JPEG, PNG, or WEBP/,
  )

  // Sharp metadata can read this file's header, but full decoding must reject it.
  const damagedPng = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADUlEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC',
    'base64',
  )
  await assert.rejects(extractAadhaar({ front: damagedPng, back: damagedPng }))
})
