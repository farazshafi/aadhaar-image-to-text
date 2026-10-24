import sharp from 'sharp'
import tesseract from 'tesseract.js'
import extractAadhaarData from './extractAadhaar.js'

const SUPPORTED_FORMATS = new Set(['jpeg', 'png', 'webp'])

function assertBuffer(value, side) {
  if (!Buffer.isBuffer(value) || value.length === 0) {
    throw new TypeError(`The ${side} image must be a non-empty Buffer.`)
  }
}

async function recognizeImage(buffer) {
  const metadata = await sharp(buffer).metadata()
  if (!SUPPORTED_FORMATS.has(metadata.format)) {
    throw new TypeError('Images must be JPEG, PNG, or WEBP.')
  }
  // Decode before invoking Tesseract. Some damaged files still expose usable
  // metadata, but can otherwise crash the OCR worker instead of rejecting.
  const decodedImage = await sharp(buffer).png().toBuffer()
  return tesseract.recognize(decodedImage, 'eng', { logger: () => {} })
}

async function recognizeAadhaarNumber(buffer) {
  const metadata = await sharp(buffer).metadata()
  if (!metadata.width || !metadata.height || !SUPPORTED_FORMATS.has(metadata.format)) return null

  const left = Math.floor(metadata.width * 0.25)
  const top = Math.floor(metadata.height * 0.78)
  const width = Math.min(Math.floor(metadata.width * 0.55), metadata.width - left)
  const height = Math.min(Math.floor(metadata.height * 0.17), metadata.height - top)
  if (width < 1 || height < 1) return null

  const numberRegion = await sharp(buffer)
    .extract({ left, top, width, height })
    .grayscale()
    .normalize()
    .resize({ width: 1200 })
    .png()
    .toBuffer()

  const result = await tesseract.recognize(numberRegion, 'eng', { logger: () => {} })
  const digits = (result.data.text.match(/\d/g) || []).join('')
  return digits.length === 12 ? digits : null
}

/**
 * OCR both sides of an Aadhaar card and extract common identity fields.
 * Images must be JPEG, PNG, or WEBP buffers.
 * @param {{ front: Buffer, back: Buffer }} images
 * @returns {Promise<{name: string|null, dateOfBirth: string|null, gender: string|null, aadhaarNumber: string|null, address: string|null, rawText: {front: string, back: string}}>}
 */
export async function extractAadhaar({ front, back } = {}) {
  assertBuffer(front, 'front')
  assertBuffer(back, 'back')

  // Metadata validation also rejects corrupt or unsupported image data before OCR.
  const [frontMeta, backMeta] = await Promise.all([
    sharp(front).metadata(),
    sharp(back).metadata(),
  ])
  for (const [side, metadata] of [['front', frontMeta], ['back', backMeta]]) {
    if (!SUPPORTED_FORMATS.has(metadata.format)) {
      throw new TypeError(`The ${side} image must be JPEG, PNG, or WEBP.`)
    }
  }

  const [frontResult, backResult] = await Promise.all([
    recognizeImage(front),
    recognizeImage(back),
  ])
  const structuredData = extractAadhaarData(frontResult.data, backResult.data)
  const croppedNumber = await recognizeAadhaarNumber(front) || await recognizeAadhaarNumber(back)
  structuredData.aadhaarNumber = croppedNumber || structuredData.aadhaarNumber
  return structuredData
}

export { extractAadhaarData }
export default extractAadhaar
