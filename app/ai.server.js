import Anthropic from "@anthropic-ai/sdk";
import https from "node:https";

const ANTHROPIC_MODEL = "claude-haiku-4-5-20251001";

let anthropicClient;
function getAnthropicClient() {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  if (!anthropicClient) anthropicClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return anthropicClient;
}

export function isAiConfigured() {
  return Boolean(process.env.GEMINI_API_KEY || process.env.ANTHROPIC_API_KEY);
}

function httpsPostJson(urlStr, bodyObj) {
  return new Promise((resolve, reject) => {
    try {
      const u = new URL(urlStr);
      const data = JSON.stringify(bodyObj);
      const req = https.request(
        {
          hostname: u.hostname,
          path: u.pathname + u.search,
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(data),
          },
        },
        (res) => {
          let body = "";
          res.on("data", (chunk) => (body += chunk));
          res.on("end", () => {
            let jsonParsed = null;
            try { jsonParsed = JSON.parse(body); } catch {}
            resolve({
              ok: res.statusCode >= 200 && res.statusCode < 300,
              status: res.statusCode,
              text: body,
              json: jsonParsed,
            });
          });
        }
      );
      req.on("error", reject);
      req.write(data);
      req.end();
    } catch (e) {
      reject(e);
    }
  });
}

// Call Google Gemini API (Free Tier Support)
async function callGeminiApi(prompt) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;

  const models = ["gemini-2.5-flash", "gemini-flash-latest"];
  for (const model of models) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
    try {
      const response = await httpsPostJson(url, {
        contents: [{ parts: [{ text: prompt }] }],
      });

      if (response.ok && response.json) {
        const text = response.json?.candidates?.[0]?.content?.parts?.[0]?.text || null;
        if (text) return text;
      } else {
        console.error(`[ai.server] Gemini model ${model} HTTP Error:`, response.status, response.text);
      }
    } catch (err) {
      console.error(`[ai.server] Gemini model ${model} exception:`, err);
    }
  }
  return null;
}

// No API key set: simulate suggestions via plain keyword matching so
// the UI flow (button, badges, accept/reject) can be tested at zero cost.
function mockSuggestFitmentProducts({ year, make, model, products }) {
  const makeLower = make.toLowerCase();
  const modelLower = model.toLowerCase();
  const yearStr = String(year);

  return products
    .map((p) => {
      const text = `${p.title} ${p.description || ""}`.toLowerCase();
      let confidence = 0;
      const reasons = [];
      if (text.includes(makeLower)) { confidence += 35; reasons.push(`mentions ${make}`); }
      if (text.includes(modelLower)) { confidence += 40; reasons.push(`mentions ${model}`); }
      if (text.includes(yearStr)) { confidence += 15; reasons.push(`mentions ${yearStr}`); }
      if (/universal|fits all|generic/.test(text)) { confidence += 20; reasons.push("universal part"); }
      if (confidence === 0) return null;
      return {
        shopifyProductId: p.id,
        confidence: Math.min(confidence, 95),
        reason: `[DEMO] ${reasons.join(", ")}`,
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.confidence - a.confidence);
}

// Given a vehicle (year/make/model) and a list of candidate Shopify products,
// asks Gemini (or Claude) which products are likely compatible.
export async function suggestFitmentProducts({ year, make, model, products }) {
  if (!products?.length) return { suggestions: [], mock: !isAiConfigured() };

  const productList = products
    .map((p) => `- id="${p.id}" title="${p.title}" description="${(p.description || "").slice(0, 200).replace(/"/g, "'")}"`)
    .join("\n");

  const prompt = `You are an AI catalog fitment assistant for a Shopify store matching products to vehicle applications.

Target Vehicle: ${year} ${make} ${model}

Store Catalog Products:
${productList}

Analyze the store products and select up to 10 products that could fit or apply to this vehicle (${year} ${make} ${model}).
Criteria:
1. Exact or partial vehicle specification matches (matching make, model, year, or vehicle type in title/description).
2. Universal/Generic products (accessories, gear, general items compatible across vehicles).
3. Best plausible catalog matches.

Return ONLY a JSON array (no markdown code blocks, no intro text):
[
  { "id": "<exact product id from above>", "confidence": <integer 30-100>, "reason": "<concise reason under 10 words>" }
]
If exact vehicle matches exist, assign 80-100 confidence. If generic/universal or best catalog candidates, assign 40-75 confidence.`;

  let text = null;

  // 1. Try Gemini Free API first if GEMINI_API_KEY is configured
  if (process.env.GEMINI_API_KEY) {
    text = await callGeminiApi(prompt);
  }

  // 2. Try Anthropic API if Gemini wasn't used or failed
  if (!text && process.env.ANTHROPIC_API_KEY) {
    const anthropic = getAnthropicClient();
    if (anthropic) {
      try {
        const response = await anthropic.messages.create({
          model: ANTHROPIC_MODEL,
          max_tokens: 1024,
          messages: [{ role: "user", content: prompt }],
        });
        text = response.content?.[0]?.type === "text" ? response.content[0].text : "[]";
      } catch (err) {
        console.error("[ai.server] Anthropic error:", err);
      }
    }
  }

  // 3. Fallback to mock keyword matching if no API response
  if (!text) {
    return { suggestions: mockSuggestFitmentProducts({ year, make, model, products }), mock: true };
  }

  let parsed;
  try {
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    parsed = JSON.parse(jsonMatch ? jsonMatch[0] : text);
  } catch (err) {
    console.error("[ai.server] Failed to parse AI response:", text, err);
    return { suggestions: [], mock: false };
  }
  if (!Array.isArray(parsed)) return { suggestions: [], mock: false };

  const validIds = new Set(products.map((p) => p.id));
  const suggestions = parsed
    .filter((item) => item && typeof item.id === "string" && validIds.has(item.id))
    .map((item) => ({
      shopifyProductId: item.id,
      confidence: Math.max(0, Math.min(100, parseInt(item.confidence, 10) || 0)),
      reason: String(item.reason || "").slice(0, 200),
    }))
    .sort((a, b) => b.confidence - a.confidence);

  return { suggestions, mock: false };
}

// Scans an entire list of products and extracts vehicle fitment rules directly from titles & descriptions
export async function extractFitmentFromProductCatalog(products) {
  if (!products?.length) return { extracted: [], mock: !isAiConfigured() };

  const productList = products
    .slice(0, 25)
    .map((p) => `- id="${p.id}" handle="${p.handle}" title="${p.title}" desc="${(p.description || "").slice(0, 150).replace(/"/g, "'")}"`)
    .join("\n");

  const prompt = `Analyze these auto parts products and extract vehicle compatibility (Year, Make, Model, Trim).
Products:
${productList}

Return ONLY a JSON array of mappings:
[{"productId": "<id>", "handle": "<handle>", "productTitle": "<title>", "year": "<YYYY>", "make": "<Make>", "model": "<Model>", "trim": "<Trim or empty>", "confidence": <80-100>, "reason": "<short explanation>"}]
If no specific vehicle is mentioned, return [].`;

  let text = null;

  // 1. Try Gemini Free API first
  if (process.env.GEMINI_API_KEY) {
    text = await callGeminiApi(prompt);
  }

  // 2. Try Anthropic API
  if (!text && process.env.ANTHROPIC_API_KEY) {
    const anthropic = getAnthropicClient();
    if (anthropic) {
      try {
        const response = await anthropic.messages.create({
          model: ANTHROPIC_MODEL,
          max_tokens: 2048,
          messages: [{ role: "user", content: prompt }],
        });
        text = response.content?.[0]?.type === "text" ? response.content[0].text : "[]";
      } catch (err) {
        console.error("[ai.server] Anthropic error:", err);
      }
    }
  }

  // 3. Fallback pattern matching if no API key is configured or API failed
  if (!text) {
    const extracted = [];
    const yearPattern = /\b(19\d{2}|20\d{2})\b/g;
    const commonMakes = ["honda", "toyota", "ford", "chevrolet", "bmw", "audi", "mercedes", "nissan", "dodge", "jeep", "hyundai", "kia"];

    products.forEach((p) => {
      const textStr = `${p.title} ${p.description || ""}`.toLowerCase();
      const years = textStr.match(yearPattern) || ["2022"];
      const makeMatch = commonMakes.find((m) => textStr.includes(m));

      if (makeMatch) {
        const make = makeMatch.charAt(0).toUpperCase() + makeMatch.slice(1);
        const words = textStr.split(/\s+/);
        const makeIdx = words.indexOf(makeMatch);
        const modelCandidate = words[makeIdx + 1] ? words[makeIdx + 1].toUpperCase() : "GENERAL";

        years.slice(0, 3).forEach((yr) => {
          extracted.push({
            shopifyProductId: p.id,
            shopifyHandle: p.handle || "",
            productTitle: p.title,
            year: yr,
            make: make,
            model: modelCandidate,
            trim: "",
            confidence: 80,
            reason: `[DEMO] Matched ${make} ${modelCandidate} in product title`,
          });
        });
      }
    });
    return { extracted, mock: true };
  }

  try {
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : "[]");

    const validExtracted = (Array.isArray(parsed) ? parsed : []).map((item) => ({
      shopifyProductId: item.productId || item.id,
      shopifyHandle: item.handle || "",
      productTitle: item.productTitle || "",
      year: String(item.year || ""),
      make: String(item.make || ""),
      model: String(item.model || ""),
      trim: String(item.trim || ""),
      confidence: Math.min(100, Math.max(0, parseInt(item.confidence, 10) || 85)),
      reason: String(item.reason || "AI Extracted Fitment").slice(0, 150),
    })).filter((item) => item.year && item.make && item.model);

    return { extracted: validExtracted, mock: false };
  } catch (err) {
    console.error("[ai.server] Catalog extraction error:", err);
    return { extracted: [], mock: false };
  }
}


