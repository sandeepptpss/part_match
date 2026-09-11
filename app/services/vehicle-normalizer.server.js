/**
 * Vehicle Normalizer and Master Vehicle Matching Service
 * 
 * Normalizes user/supplier vehicle input, expands year ranges, resolves make/model aliases,
 * and generates canonical vehicle IDs for consistent database indexing and fitment queries.
 */

const MAKE_ALIASES = {
  chevy: "Chevrolet",
  chevrolet: "Chevrolet",
  vw: "Volkswagen",
  volkswagen: "Volkswagen",
  merc: "Mercedes-Benz",
  mercedes: "Mercedes-Benz",
  "mercedes-benz": "Mercedes-Benz",
  "mercedes benz": "Mercedes-Benz",
  bimmer: "BMW",
  bmw: "BMW",
  cadillac: "Cadillac",
  caddy: "Cadillac",
  mitsu: "Mitsubishi",
  mitsubishi: "Mitsubishi",
  ram: "Ram",
  dodge: "Dodge",
  toyota: "Toyota",
  honda: "Honda",
  ford: "Ford",
  nissan: "Nissan",
  subaru: "Subaru",
  mazda: "Mazda",
  lexus: "Lexus",
  acura: "Acura",
  infiniti: "Infiniti",
  jeep: "Jeep",
  gmc: "GMC",
  chrysler: "Chrysler",
  buick: "Buick",
  lincoln: "Lincoln",
  hyundai: "Hyundai",
  kia: "Kia",
  audi: "Audi",
  porsche: "Porsche",
  volvo: "Volvo",
  jaguar: "Jaguar",
  "land rover": "Land Rover",
  landrover: "Land Rover",
  mini: "MINI",
  polaris: "Polaris",
  "arctic cat": "Arctic Cat",
  arcticcat: "Arctic Cat",
  "can-am": "Can-Am",
  canam: "Can-Am",
  yamaha: "Yamaha",
  kawasaki: "Kawasaki",
  "harley-davidson": "Harley-Davidson",
  "harley davidson": "Harley-Davidson",
  harley: "Harley-Davidson",
};

const MODEL_ALIASES = {
  f150: "F-150",
  "f 150": "F-150",
  f250: "F-250",
  "f 250": "F-250",
  f350: "F-350",
  "f 350": "F-350",
  silverado1500: "Silverado 1500",
  silverado2500: "Silverado 2500",
  silverado3500: "Silverado 3500",
  sierra1500: "Sierra 1500",
  sierra2500: "Sierra 2500",
  ram1500: "1500",
  ram2500: "2500",
};

/**
 * Expands year ranges like "2015-2018", "2015 - 2018", "2015-18", "2015/2016"
 * or single years into an array of string years.
 */
export function expandYearRange(yearInput) {
  if (!yearInput) return [];
  const clean = String(yearInput).trim();

  // Single 4-digit year: "2024"
  if (/^\d{4}$/.test(clean)) {
    return [clean];
  }

  // Two 4-digit years separated by dash/to/slash: "2015-2018", "2015 to 2018", "2015/2018"
  const fullRangeMatch = clean.match(/^(\d{4})\s*(?:-|–|—|to|\/)\s*(\d{4})$/i);
  if (fullRangeMatch) {
    const start = parseInt(fullRangeMatch[1], 10);
    const end = parseInt(fullRangeMatch[2], 10);
    if (start <= end && end - start <= 40) {
      const years = [];
      for (let y = start; y <= end; y++) {
        years.push(String(y));
      }
      return years;
    }
    return [fullRangeMatch[1], fullRangeMatch[2]];
  }

  // 4-digit to 2-digit abbreviation: "2015-18" or "1998-02"
  const shortRangeMatch = clean.match(/^(\d{4})\s*(?:-|–|—)\s*(\d{2})$/);
  if (shortRangeMatch) {
    const start = parseInt(shortRangeMatch[1], 10);
    const century = Math.floor(start / 100) * 100;
    const endPart = parseInt(shortRangeMatch[2], 10);
    let end = century + endPart;
    if (end < start) end += 100;
    if (end - start <= 40) {
      const years = [];
      for (let y = start; y <= end; y++) {
        years.push(String(y));
      }
      return years;
    }
  }

  // Comma separated years: "2015, 2016, 2017"
  if (clean.includes(",")) {
    const splitYears = clean
      .split(",")
      .map((y) => y.trim())
      .filter((y) => /^\d{4}$/.test(y));
    if (splitYears.length > 0) return Array.from(new Set(splitYears));
  }

  // Default fallback to raw clean string
  return [clean];
}

/**
 * Normalizes vehicle Make string using industry alias dictionary.
 */
export function normalizeMake(makeInput) {
  if (!makeInput) return "";
  const key = String(makeInput).trim().toLowerCase();
  if (MAKE_ALIASES[key]) return MAKE_ALIASES[key];

  // Capitalize words if not found in dictionary
  return String(makeInput)
    .trim()
    .replace(/(?:^|\s|-)\S/g, (char) => char.toUpperCase());
}

/**
 * Normalizes vehicle Model string using common models and capitalization.
 */
export function normalizeModel(modelInput) {
  if (!modelInput) return "";
  const key = String(modelInput).trim().toLowerCase().replace(/\s+/g, "");
  if (MODEL_ALIASES[key]) return MODEL_ALIASES[key];

  // Clean standard model string
  return String(modelInput)
    .trim()
    .replace(/\s+/g, " ");
}

/**
 * Normalizes Trim / Sub-Model string.
 */
export function normalizeTrim(trimInput) {
  if (!trimInput) return "";
  let clean = String(trimInput).trim().replace(/\s+/g, " ");

  // Standardize engine displacement e.g. "5.0" -> "5.0L"
  clean = clean.replace(/\b(\d\.\d)(?!\w)/g, "$1L");

  // Standardize drivetrain e.g. "4wd" -> "4WD", "awd" -> "AWD"
  clean = clean.replace(/\b(4wd|awd|rwd|fwd|4x4|4x2)\b/gi, (match) => match.toUpperCase());

  return clean;
}

/**
 * Generates a unique, standardized Canonical Vehicle ID.
 * Format: CANONICAL-{YEAR}-{MAKE}-{MODEL}[-{TRIM}]
 */
export function generateCanonicalVehicleId(year, make, model, trim = "") {
  const cleanSlug = (str) =>
    String(str || "")
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, "-")
      .replace(/^-|-$/g, "");

  const parts = ["CANONICAL", cleanSlug(year), cleanSlug(make), cleanSlug(model)];
  if (trim && trim.trim()) {
    parts.push(cleanSlug(trim));
  }
  return parts.join("-");
}

/**
 * Full vehicle normalization pipeline.
 * Returns an array of normalized vehicle variations (expanding year ranges into individual records).
 */
export function normalizeVehicleRecord({ year, make, model, trim = "" }) {
  const years = expandYearRange(year);
  const normMake = normalizeMake(make);
  const normModel = normalizeModel(model);
  const normTrim = normalizeTrim(trim);

  if (years.length === 0) {
    years.push(String(year || "").trim());
  }

  return years.map((singleYear) => ({
    year: singleYear,
    make: normMake,
    model: normModel,
    trim: normTrim,
    canonicalVehicleId: generateCanonicalVehicleId(singleYear, normMake, normModel, normTrim),
  }));
}
