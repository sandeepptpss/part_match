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
      // Ignore proxy auth error and fallback to query params or DB
    }

    const url = new URL(req.url);
    const paramShop = url.searchParams.get("shop");
    if (paramShop) return paramShop;

    const firstRecord = await prisma.fitmentRecord.findFirst({ select: { shop: true } });
    if (firstRecord?.shop) return firstRecord.shop;

    const firstSettings = await prisma.appSettings.findFirst({ select: { shop: true } });
    if (firstSettings?.shop) return firstSettings.shop;

    return null;
  }

  const COMMON_MAKES = [
    "Acura", "Alfa Romeo", "Aston Martin", "Audi", "Bentley", "BMW", "Buick",
    "Cadillac", "Chevrolet", "Chrysler", "Dodge", "Ferrari", "Fiat", "Ford",
    "GMC", "Honda", "Hyundai", "Infiniti", "Jaguar", "Jeep", "Kia", "Lamborghini",
    "Land Rover", "Lexus", "Lincoln", "Maserati", "Mazda", "McLaren", "Mercedes-Benz",
    "Mini", "Mitsubishi", "Nissan", "Porsche", "RAM", "Rolls-Royce", "Subaru",
    "Tesla", "Toyota", "Volkswagen", "Volvo", "Arctic Cat", "Polaris", "Can-Am", "Yamaha", "Kawasaki", "Harley-Davidson"
  ];

  function parseNaturalLanguageQuery(text) {
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
    for (const m of COMMON_MAKES) {
      if (lowerRaw.includes(m.toLowerCase())) {
        make = m;
        break;
      }
    }

    if (make) {
      const makeIdx = lowerRaw.indexOf(make.toLowerCase());
      const afterMake = raw.substring(makeIdx + make.length).trim();
      const tokens = afterMake.split(/\s+/).filter(Boolean);

      if (tokens.length > 0 && !/^(for|with|in|and|the|a|an|parts?|for|of)$/i.test(tokens[0])) {
        model = tokens[0];
        if (tokens.length > 1 && /^(EX|LX|DX|Si|Type R|SE|LE|XLE|XSE|LT|LTZ|LS|XL|XLT|Lariat|King Ranch|Platinum|Limited|Sport|Base|GT|S|RS|M|ST|TRD)$/i.test(tokens[1])) {
          trim = tokens[1];
        }
      }
    }

    const keywordsList = [
      "brake pads", "brakes", "brake rotors", "rotors", "oil filter", "air filter",
      "cabin filter", "wipers", "wiper blades", "spark plugs", "headlights", "battery",
      "shocks", "struts", "alternator", "starter", "radiator", "exhaust", "muffler",
      "tires", "wheels", "floor mats", "seat covers"
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

  const parsed = parseNaturalLanguageQuery(queryText);
  const { year, make, model, trim, keyword } = parsed;

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
    const matchedKws = products.filter((p) => (p.productTitle || p.shopifyHandle || "").toLowerCase().includes(kwLower));
    if (matchedKws.length > 0) {
      products = matchedKws;
    }
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
    if (year && make && model) {
      await prisma.searchLog?.create({
        data: {
          shop,
          year,
          make,
          model,
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
