const json = (data, init) => Response.json(data, init);
import { authenticate, unauthenticated } from "../shopify.server";
import prisma from "../db.server";
import { getShopPlan, planLimits } from "../plans.server";

// POST /apps/partmatch/api/search  body: { year, make, model, sessionId? }
export async function action({ request }) {
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, { status: 405 });
  }

  const { session } = await authenticate.public.appProxy(request);

  if (!session) {
    return json({ error: "Unauthorized" }, { status: 401 });
  }

  const shop = session.shop;

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { year, make, model, sessionId } = body;

  if (!year || !make || !model) {
    return json(
      { error: "Missing required fields: year, make, model" },
      { status: 400 },
    );
  }

  try {
    const [appSettings, shopPlan] = await Promise.all([
      prisma.appSettings?.findUnique({ where: { shop } }),
      getShopPlan(shop),
    ]);
    const limits = planLimits(shopPlan.plan);
    const includeUniversal = (appSettings?.includeUniversal ?? true) && limits.universalProducts;
    const logNoResults = appSettings?.logNoResults ?? true;

    // Find the fitment record with products, collections, and tags
    const fitment = await prisma.fitmentRecord?.findUnique({
      where: { shop_year_make_model: { shop, year, make, model } },
      include: {
        products: {
          select: {
            shopifyProductId: true,
            shopifyHandle: true,
            productTitle: true,
          },
        },
        collections: {
          select: {
            shopifyCollectionId: true,
            shopifyHandle: true,
            collectionTitle: true,
          },
        },
        tags: {
          select: {
            tag: true,
          },
        },
      },
    });

    const fitmentProducts = fitment?.products ?? [];
    const fitmentCollections = fitment?.collections ?? [];
    const fitmentTags = fitment?.tags ?? [];

    const productMap = new Map();

    // 1. Direct Products
    fitmentProducts.forEach((p) => {
      const key = p.shopifyProductId || p.shopifyHandle;
      if (key) {
        productMap.set(key, {
          shopifyProductId: p.shopifyProductId,
          shopifyHandle: p.shopifyHandle,
          productTitle: p.productTitle,
          source: "product",
        });
      }
    });

    // 2. Fetch products for assigned Collections & Tags from Shopify
    if (fitmentCollections.length > 0 || fitmentTags.length > 0) {
      try {
        const { admin } = await unauthenticated.admin(shop);

        // Fetch collection products
        for (const col of fitmentCollections) {
          if (!col.shopifyHandle) continue;
          const colRes = await admin.graphql(
            `query getColProds($handle: String!) {
              collectionByHandle(handle: $handle) {
                products(first: 50) {
                  nodes {
                    id
                    handle
                    title
                  }
                }
              }
            }`,
            { variables: { handle: col.shopifyHandle } },
          );
          const colData = await colRes.json();
          const nodes = colData.data?.collectionByHandle?.products?.nodes ?? [];
          nodes.forEach((n) => {
            const key = n.id || n.handle;
            if (key && !productMap.has(key) && !productMap.has(n.handle)) {
              productMap.set(key, {
                shopifyProductId: n.id,
                shopifyHandle: n.handle,
                productTitle: n.title,
                source: "collection",
              });
            }
          });
        }

        // Fetch tag products
        for (const t of fitmentTags) {
          if (!t.tag) continue;
          const tagRes = await admin.graphql(
            `query getTagProds($query: String!) {
              products(first: 50, query: $query) {
                nodes {
                  id
                  handle
                  title
                }
              }
            }`,
            { variables: { query: `tag:"${t.tag}"` } },
          );
          const tagData = await tagRes.json();
          const nodes = tagData.data?.products?.nodes ?? [];
          nodes.forEach((n) => {
            const key = n.id || n.handle;
            if (key && !productMap.has(key) && !productMap.has(n.handle)) {
              productMap.set(key, {
                shopifyProductId: n.id,
                shopifyHandle: n.handle,
                productTitle: n.title,
                source: "tag",
              });
            }
          });
        }
      } catch (err) {
        console.error("[api/search] Error fetching Shopify collection/tag products:", err);
      }
    }

    // 3. Universal Products
    if (includeUniversal) {
      const universalProducts = await prisma.universalProduct?.findMany({
        where: { shop },
        select: {
          shopifyProductId: true,
          shopifyHandle: true,
          productTitle: true,
        },
      });
      universalProducts.forEach((u) => {
        const key = u.shopifyProductId || u.shopifyHandle;
        if (key && !productMap.has(key) && !productMap.has(u.shopifyHandle)) {
          productMap.set(key, {
            shopifyProductId: u.shopifyProductId,
            shopifyHandle: u.shopifyHandle,
            productTitle: u.productTitle,
            source: "universal",
          });
        }
      });
    }

    const allProducts = Array.from(productMap.values());
    const hasResults = allProducts.length > 0;

    if (hasResults || logNoResults) {
      await prisma.searchLog?.create({
        data: {
          shop,
          year,
          make,
          model,
          resultCount: allProducts.length,
          hasResults,
          sessionId: sessionId ?? null,
        },
      });
    }

    return json({
      fitmentId: fitment?.id ?? null,
      year,
      make,
      model,
      products: allProducts,
      collections: fitmentCollections,
      tags: fitmentTags,
      resultCount: allProducts.length,
      hasResults,
    });
  } catch (err) {
    console.error("[api/search]", err);
    return json({ error: "Internal server error" }, { status: 500 });
  }
}
