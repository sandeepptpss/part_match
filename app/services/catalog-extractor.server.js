/**
 * AI Document & Catalog Fitment Extractor
 * 
 * Extracts structured vehicle fitments from unstructured supplier PDFs,
 * catalog text, spec sheets, and product line cards using Gemini / Claude LLMs.
 */

import { isAiConfigured } from "../ai.server.js";
import { normalizeVehicleRecord } from "./vehicle-normalizer.server.js";

// Dynamic HTTPS post helper for Gemini API
async function callGemini(prompt) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;

  const https = await import("node:https");
  const models = ["gemini-2.5-flash", "gemini-flash-latest"];

  for (const model of models) {
    const urlStr = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
    try {
      const u = new URL(urlStr);
      const postData = JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
      });

      const responseText = await new Promise((resolve, reject) => {
        const req = https.request(
          {
            hostname: u.hostname,
            path: u.pathname + u.search,
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Content-Length": Buffer.byteLength(postData),
              "x-goog-api-key": apiKey,
            },
          },
          (res) => {
            let body = "";
            res.on("data", (chunk) => (body += chunk));
            res.on("end", () => resolve({ statusCode: res.statusCode, body }));
          }
        );
        req.on("error", reject);
        req.write(postData);
        req.end();
      });

      if (responseText.statusCode >= 200 && responseText.statusCode < 300) {
        const json = JSON.parse(responseText.body);
        const text = json?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text) return text;
      }
    } catch (err) {
      console.error(`[catalog-extractor] Gemini model ${model} error:`, err);
    }
  }
  return null;
}

/**
 * Fallback pattern-based catalog extractor when AI API keys are not provided
 * or during test simulations.
 */
function heuristicExtractFitment(rawText) {
  const extracted = [];
  const lines = rawText.split(/\r?\n/).filter((l) => l.trim().length > 3);

  const yearPattern = /\b(19\d{2}|20\d{2})(?:\s*[-–—]\s*(19\d{2}|20\d{2}|\d{2}))?\b/;
  const commonMakes = [
    "chevrolet", "chevy", "ford", "toyota", "honda", "nissan", "bmw", "audi",
    "mercedes", "dodge", "ram", "jeep", "gmc", "subaru", "mazda", "polaris", "arctic cat"
  ];
  const partPattern = /\b([A-Z0-9]{3,}-[A-Z0-9-]+|[A-Z]{2,}\d{3,}[A-Z0-9]*)\b/i;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineLower = line.toLowerCase();

    const makeMatch = commonMakes.find((m) => lineLower.includes(m));
    const yearMatch = line.match(yearPattern);

    if (makeMatch && yearMatch) {
      const yearStr = yearMatch[0];
      const make = makeMatch.charAt(0).toUpperCase() + makeMatch.slice(1);

      // Attempt to extract model from words following the make
      const words = line.split(/\s+/);
      const makeIndex = words.findIndex((w) => w.toLowerCase().includes(makeMatch));
      let modelCandidate = "General";
      let trimCandidate = "";

      if (makeIndex !== -1 && words[makeIndex + 1]) {
        modelCandidate = words[makeIndex + 1].replace(/[,:;]/g, "");
        if (words[makeIndex + 2] && !words[makeIndex + 2].match(yearPattern)) {
          trimCandidate = words[makeIndex + 2].replace(/[,:;]/g, "");
        }
      }

      // Check for SKU / part number on same line
      const partMatch = line.match(partPattern);
      const partNumber = partMatch ? partMatch[1] : "";

      extracted.push({
        year: yearStr,
        make: make,
        model: modelCandidate,
        trim: trimCandidate,
        partNumber: partNumber,
        confidence: 85,
        reason: "Heuristic pattern match in catalog line",
      });
    }
  }

  return extracted;
}

/**
 * Extracts fitment records from raw unstructured document text (PDF extracted text, spec sheet, catalog tables).
 */
export async function extractFitmentFromDocument(documentText) {
  if (!documentText || !documentText.trim()) {
    return { records: [], totalExtracted: 0, mock: !isAiConfigured() };
  }

  const prompt = `You are an expert automotive parts catalog engineer.
Extract vehicle fitment mappings from the following automotive catalog or spec sheet text.

CATALOG CONTENT:
${documentText.slice(0, 8000)}

INSTRUCTIONS:
1. Identify all vehicle fitment specifications: Year (or year range like 2015-2018), Make, Model, SubModel/Trim, and Part Number/SKU.
2. If a year range is provided (e.g. "2015-2020"), keep the year range string intact.
3. Assign a confidence score from 50 to 100 based on the clarity of the fitment specification.
4. Return ONLY a valid JSON array of objects with keys:
   [
     {
       "year": "2015-2018",
       "make": "Ford",
       "model": "F-150",
       "trim": "3.5L EcoBoost",
       "partNumber": "BP-FORD-F150",
       "confidence": 95,
       "reason": "Explicit brake pad listing"
     }
   ]
Do NOT include any markdown formatting, code block markers, or commentary text.`;

  let rawAiOutput = null;

  if (process.env.GEMINI_API_KEY) {
    rawAiOutput = await callGemini(prompt);
  }

  let parsed = [];
  if (rawAiOutput) {
    try {
      const jsonMatch = rawAiOutput.match(/\[[\s\S]*\]/);
      parsed = JSON.parse(jsonMatch ? jsonMatch[0] : rawAiOutput);
    } catch (err) {
      console.warn("[catalog-extractor] Failed to parse AI output, falling back to heuristics:", err);
    }
  }

  if (!Array.isArray(parsed) || parsed.length === 0) {
    parsed = heuristicExtractFitment(documentText);
  }

  // Normalize all extracted records and expand year ranges
  const normalizedRecords = [];
  for (const item of parsed) {
    const rawYear = String(item.year || "").trim();
    const rawMake = String(item.make || "").trim();
    const rawModel = String(item.model || "").trim();
    const rawTrim = String(item.trim || "").trim();
    const partNumber = String(item.partNumber || item.sku || item.part || "").trim();
    const confidence = Math.min(100, Math.max(0, parseInt(item.confidence, 10) || 85));
    const reason = String(item.reason || "AI Document Extraction").slice(0, 150);

    if (rawYear && rawMake && rawModel) {
      const normalizedVehicles = normalizeVehicleRecord({
        year: rawYear,
        make: rawMake,
        model: rawModel,
        trim: rawTrim,
      });

      for (const v of normalizedVehicles) {
        normalizedRecords.push({
          year: v.year,
          make: v.make,
          model: v.model,
          trim: v.trim,
          canonicalVehicleId: v.canonicalVehicleId,
          partNumber: partNumber,
          confidence: confidence,
          extractionReason: reason,
          source: "PDF_AI",
        });
      }
    }
  }

  return {
    records: normalizedRecords,
    totalExtracted: normalizedRecords.length,
    mock: !isAiConfigured() && !rawAiOutput,
  };
}
