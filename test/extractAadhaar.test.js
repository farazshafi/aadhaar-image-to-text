/**
 * extractAadhaar.test.js
 * Run: node utils/extractAadhaar.test.js   (from the server/ directory)
 *
 * Tests cover:
 *   T1 — Standard Aadhaar: full name before DOB, data.lines available
 *   T2 — Fragmented OCR: name split across two lines ("Al" + "Faroogi"), data.lines only
 *   T3 — Words-only: no data.lines, only data.words (tests Strategy 2 Y-band grouping)
 *   T4 — Text-only fallback: no positional data at all (tests Strategy 3)
 *   T5 — ALL-CAPS name (tests Strategy 5)
 *   T6 — Name should NOT match keywords ("Government of India", "DOB", etc.)
 */

import extractAadhaarData from "../src/extractAadhaar.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function check(label, actual, expected) {
    const ok = expected === null
        ? actual === null
        : (expected instanceof RegExp ? expected.test(actual) : actual === expected);

    if (ok) {
        console.log(`  ✓  ${label}: "${actual}"`);
        passed++;
    } else {
        console.log(`  ✗  ${label}: expected ${String(expected)}, got "${actual}"`);
        failed++;
    }
}

function makeLine(text, y, x = 10) {
    return { text, bbox: { x0: x, y0: y, x1: x + text.length * 8, y1: y + 20 } };
}

function makeWord(text, y, x) {
    return { text, bbox: { x0: x, y0: y, x1: x + text.length * 8, y1: y + 20 } };
}

// ── T1: Standard layout — full name on one line above DOB ────────────────────
{
    console.log("\nT1: Standard layout (data.lines available)");
    const frontData = {
        text: "Government of India\nPriya Sharma\nDOB: 15/08/1990\nFemale\n4321 8765 1234\n",
        lines: [
            makeLine("Government of India", 5),
            makeLine("Priya Sharma", 30),
            makeLine("DOB: 15/08/1990", 55),
            makeLine("Female", 80),
            makeLine("4321 8765 1234", 105),
        ],
    };
    const backData = {
        text: "Address : 12, MG Road, Koramangala, Bengaluru 560034\nhelp@uidai.gov.in\n",
        lines: [],
    };
    const r = extractAadhaarData(frontData, backData);
    check("name", r.name, "Priya Sharma");
    check("dateOfBirth", r.dateOfBirth, "15/08/1990");
    check("gender", r.gender, "Female");
    check("aadhaarNumber", r.aadhaarNumber, "432187651234");
    check("address", r.address, /MG Road/);
}

// ── T2: Fragmented OCR — name split across two lines ─────────────────────────
{
    console.log("\nT2: Fragmented name across lines ('Al' + 'Faroogi') — Strategy 1");
    const frontData = {
        text: "Government of India\nAl\nFaroogi\nDOB: 22/03/1985\nMale\n9876 5432 1098\n",
        lines: [
            makeLine("Government of India", 5),
            makeLine("Al", 30),
            makeLine("Faroogi", 50),
            makeLine("DOB: 22/03/1985", 75),
            makeLine("Male", 100),
            makeLine("9876 5432 1098", 125),
        ],
    };
    const backData = { text: "", lines: [] };
    const r = extractAadhaarData(frontData, backData);
    // Both "Al" and "Faroogi" should be joined
    check("name contains 'Faroogi'", r.name, /Faroogi/i);
    check("name contains 'Al'", r.name, /Al/i);
    check("dateOfBirth", r.dateOfBirth, "22/03/1985");
    check("gender", r.gender, "Male");
}

// ── T3: Words-only (no data.lines) — Strategy 2 Y-band grouping ──────────────
{
    console.log("\nT3: Word-level positional — no data.lines, only data.words");
    const frontData = {
        text: "Government of India\nAl Faroogi\nDOB: 22/03/1985\nMale\n",
        words: [
            makeWord("Government", 5, 10), makeWord("of", 5, 95), makeWord("India", 5, 110),
            makeWord("Al", 30, 10), makeWord("Faroogi", 30, 35),
            makeWord("DOB:", 55, 10), makeWord("22/03/1985", 55, 50),
            makeWord("Male", 80, 10),
        ],
    };
    const backData = { text: "" };
    const r = extractAadhaarData(frontData, backData);
    check("name", r.name, /Al\s+Faroogi/i);
    check("dateOfBirth", r.dateOfBirth, "22/03/1985");
}

// ── T4: Text-only fallback (no positional data at all) — Strategy 3 ──────────
{
    console.log("\nT4: Text-only fallback — no blocks/lines/words");
    const frontData = {
        text: "Government of India\nRatan Tata\nDOB: 28/12/1937\nMale\n1234 5678 9012\n",
    };
    const backData = { text: "" };
    const r = extractAadhaarData(frontData, backData);
    check("name", r.name, /Ratan\s+Tata/i);
    check("dateOfBirth", r.dateOfBirth, "28/12/1937");
}

// ── T5: ALL-CAPS name — Strategy 5 ───────────────────────────────────────────
{
    console.log("\nT5: ALL-CAPS name — Strategy 5");
    const frontData = {
        text: "GOVERNMENT OF INDIA\nSURESH KUMAR SINGH\nDOB: 10/05/1978\nMALE\n",
    };
    const backData = { text: "" };
    const r = extractAadhaarData(frontData, backData);
    // Should extract name in Title Case from ALL-CAPS
    check("name", r.name, /Suresh\s+Kumar\s+Singh/i);
    check("dateOfBirth", r.dateOfBirth, "10/05/1978");
}

// ── T6: Keywords must not leak into name ─────────────────────────────────────
{
    console.log("\nT6: Keyword lines must not be selected as name");
    const frontData = {
        text: "Government of India\nUnique Identification Authority\nAnanya Rao\nDOB: 05/11/2001\nFemale\n",
        lines: [
            makeLine("Government of India", 5),
            makeLine("Unique Identification Authority", 25),
            makeLine("Ananya Rao", 50),
            makeLine("DOB: 05/11/2001", 75),
            makeLine("Female", 100),
        ],
    };
    const backData = { text: "" };
    const r = extractAadhaarData(frontData, backData);
    check("name", r.name, "Ananya Rao");
    // Must NOT be "Unique Identification Authority"
    const notKeyword = r.name !== "Unique Identification Authority";
    if (notKeyword) {
        console.log(`  ✓  name is not a keyword line`);
        passed++;
    } else {
        console.log(`  ✗  name should not be keyword line, got "${r.name}"`);
        failed++;
    }
}

// ── T7: discard merged OCR fragments before Faraz Shafi ─────────────────────
{
    console.log("\nT7: OCR fragments before Faraz Shafi");
    const frontData = {
        text: "Government of India\nod pe\nFaraz Shafi\nDOB: 15/08/1990\nMale\n",
        lines: [
            makeLine("Government of India", 5),
            makeLine("od pe", 25),
            makeLine("Faraz Shafi", 45),
            makeLine("DOB: 15/08/1990", 70),
            makeLine("Male", 95),
        ],
    };
    const result = extractAadhaarData(frontData, { text: "" });
    check("name", result.name, "Faraz Shafi");
}

// ── T8: discard merged OCR acronym before Zaeem Shafi ────────────────────────
{
    console.log("\nT8: OCR fragment before Zaeem Shafi");
    const frontData = {
        text: "Government of India\nEO\nZaeem shafi\nDOB: 15/08/1990\nMale\n",
        lines: [
            makeLine("Government of India", 5),
            makeLine("EO", 25),
            makeLine("Zaeem shafi", 45),
            makeLine("DOB: 15/08/1990", 70),
            makeLine("Male", 95),
        ],
    };
    const result = extractAadhaarData(frontData, { text: "" });
    check("name", result.name, "Zaeem shafi");
}

// ── Summary ─────────────────────────────────────────────────────────────────
console.log(`\n${"─".repeat(50)}`);
console.log(`${passed}/${passed + failed} assertions passed`);
if (failed > 0) process.exit(1);
