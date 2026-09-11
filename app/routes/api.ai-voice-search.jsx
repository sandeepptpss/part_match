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
  ];

  function parseNaturalLanguageQuery(text, availableMakes = BASE_MAKES) {
    if (!text) return { year: "", make: "", model: "", trim: "", keyword: "" };

    const raw = text.trim();
    let year = "";
    let make = "";
    let model = "";
    let trim = "";
    let keyword = "";

    const yearMatch = raw.match(/\b(19[5-9]\d|20[0-3]\d)\b/);
    if (yearMatch) year = yearMatch[1];

    const lowerRaw = raw.toLowerCase();
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

    const keywordsList = [
      "brake pads", "brakes", "brake rotors", "rotors", "oil filter", "air filter",
      "cabin filter", "fuel filter", "wipers", "wiper blades", "spark plugs", "headlights",
      "tail lights", "fog lights", "battery", "shocks", "struts", "alternator", "starter",
      "radiator", "exhaust", "muffler", "tires", "wheels", "floor mats", "seat covers",
      "motor oil", "engine oil", "clutch", "suspension", "timing belt", "serpentine belt",
      "coolant", "transmission fluid", "brake fluid"
    ];

    for (const k of keywordsList) {
      if (lowerRaw.includes(k)) {
        keyword = k;
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
  const fitmentProductCount = productMap.size;

  // Include Universal Products if query matches or is general
  if (includeUniversal) {
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
    speechResponse = `Found ${resultCount} matching ${keyword || "parts"} for your ${vehicleTitle || "vehicle"}.`;
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
