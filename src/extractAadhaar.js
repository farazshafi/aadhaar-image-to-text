/**
 * extractAadhaar.js
 *
 * Extracts structured Aadhaar fields from Tesseract.js result data objects.
 * Tesseract.js exposes three parallel structures on `data`:
 *   - data.text         : full string
 *   - data.words        : flat array of { text, bbox, confidence }
 *   - data.lines        : flat array of { text, bbox }   ← most reliable for line-level positional
 *   - data.blocks[]
 *       .paragraphs[]
 *         .lines[]
 *           .words[]    : nested hierarchy (sometimes incomplete)
 *
 * We prefer data.words + data.lines for name extraction because they are already
 * flattened and sorted in document order by Tesseract, making them more reliable
 * than re-walking the block hierarchy ourselves.
 */

const KEYWORD_RE = /^(government|of\s+india|india|aadhaar|uid|unique|identification|authority|dob|date|year|birth|male|female|transgender|address|help|www|uidai|vidai|enrolment|enrollment|\d)/i;
const NON_NAME_WORDS = new Set([
    "government", "india", "of", "aadhaar", "uid", "unique", "identification",
    "authority", "dob", "date", "year", "birth", "male", "female", "transgender",
    "address", "help", "www", "uidai", "vidai", "enrolment", "enrollment", "cop",
]);
const OCR_NAME_PREFIX_FRAGMENTS = new Set(["od", "pe", "eo"]);

// OCR can join the Aadhaar header and the unlabeled name onto one line. Keep
// plausible name words while dropping header text and short OCR fragments.
function cleanNameCandidate(text) {
    const words = text
        .replace(/[^A-Za-z\s.'-]/g, " ")
        .split(/\s+/)
        .filter((word) => word.length >= 2 && !NON_NAME_WORDS.has(word.toLowerCase()))

    // OCR can merge short fragments from the line above the printed name.
    // Drop these only when two full name words remain, preserving short names
    // such as "Al" and ordinary initials.
    while (
        words.length >= 3 &&
        OCR_NAME_PREFIX_FRAGMENTS.has(words[0].toLowerCase()) &&
        words.slice(1).filter((word) => word.length >= 3).length >= 2
    ) {
        words.shift();
    }

    return words.join(" ").trim();
}

/**
 * getFlatLines — returns top-level data.lines if present, otherwise falls back
 * to walking blocks→paragraphs→lines. Always sorted top-to-bottom by y0.
 */
function getFlatLines(data) {
    // Prefer the top-level flat array Tesseract already provides
    if (Array.isArray(data.lines) && data.lines.length) {
        return data.lines
            .filter((l) => l.text?.trim() && l.bbox)
            .map((l) => ({ text: l.text.trim(), y: l.bbox.y0, x: l.bbox.x0, h: l.bbox.y1 - l.bbox.y0 }))
            .sort((a, b) => a.y - b.y);
    }

    // Fallback: walk block hierarchy
    const lines = [];
    for (const block of data.blocks || []) {
        for (const para of block.paragraphs || []) {
            for (const line of para.lines || []) {
                if (line.text?.trim() && line.bbox) {
                    lines.push({ text: line.text.trim(), y: line.bbox.y0, x: line.bbox.x0, h: line.bbox.y1 - line.bbox.y0 });
                }
            }
        }
    }
    return lines.sort((a, b) => a.y - b.y);
}

/**
 * getFlatWords — returns top-level data.words if present, otherwise walks the
 * block hierarchy. Sorted top-to-bottom, then left-to-right.
 */
function getFlatWords(data) {
    if (Array.isArray(data.words) && data.words.length) {
        return data.words
            .filter((w) => w.text?.trim() && w.bbox)
            .map((w) => ({ text: w.text.trim(), y: w.bbox.y0, x: w.bbox.x0, y1: w.bbox.y1 }))
            .sort((a, b) => a.y - b.y || a.x - b.x);
    }

    // Fallback: walk block hierarchy to word level
    const words = [];
    for (const block of data.blocks || []) {
        for (const para of block.paragraphs || []) {
            for (const line of para.lines || []) {
                for (const word of line.words || []) {
                    if (word.text?.trim() && word.bbox) {
                        words.push({ text: word.text.trim(), y: word.bbox.y0, x: word.bbox.x0, y1: word.bbox.y1 });
                    }
                }
            }
        }
    }
    return words.sort((a, b) => a.y - b.y || a.x - b.x);
}

/**
 * isNameToken — returns true if a word/line of text looks like part of a personal name.
 * Rejects numbers, known Aadhaar keywords, and tokens shorter than 2 letters.
 */
function isNameToken(text) {
    const t = text.trim();
    if (t.length < 2) return false;
    if (/\d{3,}/.test(t)) return false;           // long number sequences
    if (/^[^A-Za-z]+$/.test(t)) return false;     // purely non-alpha
    if (KEYWORD_RE.test(t)) return false;
    return true;
}

/**
 * groupWordsIntoLines — clusters spatially close words (same approximate y-band)
 * into synthetic lines. Used as last resort when data.lines is absent.
 * bandwidth: how many pixels of y-overlap counts as the same line.
 */
function groupWordsIntoLines(words, bandwidth = 10) {
    const syntheticLines = [];
    for (const word of words) {
        const existing = syntheticLines.find((ln) => Math.abs(ln.y - word.y) <= bandwidth);
        if (existing) {
            existing.words.push(word);
        } else {
            syntheticLines.push({ y: word.y, words: [word] });
        }
    }
    // Sort words within each line by x, then build text
    return syntheticLines
        .sort((a, b) => a.y - b.y)
        .map((ln) => ({
            y: ln.y,
            text: ln.words.sort((a, b) => a.x - b.x).map((w) => w.text).join(" ").trim(),
        }));
}

/**
 * @param {object|string} frontData  — frontResult.data (has .text, .lines, .words, .blocks)
 * @param {object|string} backData   — backResult.data
 */
export default function extractAadhaarData(frontData, backData) {
    const frontText = (typeof frontData === "string" ? frontData : frontData?.text) || "";
    const backText = (typeof backData === "string" ? backData : backData?.text) || "";
    const combinedText = `${frontText}\n${backText}`;

    const isFrontObj = frontData && typeof frontData === "object";

    // ── Date of Birth ────────────────────────────────────────────────────────
    const dobPatterns = [
        /(?:DOB|Date\s+of\s+Birth)\s*[:/]?\s*(\d{2}[\/\-]\d{2}[\/\-]\d{4})/i,
        /(\d{2}[\/\-]\d{2}[\/\-]\d{4})/,
        /(?:Year\s+of\s+Birth|YOB)\s*[:/]?\s*(\d{4})/i,
    ];
    let dateOfBirth = null;
    for (const pat of dobPatterns) {
        const m = frontText.match(pat);
        if (m) { dateOfBirth = m[1].replace(/-/g, "/"); break; }
    }

    // ── Gender ───────────────────────────────────────────────────────────────
    const genderMatch = frontText.match(/\b(MWALE|MALE|FEMALE|Male|Female|Transgender|M|F)\b/i);
    let gender = null;
    if (genderMatch) {
        const raw = genderMatch[1].toUpperCase();
        if (raw === "M" || raw === "MWALE") gender = "Male";
        else if (raw === "F") gender = "Female";
        else gender = raw[0].toUpperCase() + raw.slice(1).toLowerCase();
    }

    // ── Aadhaar Number ───────────────────────────────────────────────────────
    const aadhaarMatch = combinedText.match(/\b(\d{4}[\s\-]?\d{4}[\s\-]?\d{4})\b/);
    const aadhaarNumber = aadhaarMatch ? aadhaarMatch[1].replace(/[\s\-]/g, "") : null;

    // ── Name ─────────────────────────────────────────────────────────────────
    // Strategy overview (most-reliable to least):
    //   1. Use flat data.lines (or block-walked lines) sorted by Y.
    //      Find the DOB line; collect candidate lines ABOVE it; filter keywords; merge fragments.
    //   2. Use flat data.words to build synthetic lines by Y-band, then repeat.
    //   3. Text-only fallback: find a name-like token in text before the DOB string.

    let name = null;

    // ── Strategy 1: line-level positional ────────────────────────────────────
    if (!name && isFrontObj) {
        const lines = getFlatLines(frontData);
        if (lines.length) {
            // Find the DOB line (may contain "DOB" label or just a date)
            const dobIdx = lines.findIndex((l) =>
                /\bDOB\b/i.test(l.text) || /\b\d{2}[\/\-]\d{2}[\/\-]\d{4}\b/.test(l.text)
            );

            const searchFrom = dobIdx > 0 ? dobIdx : lines.length;

            // Collect up to 6 lines above DOB, reverse to get bottom-up order
            const aboveDob = lines.slice(Math.max(0, searchFrom - 6), searchFrom).reverse();

            // Gather consecutive name-like lines (stop at first keyword line)
            const nameParts = [];
            for (const line of aboveDob) {
                if (isNameToken(line.text)) {
                    nameParts.unshift(cleanNameCandidate(line.text));
                } else {
                    break; // hit a keyword or number line — stop collecting
                }
            }
            if (nameParts.length) {
                name = cleanNameCandidate(nameParts.join(" ").replace(/\s{2,}/g, " ").trim());
            }

            // If only a single short fragment was found (< 3 chars) reset — unreliable
            if (name && name.replace(/\s/g, "").length < 3) name = null;

        }
    }

    // ── Strategy 2: word-level positional (handles fragmented OCR lines) ─────
    if (!name && isFrontObj) {
        const words = getFlatWords(frontData);
        if (words.length) {
            // Find y-position of the DOB word(s)
            const dobWords = words.filter((w) =>
                /\bDOB\b/i.test(w.text) || /\b\d{2}[\/\-]\d{2}[\/\-]\d{4}\b/.test(w.text)
            );

            if (dobWords.length) {
                const dobY = Math.min(...dobWords.map((w) => w.y));

                // All words above the DOB line (with a small margin)
                const aboveWords = words.filter((w) => w.y1 <= dobY + 5);

                // Group into synthetic lines by Y-band
                const synLines = groupWordsIntoLines(aboveWords);

                // Walk from bottom up, gather name-like lines
                const nameParts = [];
                for (const sl of synLines.reverse()) {
                    if (isNameToken(sl.text)) {
                        nameParts.unshift(cleanNameCandidate(sl.text));
                    } else {
                        break;
                    }
                }

                if (nameParts.length) {
                    const candidate = cleanNameCandidate(nameParts.join(" ").replace(/\s{2,}/g, " ").trim());
                    if (candidate.replace(/\s/g, "").length >= 3) name = candidate;
                }
            }
        }
    }

    // ── Strategy 3: text-only, lines before DOB string ───────────────────────
    if (!name) {
        // Split text into lines, find DOB, look backward
        const textLines = frontText.split(/\n/).map((l) => l.trim()).filter(Boolean);
        const dobTextIdx = textLines.findIndex(
            (l) => /\bDOB\b/i.test(l) || /\b\d{2}[\/\-]\d{2}[\/\-]\d{4}/.test(l)
        );

        const limit = dobTextIdx > 0 ? dobTextIdx : textLines.length;
        const reversedAbove = textLines.slice(0, limit).reverse();

        const nameParts = [];
        for (const line of reversedAbove) {
            if (isNameToken(line)) {
                nameParts.unshift(cleanNameCandidate(line));
            } else {
                break;
            }
        }

        if (nameParts.length) {
            let candidate = cleanNameCandidate(nameParts.join(" ").replace(/\s{2,}/g, " ").trim());
            if (candidate.replace(/\s/g, "").length >= 3) {
                // Normalise ALL-CAPS to Title Case (e.g. "SURESH KUMAR" → "Suresh Kumar")
                if (candidate === candidate.toUpperCase()) {
                    candidate = candidate.split(/\s+/).map((w) => w[0] + w.slice(1).toLowerCase()).join(" ");
                }
                name = candidate;
            }
        }
    }

    // Strategy 4: Extract the name from the line immediately before DOB.
    if (!name) {
        const lines = frontText
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter(Boolean);

        const dobIndex = lines.findIndex(
            (line) =>
                /\bDOB\b/i.test(line) ||
                /\b\d{2}[/-]\d{2}[/-]\d{4}\b/.test(line)
        );

        if (dobIndex > 0) {
            for (let i = dobIndex - 1; i >= Math.max(0, dobIndex - 4); i--) {
                let candidate = lines[i]
                    .replace(/[^A-Za-z\s.'-]/g, " ")
                    .replace(/\s+/g, " ")
                    .trim();

                // Remove common OCR noise and document headings.
                candidate = candidate
                    .replace(/\b(?:Government|India|of|UIDAI|Aadhaar)\b/gi, "")
                    .replace(/\s+/g, " ")
                    .trim();

                const words = candidate.split(/\s+/).filter(Boolean);

                if (
                    words.length >= 2 &&
                    words.every((word) => /^[A-Za-z.'-]+$/.test(word))
                ) {
                    name = candidate;
                    break;
                }
            }
        }

    }

    // ── Strategy 5: ALL-CAPS name ─────────────────────────────────────────────
    if (!name) {
        const allCapsRe = /(?:^|\n)\s*([A-Z]{2,}(?:\s+[A-Z]{2,}){0,3})\s*(?:\n|$)/g;
        let m;
        const candidates = [];
        while ((m = allCapsRe.exec(frontText)) !== null) {
            const t = m[1].trim();
            if (isNameToken(t) && t.replace(/\s/g, "").length >= 3) {
                candidates.push(t.split(/\s+/).map((w) => w[0] + w.slice(1).toLowerCase()).join(" "));
            }
        }
        if (candidates.length) name = candidates[candidates.length - 1];
    }

    // Apply the same cleanup to all fallback strategies.
    if (name) name = cleanNameCandidate(name) || null;

    // ── Address ──────────────────────────────────────────────────────────────
    let address = null;
    const addressMatch = backText.match(/Address\s*:\s*([\s\S]*?)(?=help@uidai\.gov\.in|www\.uidai\.gov\.in|$)/i);
    if (addressMatch?.[1]) {
        const addressLines = addressMatch[1]
            .split(/\r?\n/)
            .map((line) => line.replace(/\s+/g, " ").trim())
            .filter(Boolean);

        // Tesseract may emit fragments from other card regions as extra lines
        // inside the address block. Keep address-like lines, dropping lines
        // that consist mostly of short OCR fragments.
        const usefulLines = addressLines.filter((line) => {
            const withoutLabel = line.replace(/^Address\s*:\s*/i, "");
            const words = withoutLabel.match(/[A-Za-z]+/g) || [];
            const substantialWords = words.filter((word) => word.length >= 4);
            return /\b\d{6}\b/.test(line) || substantialWords.length >= 2;
        });
        if (usefulLines.length) {
            address = usefulLines
                .join(" ")
                .replace(/^Address\s*:\s*/i, "")
                // These are recurring OCR fragments from the blank margin on
                // this card layout, sometimes merged into valid address lines.
                .replace(/\bTo\s+J\s+o\b/gi, " ")
                .replace(/\bRag\s+SRE\s+1a\s*:\s*Be\s+ok\s*&?/gi, " ")
                .replace(/\s+/g, " ")
                .trim();
            const pinMatch = address.match(/^(.*?\d{6})/);
            if (pinMatch) address = pinMatch[1].trim();
        }
    }

    return {
        name,
        dateOfBirth,
        gender,
        aadhaarNumber,
        address,
        rawText: {
            front: frontText,
            back: backText,
        },
    };
}
