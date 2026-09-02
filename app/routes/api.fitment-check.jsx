const json = (data, init) => Response.json(data, init);
import { authenticate, unauthenticated } from "../shopify.server";
import prisma from "../db.server";
import { getShopPlan, planLimits } from "../plans.server";

// GET /apps/partmatch/api/fitment-check?handle=&year=&make=&model=
export async function loader({ request }) {
  const { session } = await authenticate.public.appProxy(request);

  if (!session) {
    return json({ error: "Unauthorized", fits: false }, { status: 401 });
  }

  const shop = session.shop;
  const url = new URL(request.url);
  const handle = url.searchParams.get("handle");
  const year = url.searchParams.get("year");
  const make = url.searchParams.get("make");
  const model = url.searchParams.get("model");
  const trim = url.searchParams.get("trim") || "";

  if (!handle || !year || !make || !model) {
    return json({ error: "Missing parameters", fits: false, status: "UNKNOWN" }, { status: 400 });
  }

  const vehicleTitle = `${year} ${make} ${model} ${trim}`.trim();

  const [appSettings, shopPlan] = await Promise.all([
    prisma.appSettings?.findUnique({ where: { shop } }),
    getShopPlan(shop),
  ]);
  const limits = planLimits(shopPlan.plan);

  if (!limits.fitmentChecker) {
    return json({ fits: false, status: "UNKNOWN", reason: "plan_restricted" });
  }

  const includeUniversal = (appSettings?.includeUniversal ?? true) && limits.universalProducts;

  // Check if product is universal
  if (includeUniversal) {
    const universal = await prisma.universalProduct?.findFirst({
      where: { shop, shopifyHandle: handle },
    });
    if (universal) {
      return json({
        fits: true,
        status: "FITS",
        badgeText: `✓ Universal Fit for ${vehicleTitle}`,
        badgeColor: "#10b981",
        reason: "universal",
      });
    }
  }

  // Check fitment mapping (products, collections, tags)
  const whereClause = { shop, year, make, model };
  if (trim) {
    whereClause.trim = trim;
  }

  const fitment = await prisma.fitmentRecord?.findFirst({
    where: whereClause,
    include: {
      products: {
        where: { shopifyHandle: handle },
        take: 1,
      },
      collections: true,
      tags: true,
      skus: true,
    },
  });

  if (!fitment) {
    return json({
      fits: false,
      status: "DOES_NOT_FIT",
      badgeText: `✕ Does NOT fit ${vehicleTitle}`,
      badgeColor: "#ef4444",
      fitmentId: null,
    });
  }

  // 1. Direct product match
  if (fitment.products && fitment.products.length > 0) {
    return json({
      fits: true,
      status: "FITS",
      badgeText: `✓ Confirmed Fit for ${vehicleTitle}`,
      badgeColor: "#10b981",
      fitmentId: fitment.id,
      matchedBy: "product",
    });
  }

  const assignedCollections = fitment.collections || [];
  const assignedTags = fitment.tags || [];
  const assignedSkus = fitment.skus || [];

  // 2. Collection, Tag, or SKU match via Shopify GraphQL
  if (assignedCollections.length > 0 || assignedTags.length > 0 || assignedSkus.length > 0) {
    try {
      const { admin } = await unauthenticated.admin(shop);
      const prodRes = await admin.graphql(
        `query getProdInfo($handle: String!) {
          productByHandle(handle: $handle) {
            id
            tags
            variants(first: 30) {
              nodes {
                sku
              }
            }
            collections(first: 30) {
              nodes {
                handle
              }
            }
          }
        }`,
        { variables: { handle } },
      );
      const prodData = await prodRes.json();
      const productInfo = prodData.data?.productByHandle;

      if (productInfo) {
        // Check Collection match
        const prodColHandles = new Set(
          (productInfo.collections?.nodes ?? []).map((c) => c.handle.toLowerCase()),
        );
        const colMatch = assignedCollections.some((c) =>
          c.shopifyHandle && prodColHandles.has(c.shopifyHandle.toLowerCase()),
        );
        if (colMatch) {
          return json({
            fits: true,
            status: "FITS",
            badgeText: `✓ Compatible Fit for ${vehicleTitle}`,
            badgeColor: "#10b981",
            fitmentId: fitment.id,
            matchedBy: "collection",
          });
        }

        // Check Tag match
        const prodTags = new Set(
          (productInfo.tags ?? []).map((t) => t.toLowerCase().replace(/^#/, "")),
        );
        const tagMatch = assignedTags.some((t) =>
          t.tag && prodTags.has(t.tag.toLowerCase().replace(/^#/, "")),
        );
        if (tagMatch) {
          return json({
            fits: true,
            status: "FITS",
            badgeText: `✓ Compatible Fit for ${vehicleTitle}`,
            badgeColor: "#10b981",
            fitmentId: fitment.id,
            matchedBy: "tag",
          });
        }

        // Check SKU match
        const prodSkus = new Set(
          (productInfo.variants?.nodes ?? [])
            .map((v) => v.sku?.trim().toLowerCase())
            .filter(Boolean),
        );
        const skuMatch = assignedSkus.some((s) =>
          s.sku && prodSkus.has(s.sku.trim().toLowerCase()),
        );
        if (skuMatch) {
          return json({
            fits: true,
            status: "FITS",
            badgeText: `✓ Compatible Fit for ${vehicleTitle}`,
            badgeColor: "#10b981",
            fitmentId: fitment.id,
            matchedBy: "sku",
          });
        }
      }
    } catch (err) {
      console.error("[api/fitment-check] Error verifying Shopify collection/tag/sku fitment:", err);
    }
  }

  return json({
    fits: false,
    status: "DOES_NOT_FIT",
    badgeText: `✕ Does NOT fit ${vehicleTitle}`,
    badgeColor: "#ef4444",
    fitmentId: fitment.id,
  });
}
