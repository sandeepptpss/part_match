const json = (data, init) => Response.json(data, init);
import { authenticate } from "../shopify.server";
import { getShopPlan, planLimits } from "../plans.server";
import prisma from "../db.server";

// POST or GET /apps/partmatch/api/vin-lookup?vin= (proxied storefront request)
export async function action({ request }) {
  const { session } = await authenticate.public.appProxy(request);

  if (!session) {
    return json({ error: "Unauthorized" }, { status: 401 });
  }

  const shopPlan = await getShopPlan(session.shop);
  const limits = planLimits(shopPlan?.plan || "free");
  if (!limits.vinLookup) {
    return json(
      { error: "VIN Lookup requires a Growth Professional or Enterprise plan subscription." },
      { status: 403 }
    );
  }

  // Calculate current month VIN lookup count
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  const monthVinCount = await prisma.vinLookupLog.count({
    where: {
      shop: session.shop,
      createdAt: { gte: startOfMonth },
    },
  });

  // Check Merchant VIN Safety Cap Settings to prevent over-billing
  const appSettings = await prisma.appSettings.findFirst({ where: { shop: session.shop } });
  if (appSettings?.vinCapEnabled && monthVinCount >= (appSettings.vinMonthlyCapLimit || 50)) {
    return json(
      {
        error: `Store monthly VIN safety cap limit (${appSettings.vinMonthlyCapLimit} lookups) reached. Over-billing budget guard active.`,
        capReached: true,
      },
      { status: 429 }
    );
  }

  // Check if monthly limit reached for non-unlimited plans
  if (limits.vinMonthlyLimit && Number.isFinite(limits.vinMonthlyLimit) && monthVinCount >= limits.vinMonthlyLimit) {
    // Note: In live Shopify Billing usage charges, extra lookups can be billed at limits.vinOverageRate ($0.05)
    console.log(`[VIN Lookup] Store ${session.shop} reached monthly limit of ${limits.vinMonthlyLimit} lookups. Overage rate: $${limits.vinOverageRate}/lookup.`);
  }

  let vin = "";
  if (request.method === "POST") {
    try {
      const body = await request.json();
      vin = body?.vin || "";
    } catch {
      return json({ error: "Invalid JSON body" }, { status: 400 });
    }
  } else {
    const url = new URL(request.url);
    vin = url.searchParams.get("vin") || "";
  }

  vin = vin.trim().toUpperCase();
  if (!vin || vin.length !== 17) {
    return json({ error: "Invalid VIN. Please provide a valid 17-character VIN." }, { status: 400 });
  }

  try {
    const response = await fetch(
      `https://vpic.nhtsa.dot.gov/api/vehicles/decodevinvalues/${encodeURIComponent(vin)}?format=json`,
    );
    if (!response.ok) {
      return json({ error: "Failed to decode VIN from vehicle registry" }, { status: 502 });
    }

    const data = await response.json();
    const result = data?.Results?.[0];

    if (!result || !result.Make) {
      return json({ error: "Vehicle details not found for this VIN" }, { status: 444 });
    }

    const year = result.ModelYear || "";
    const make = result.Make || "";
    const model = result.Model || "";
    const trim = result.Trim || result.DisplacementL ? `${result.Trim || ""} ${result.DisplacementL ? result.DisplacementL + "L" : ""}`.trim() : "";
    const vehicleTitle = `${year} ${make} ${model} ${trim}`.trim();

    // Log successful VIN lookup for usage tracking
    try {
      await prisma.vinLookupLog.create({
        data: {
          shop: session.shop,
          vin,
          vehicle: vehicleTitle,
        },
      });
    } catch (logErr) {
      console.error("[api/vin-lookup] Error logging lookup:", logErr);
    }

    return json({
      success: true,
      vin,
      year,
      make,
      model,
      trim,
      vehicleTitle,
      usage: {
        usedThisMonth: monthVinCount + 1,
        monthlyLimit: limits.vinMonthlyLimit,
        overageRate: limits.vinOverageRate,
      },
    });
  } catch (err) {
    console.error("[api/vin-lookup]", err);
    return json({ error: "Internal server error during VIN lookup" }, { status: 500 });
  }
}

export async function loader(args) {
  return action(args);
}

