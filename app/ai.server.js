import Anthropic from "@anthropic-ai/sdk";

const MODEL = "claude-haiku-4-5-20251001";

let client;
function getClient() {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  if (!client) client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return client;
}

export function isAiConfigured() {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

// No ANTHROPIC_API_KEY set: simulate suggestions via plain keyword matching so
// the UI flow (button, badges, accept/reject) can be tested at zero cost.
// Every reason is prefixed "[DEMO]" so it's never mistaken for a real AI call.
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

// Given a vehicle (year/make/model) and a list of candidate Shopify products
// ({ id, title, description }), asks Claude which products are likely
// compatible and returns them sorted by confidence, highest first.
// Returns { suggestions, mock } — mock is true when no API key is configured
// and results came from the keyword-matching fallback above instead of Claude.
export async function suggestFitmentProducts({ year, make, model, products }) {
  const anthropic = getClient();
  if (!products?.length) return { suggestions: [], mock: !anthropic };
  if (!anthropic) {
    return { suggestions: mockSuggestFitmentProducts({ year, make, model, products }), mock: true };
  }

  const productList = products
    .map((p) => `- id="${p.id}" title="${p.title}" description="${(p.description || "").slice(0, 200).replace(/"/g, "'")}"`)
    .join("\n");

  const prompt = `You are helping an auto parts store match products to a specific vehicle.

Vehicle: ${year} ${make} ${model}

Store products:
${productList}

Return ONLY a JSON array (no prose, no markdown fences) of the products likely compatible with this vehicle — based on their title/description mentioning this make/model/year (directly or within a stated range), or being a generic/universal part that would plausibly fit any vehicle. Each item: {"id": "<exact id from above>", "confidence": <integer 0-100>, "reason": "<reason, under 12 words>"}. If nothing plausibly matches, return [].`;

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 1024,
    messages: [{ role: "user", content: prompt }],
  });

  const text = response.content?.[0]?.type === "text" ? response.content[0].text : "[]";

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
  const anthropic = getClient();
  if (!products?.length) return { extracted: [], mock: !anthropic };

  // Fallback pattern matching if no API key is set
  if (!anthropic) {
    const extracted = [];
    const yearPattern = /\b(19\d{2}|20\d{2})\b/g;
    const commonMakes = ["honda", "toyota", "ford", "chevrolet", "bmw", "audi", "mercedes", "nissan", "dodge", "jeep", "hyundai", "kia"];

    products.forEach((p) => {
      const text = `${p.title} ${p.description || ""}`.toLowerCase();
      const years = text.match(yearPattern) || ["2022"];
      const makeMatch = commonMakes.find((m) => text.includes(m));

      if (makeMatch) {
        const make = makeMatch.charAt(0).toUpperCase() + makeMatch.slice(1);
        const words = text.split(/\s+/);
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

  try {
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 2048,
      messages: [{ role: "user", content: prompt }],
    });

    const text = response.content?.[0]?.type === "text" ? response.content[0].text : "[]";
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

