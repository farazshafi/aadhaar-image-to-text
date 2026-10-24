# Aadhaar Image to Text

[![npm version](https://img.shields.io/npm/v/aadhaar-image-to-text)](https://www.npmjs.com/package/aadhaar-image-to-text)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

An open source Node.js library that uses OCR to read the front and back of an Aadhaar card and extract common fields. It accepts image buffers, so it can be used with file uploads, including Multer, without requiring the library to manage temporary upload files.

> **Important:** OCR is probabilistic. Results can be incomplete or incorrect and must be reviewed before use. This package is not affiliated with or endorsed by UIDAI, and it does not verify an identity or the authenticity of a card.

## Features

- Recognizes the front and back images with Tesseract.js.
- Extracts a name, date of birth or year of birth, gender, Aadhaar number, address, and raw OCR text.
- Accepts JPEG, PNG, and WEBP image buffers.
- Returns `null` for fields it cannot identify.
- Runs in Node.js and does not store or log the supplied images or results.

## Requirements

- Node.js 20 or newer
- One image of each side of the card, provided as a non-empty `Buffer`
- JPEG, PNG, or WEBP image data
- Internet access on first use if Tesseract.js needs to download its English language data

## Installation

```sh
npm install aadhaar-image-to-text
```

## Quick start

```js
import { readFile } from 'node:fs/promises'
import { extractAadhaar } from 'aadhaar-image-to-text'

const result = await extractAadhaar({
  front: await readFile('./aadhaar-front.jpg'),
  back: await readFile('./aadhaar-back.jpg'),
})

console.log(result.name)
console.log(result.dateOfBirth)
console.log(result.aadhaarNumber)
```

The package is an ES module. Its default export is also `extractAadhaar`:

```js
import extractAadhaar from 'aadhaar-image-to-text'
```

## API

### `extractAadhaar({ front, back })`

Runs OCR on both sides and returns a promise for the extracted fields.

| Input | Type | Description |
| --- | --- | --- |
| `front` | `Buffer` | Non-empty JPEG, PNG, or WEBP image of the card front. |
| `back` | `Buffer` | Non-empty JPEG, PNG, or WEBP image of the card back. |

Returned object:

```js
{
  name: 'Priya Sharma',
  dateOfBirth: '15/08/1990',
  gender: 'Female',
  aadhaarNumber: '432187651234',
  address: '12, MG Road, Koramangala, Bengaluru 560034',
  rawText: {
    front: '...',
    back: '...'
  }
}
```

Each extracted field may be `null` when it is not found. `dateOfBirth` may contain a full date (`DD/MM/YYYY`) or a year (`YYYY`), depending on what is printed and recognized. The Aadhaar number is returned as 12 digits without spaces or hyphens when detected. `rawText` contains the OCR text for each side and may include errors.

### Errors

The promise rejects with a `TypeError` if either image is missing, is not a non-empty `Buffer`, or is not a supported image format. Errors from image decoding or OCR may also reject the promise.

```js
try {
  const result = await extractAadhaar({ front, back })
  // Review the result before relying on it.
} catch (error) {
  console.error('Could not process Aadhaar images:', error.message)
}
```

### `extractAadhaarData(frontData, backData)`

The named `extractAadhaarData` export extracts fields from Tesseract.js result data (or plain text strings). This lower-level helper does not run OCR:

```js
import { extractAadhaarData } from 'aadhaar-image-to-text'

const result = extractAadhaarData(
  { text: 'Priya Sharma\nDOB: 15/08/1990\nFemale\n4321 8765 1234' },
  { text: 'Address: 12, MG Road, Bengaluru 560034' },
)
```

## Upload handler example

With [Multer](https://github.com/expressjs/multer) using in-memory storage, the uploaded file buffers can be passed directly:

```js
app.post('/extract', upload.fields([
  { name: 'front', maxCount: 1 },
  { name: 'back', maxCount: 1 },
]), async (req, res, next) => {
  try {
    const front = req.files?.front?.[0]?.buffer
    const back = req.files?.back?.[0]?.buffer

    const result = await extractAadhaar({ front, back })
    res.json(result)
  } catch (error) {
    next(error)
  }
})
```

Configure upload size limits and validate the files at your application boundary. Avoid returning `rawText` or identity fields to clients that do not need them.

## OCR quality

OCR accuracy depends on image sharpness, lighting, orientation, cropping, card condition, and the printed text. The library supports English recognition; it does not promise accurate results for every card layout or image. Review all extracted values against the source image, especially before using them in a consequential workflow. The output should not be treated as proof of identity, an official record, or a substitute for an authorized verification process.

## Privacy and responsible use

Aadhaar images and extracted fields are sensitive personal information. This library processes the buffers supplied by your application and does not save or log them. Your application remains responsible for upload security, access control, lawful collection and processing, retention and deletion, transport security, and preventing accidental exposure in logs, responses, analytics, or error reports. Collect and process identity data only when you have an appropriate purpose and authorization.

## Development

```sh
git clone https://github.com/<owner>/aadhaar-image-to-text.git
cd aadhaar-image-to-text
npm install
npm test
```

Check the package contents before publishing:

```sh
npm run pack:check
```

Contributions are welcome. Please open an issue to discuss substantial changes, and include or update tests when changing extraction behavior. Do not add real Aadhaar images or personal identity data to issues, tests, fixtures, or pull requests; use synthetic examples instead.

## License

This project is licensed under the [MIT License](LICENSE).
