# aadhaar-image-to-text

Node.js library that runs OCR on front and back Aadhaar card images and extracts common fields. It accepts in-memory image buffers, so it can be used with Multer or another upload handler.

## Requirements

- Node.js 20 or newer
- JPEG, PNG, or WEBP images
- Internet access on first use if Tesseract.js needs to download English language data

## Install

```sh
npm install aadhaar-image-to-text
```

## Usage

```js
import { extractAadhaar } from 'aadhaar-image-to-text'

const result = await extractAadhaar({
  front: frontImageBuffer,
  back: backImageBuffer,
})

console.log(result.name, result.dateOfBirth, result.gender)
```

The returned object contains `name`, `dateOfBirth`, `gender`, `aadhaarNumber`, `address`, and `rawText` (`front` and `back`). Values that OCR cannot identify are `null`; the raw text contains the recognized text from each side. The Aadhaar number is normalized to 12 digits when detected.

The library does not save or log uploaded images or extracted identity data. Callers are responsible for secure handling of both.

## Development

```sh
npm install
npm test
npm run pack:check
```

## License

MIT
