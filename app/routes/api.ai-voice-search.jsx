// POST or GET /apps/partmatch/api/ai-voice-search?query=
export async function action({ request }) {
  const { authenticate, unauthenticated } = await import("../shopify.server");
  const { default: prisma } = await import("../db.server");
  const { getShopPlan, planLimits } = await import("../plans.server");

  async function getShopFromRequest(req) {
    try {
      const { session } = await authenticate.public.appProxy(req);
      if (session?.shop) return session.shop;
    } catch (err) {
      // App Proxy signature missing or invalid
    }
    // Only allow ?shop= fallback in development (never in production)
    if (process.env.NODE_ENV !== "production") {
      try {
        const url = new URL(req.url);
        const queryShop = url.searchParams.get("shop");
        if (queryShop) return queryShop;
        if (req.method === "POST") {
          const cloned = req.clone();
          const b = await cloned.json().catch(() => ({}));
          if (b?.shop) return b.shop;
        }
      } catch {
        // ignore
      }
    }
    return null;
  }

  const BASE_MAKES = [
    "Acura", "Alfa Romeo", "Aston Martin", "Audi", "Bentley", "BMW", "Bugatti", "Buick",
    "Cadillac", "Chevrolet", "Chevy", "Chrysler", "Dodge", "Ferrari", "Fiat", "Ford",
    "Genesis", "GMC", "Honda", "Hyundai", "Infiniti", "Jaguar", "Jeep", "Kia", "Lamborghini",
    "Land Rover", "Lexus", "Lincoln", "Maserati", "Mazda", "McLaren", "Mercedes-Benz",
    "Mercedes", "Mini", "Mitsubishi", "Nissan", "Peugeot", "Porsche", "RAM", "Renault",
    "Rolls-Royce", "Subaru", "Tesla", "Toyota", "Volkswagen", "VW", "Volvo", "Arctic Cat",
    "Polaris", "Can-Am", "Yamaha", "Kawasaki", "Harley-Davidson"
  const SPOKEN_YEAR_MAP = {
    "twenty twenty six": "2026",
    "twenty twenty five": "2025",
    "twenty twenty four": "2024",
    "twenty twenty three": "2023",
    "twenty twenty two": "2022",
    "twenty twenty one": "2021",
    "twenty twenty": "2020",
    "twenty nineteen": "2019",
    "twenty eighteen": "2018",
    "twenty seventeen": "2017",
    "twenty sixteen": "2016",
    "twenty fifteen": "2015",
    "twenty fourteen": "2014",
    "twenty thirteen": "2013",
    "twenty twelve": "2012",
    "twenty eleven": "2011",
    "twenty ten": "2010",
  };

  const MODEL_ALIASES = [
    { pattern: /\bf\s*[- ]?150\b/i, replacement: "F-150" },
    { pattern: /\bf\s*one\s*fifty\b/i, replacement: "F-150" },
    { pattern: /\bf\s*[- ]?250\b/i, replacement: "F-250" },
    { pattern: /\bf\s*[- ]?350\b/i, replacement: "F-350" },
    { pattern: /\bsilverado\s*1500\b/i, replacement: "Silverado" },
    { pattern: /\bc\s*[- ]?class\b/i, replacement: "C-Class" },
    { pattern: /\be\s*[- ]?class\b/i, replacement: "E-Class" },
    { pattern: /\bs\s*[- ]?class\b/i, replacement: "S-Class" },
  ];

  function parseNaturalLanguageQuery(text, availableMakes = BASE_MAKES) {
    if (!text) return { year: "", make: "", model: "", trim: "", keyword: "" };

    let raw = text.trim();
    let lowerRaw = raw.toLowerCase();

    // 1. Spoken year phrases normalization (e.g. "twenty twenty six" -> "2026")
    for (const [spoken, digitYear] of Object.entries(SPOKEN_YEAR_MAP)) {
      if (lowerRaw.includes(spoken)) {
        lowerRaw = lowerRaw.replace(spoken, digitYear);
        raw = raw.replace(new RegExp(spoken, "i"), digitYear);
        break;
      }
    }

    // 2. Slang / Brand Aliases
    if (/\b(bimmer|beamer)\b/i.test(raw)) {
      raw = raw.replace(/\b(bimmer|beamer)\b/ig, "BMW");
      lowerRaw = raw.toLowerCase();
    }

    // 3. Model Aliases (e.g. "f one fifty" or "f150" -> "F-150")
    for (const ma of MODEL_ALIASES) {
      if (ma.pattern.test(raw)) {
        raw = raw.replace(ma.pattern, ma.replacement);
        lowerRaw = raw.toLowerCase();
      }
    }

    let year = "";
    let make = "";
    let model = "";
    let trim = "";
    let keyword = "";

    const yearMatch = raw.match(/\b(19[5-9]\d|20[0-3]\d)\b/);
    if (yearMatch) year = yearMatch[1];

    const sortedMakes = [...availableMakes].sort((a, b) => b.length - a.length);
    for (const m of sortedMakes) {
      if (lowerRaw.includes(m.toLowerCase())) {
        make = m;
        break;
      }
    }

    if (make) {
      const makeIdx = lowerRaw.indexOf(make.toLowerCase());
      const afterMake = raw.substring(makeIdx + make.length).trim();
      const tokens = afterMake.split(/\s+/).filter(Boolean);
      const meaningfulTokens = tokens.filter(
        (t) => !/^(for|with|in|and|the|a|an|parts?|of|car|vehicle)$/i.test(t)
      );

      if (meaningfulTokens.length > 0) {
        model = meaningfulTokens[0];

        // Multi-word trims (Type R, King Ranch, Trail Boss)
        if (
          meaningfulTokens.length > 2 &&
          /^(type\s+r|king\s+ranch|trail\s+boss|grand\s+touring)$/i.test(
            `${meaningfulTokens[1]} ${meaningfulTokens[2]}`
          )
        ) {
          trim = `${meaningfulTokens[1]} ${meaningfulTokens[2]}`;
        } else if (
          meaningfulTokens.length > 1 &&
          /^(EX|LX|DX|Si|SE|LE|XLE|XSE|LT|LTZ|LS|XL|XLT|Lariat|Platinum|Limited|Sport|Base|GT|S|RS|M|ST|TRD)$/i.test(
            meaningfulTokens[1]
          )
        ) {
          trim = meaningfulTokens[1];
        }
      }
    }

    // Keyword detection with specificity ordering (multi-word phrases first, then single-word tokens)
    const KEYWORD_SYNONYMS = [
      { synonym: /\b(brake\s*rotors?)\b/i, canonical: "brake rotors" },
      { synonym: /\b(brake\s*pads?)\b/i, canonical: "brake pads" },
      { synonym: /\b(brake\s*fluids?)\b/i, canonical: "brake fluid" },
      { synonym: /\b(oil\s*filters?)\b/i, canonical: "oil filter" },
      { synonym: /\b(air\s*filters?)\b/i, canonical: "air filter" },
      { synonym: /\b(cabin\s*filters?)\b/i, canonical: "cabin filter" },
      { synonym: /\b(fuel\s*filters?)\b/i, canonical: "fuel filter" },
      { synonym: /\b(wiper\s*blades?|windshield\s*wipers?)\b/i, canonical: "wiper blades" },
      { synonym: /\b(spark\s*plugs?)\b/i, canonical: "spark plugs" },
      { synonym: /\b(head\s*lights?|headlights?)\b/i, canonical: "headlights" },
      { synonym: /\b(tail\s*lights?|taillights?)\b/i, canonical: "tail lights" },
      { synonym: /\b(fog\s*lights?|foglights?)\b/i, canonical: "fog lights" },
      { synonym: /\b(floor\s*mats?)\b/i, canonical: "floor mats" },
      { synonym: /\b(seat\s*covers?)\b/i, canonical: "seat covers" },
      { synonym: /\b(timing\s*belts?)\b/i, canonical: "timing belt" },
      { synonym: /\b(serpentine\s*belts?)\b/i, canonical: "serpentine belt" },
      { synonym: /\b(engine\s*oil|motor\s*oil)\b/i, canonical: "engine oil" },
      { synonym: /\b(transmission\s*fluids?)\b/i, canonical: "transmission fluid" },
      // Single-word tokens and homophones
      { synonym: /\b(rotors?|discs?)\b/i, canonical: "rotors" },
      { synonym: /\b(brakes?|breaks)\b/i, canonical: "brakes" },
      { synonym: /\b(pads?)\b/i, canonical: "brake pads" },
      { synonym: /\b(wipers?)\b/i, canonical: "wipers" },
      { synonym: /\b(batter(y|ies))\b/i, canonical: "battery" },
      { synonym: /\b(shocks?|struts?)\b/i, canonical: "shocks" },
      { synonym: /\b(alternators?)\b/i, canonical: "alternator" },
      { synonym: /\b(starters?)\b/i, canonical: "starter" },
      { synonym: /\b(radiators?)\b/i, canonical: "radiator" },
      { synonym: /\b(exhausts?|mufflers?)\b/i, canonical: "exhaust" },
      { synonym: /\b(tires?|wheels?)\b/i, canonical: "tires" },
      { synonym: /\b(clutches?|clutch)\b/i, canonical: "clutch" },
      { synonym: /\b(suspensions?)\b/i, canonical: "suspension" },
      { synonym: /\b(coolants?|antifreeze)\b/i, canonical: "coolant" },
    ];

    for (const ks of KEYWORD_SYNONYMS) {
      if (ks.synonym.test(lowerRaw)) {
        keyword = ks.canonical;
        break;
      }
    }

    return { year, make, model, trim, keyword, rawQuery: text };
  }

  const shop = await getShopFromRequest(request);
  if (!shop) {
    return Response.json({ error: "Could not resolve shop for AI Voice search request", success: false }, { status: 400 });
  }

  let queryText = "";
  let sessionId = null;

  if (request.method === "POST") {
    try {
      const body = await request.json();
      queryText = body?.query || body?.text || "";
      sessionId = body?.sessionId || null;
    } catch {
      return Response.json({ error: "Invalid JSON body" }, { status: 400 });
    }
  } else {
    const url = new URL(request.url);
    queryText = url.searchParams.get("query") || url.searchParams.get("q") || "";
    sessionId = url.searchParams.get("sessionId") || null;
  }

  if (!queryText.trim()) {
    return Response.json({ error: "Query parameter is required", success: false }, { status: 400 });
  }

  // Sanitize inputs: limit length to prevent abuse
  queryText = queryText.trim().slice(0, 500);
  sessionId = sessionId ? String(sessionId).trim().slice(0, 200) : null;

  // Dynamically include merchant's store makes & models
  let distinctDbMakes = [];
  let distinctDbModels = [];
  try {
    const [dbMakes, dbModels] = await Promise.all([
      prisma.fitmentRecord.findMany({
        where: { shop },
        select: { make: true },
        distinct: ["make"],
      }),
      prisma.fitmentRecord.findMany({
        where: { shop },
        select: { model: true },
        distinct: ["model"],
      }),
    ]);
    distinctDbMakes = dbMakes.map((d) => d.make).filter(Boolean);
    distinctDbModels = dbModels.map((d) => d.model).filter(Boolean);
  } catch (dbErr) {
    // fallback to BASE_MAKES
  }
  const combinedMakes = Array.from(new Set([...BASE_MAKES, ...distinctDbMakes]));

  const parsed = parseNaturalLanguageQuery(queryText, combinedMakes);
  let { year, make, model, trim, keyword } = parsed;

  // Check if store models match afterMake or query
  const qLower = queryText.toLowerCase();
  if (make && distinctDbModels.length > 0) {
    const sortedDbModels = [...distinctDbModels].sort((a, b) => b.length - a.length);
    for (const dm of sortedDbModels) {
      if (qLower.includes(dm.toLowerCase())) {
        model = dm;
        break;
      }
    }
  }

  const [appSettings, shopPlan] = await Promise.all([
    prisma.appSettings?.findUnique({ where: { shop } }),
    getShopPlan(shop),
  ]);
  const limits = planLimits(shopPlan?.plan || "free");
  if (!limits.voiceSearchAssistant) {
    return Response.json(
      {
        error: "AI Voice & Conversational Search requires the Growth Professional or Enterprise plan.",
        success: false,
      },
      { status: 403 }
    );
  }
  const includeUniversal = (appSettings?.includeUniversal ?? true) && limits.universalProducts;

  let fitments = [];
  if (year && make) {
    fitments = await prisma.fitmentRecord?.findMany({
      where: {
        shop,
        year,
        make: { equals: make },
        ...(model ? { model: { contains: model } } : {}),
        ...(trim ? { trim: { contains: trim } } : {}),
      },
      include: {
        products: true,
        collections: true,
        tags: true,
        skus: true,
      },
    }) ?? [];
  } else if (make) {
    fitments = await prisma.fitmentRecord?.findMany({
      where: {
        shop,
        make: { equals: make },
        ...(model ? { model: { contains: model } } : {}),
        ...(trim ? { trim: { contains: trim } } : {}),
      },
      include: {
        products: true,
        collections: true,
        tags: true,
        skus: true,
      },
      take: 50,
    }) ?? [];
  } else if (year) {
    fitments = await prisma.fitmentRecord?.findMany({
      where: { shop, year },
      include: { products: true, collections: true, tags: true, skus: true },
      take: 20,
    }) ?? [];
  }

  const productMap = new Map();
  fitments.forEach((f) => {
    (f.products || []).forEach((p) => {
      const key = p.shopifyProductId || p.shopifyHandle;
      if (key) {
        productMap.set(key, {
          shopifyProductId: p.shopifyProductId,
          shopifyHandle: p.shopifyHandle,
          productTitle: p.productTitle,
          source: "fitment_product",
        });
      }
    });
  });

  const vehicleQueried = Boolean(year || make || model);

  // If neither a vehicle nor a recognized automotive keyword is present, treat as unrecognized query
  if (!vehicleQueried && !keyword) {
    return Response.json({
      success: true,
      query: queryText,
      parsedVehicle: {
        year: null,
        make: null,
        model: null,
        trim: null,
        vehicleTitle: null,
      },
      keyword: null,
      speechResponse: "We couldn't detect an automotive vehicle or part in your request. Please speak your vehicle Year, Make, Model, or part name (e.g. 2024 Chevy Silverado brake pads).",
      products: [],
      resultCount: 0,
      hasResults: false,
    });
  }

  const fitmentProductCount = productMap.size;

  // Include Universal Products only when matching vehicle fitments exist or specific auto part keyword is queried
  if (includeUniversal && (fitmentProductCount > 0 || (keyword && !vehicleQueried))) {
    const universal = await prisma.universalProduct?.findMany({
      where: { shop },
      take: 10,
    }) ?? [];
    universal.forEach((u) => {
      const key = u.shopifyProductId || u.shopifyHandle;
      if (key && !productMap.has(key)) {
        productMap.set(key, {
          shopifyProductId: u.shopifyProductId,
          shopifyHandle: u.shopifyHandle,
          productTitle: u.productTitle,
          source: "universal",
        });
      }
    });
  }

  let products = Array.from(productMap.values());

  // If keyword filter present, prioritize products matching keyword
  if (keyword && products.length > 0) {
    const kwLower = keyword.toLowerCase();
    const kwSingular = kwLower.replace(/s$/, "");
    const matchedKws = products.filter((p) => {
      const title = (p.productTitle || p.shopifyHandle || "").toLowerCase();
      return title.includes(kwLower) || title.includes(kwSingular);
    });
    if (matchedKws.length > 0) {
      products = matchedKws;
    } else if (vehicleQueried && fitmentProductCount === 0) {
      products = [];
    }
  } else if (vehicleQueried && fitmentProductCount === 0) {
    products = [];
  }

  const resultCount = products.length;
  const vehicleTitle = [year, make, model, trim].filter(Boolean).join(" ");

  let speechResponse = "";
  if (resultCount > 0) {
    if (vehicleTitle) {
      speechResponse = `Found ${resultCount} matching ${keyword || "parts"} for your ${vehicleTitle}.`;
    } else {
      speechResponse = `Found ${resultCount} matching ${keyword || "parts"}. Please specify your vehicle for guaranteed fitment.`;
    }
  } else if (vehicleTitle) {
    speechResponse = `No exact matches found for ${vehicleTitle}. Try searching by Year, Make and Model.`;
  } else {
    speechResponse = `Please specify your vehicle Year, Make, and Model for accurate fitment.`;
  }

  // Log voice / conversational search
  try {
    if (make || model || year) {
      await prisma.searchLog?.create({
        data: {
          shop,
          year: year || "ANY",
          make: make || "ANY",
          model: model || "ANY",
          trim: trim || "",
          resultCount,
          hasResults: resultCount > 0,
          sessionId,
        },
      });
    }
  } catch (logErr) {
    console.error("[api/ai-voice-search] Error logging search:", logErr);
  }

  return Response.json({
    success: true,
    query: queryText,
    parsedVehicle: {
      year: year || null,
      make: make || null,
      model: model || null,
      trim: trim || null,
      vehicleTitle: vehicleTitle || null,
    },
    keyword: keyword || null,
    speechResponse,
    products,
    resultCount,
    hasResults: resultCount > 0,
  });
}

export async function loader(args) {
  return action(args);
}
