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

  if (!handle || !year || !make || !model) {
    return json({ error: "Missing parameters", fits: false }, { status: 400 });
  }

  const [appSettings, shopPlan] = await Promise.all([
    prisma.appSettings?.findUnique({ where: { shop } }),
    getShopPlan(shop),
  ]);
  const limits = planLimits(shopPlan.plan);

  if (!limits.fitmentChecker) {
    return json({ fits: false, reason: "plan_restricted" });
  }

  const includeUniversal = (appSettings?.includeUniversal ?? true) && limits.universalProducts;

  // Check if product is universal
  if (includeUniversal) {
    const universal = await prisma.universalProduct?.findFirst({
      where: { shop, shopifyHandle: handle },
    });
    if (universal) {
      return json({ fits: true, reason: "universal" });
    }
  }

  // Check fitment mapping (products, collections, tags)
  const fitment = await prisma.fitmentRecord?.findUnique({
    where: { shop_year_make_model: { shop, year, make, model } },
    include: {
      products: {
        where: { shopifyHandle: handle },
        take: 1,
      },
      collections: true,
      tags: true,
    },
  });

  if (!fitment) {
    return json({ fits: false, fitmentId: null });
  }

  // 1. Direct product match
  if (fitment.products && fitment.products.length > 0) {
    return json({ fits: true, fitmentId: fitment.id, matchedBy: "product" });
  }

  const assignedCollections = fitment.collections || [];
  const assignedTags = fitment.tags || [];

  // 2. Collection or Tag match via Shopify GraphQL
  if (assignedCollections.length > 0 || assignedTags.length > 0) {
    try {
      const { admin } = await unauthenticated.admin(shop);
      const prodRes = await admin.graphql(
        `query getProdInfo($handle: String!) {
          productByHandle(handle: $handle) {
            id
            tags
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
          return json({ fits: true, fitmentId: fitment.id, matchedBy: "collection" });
        }

        // Check Tag match
        const prodTags = new Set(
          (productInfo.tags ?? []).map((t) => t.toLowerCase().replace(/^#/, "")),
        );
        const tagMatch = assignedTags.some((t) =>
          t.tag && prodTags.has(t.tag.toLowerCase().replace(/^#/, "")),
        );
        if (tagMatch) {
          return json({ fits: true, fitmentId: fitment.id, matchedBy: "tag" });
        }
      }
    } catch (err) {
      console.error("[api/fitment-check] Error verifying Shopify collection/tag fitment:", err);
    }
  }

  return json({
    fits: false,
    fitmentId: fitment.id,
  });
}
