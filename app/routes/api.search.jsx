const json = (data, init) => Response.json(data, init);
import { authenticate, unauthenticated } from "../shopify.server";
import prisma from "../db.server";
import { getShopPlan, planLimits } from "../plans.server";

async function getShopFromRequest(request) {
  try {
    const { session } = await authenticate.public.appProxy(request);
    if (session?.shop) return session.shop;
  } catch (err) {
    // Ignore proxy auth error and fallback to query params/database
  }

  const url = new URL(request.url);
  const paramShop = url.searchParams.get("shop");
  if (paramShop) return paramShop;

  const firstRecord = await prisma.fitmentRecord.findFirst({ select: { shop: true } });
  if (firstRecord?.shop) return firstRecord.shop;

  const firstSettings = await prisma.appSettings.findFirst({ select: { shop: true } });
  if (firstSettings?.shop) return firstSettings.shop;

  return null;
}

async function handleSearch({ shop, year, make, model, trim = "", sessionId = null }) {
  if (!shop) {
    return { error: "Could not resolve shop for search request", status: 400 };
  }

  if (!year || !make || !model) {
    return { error: "Missing required fields: year, make, model", status: 400 };
  }

  try {
    const [appSettings, shopPlan] = await Promise.all([
      prisma.appSettings?.findUnique({ where: { shop } }),
      getShopPlan(shop),
    ]);
    const limits = planLimits(shopPlan?.plan || "FREE");
    const includeUniversal = (appSettings?.includeUniversal ?? true) && limits.universalProducts;
    const logNoResults = appSettings?.logNoResults ?? true;

    // Fetch fitments for shop and year
    const fitments = await prisma.fitmentRecord?.findMany({
      where: { shop, year },
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
        skus: {
          select: {
            sku: true,
          },
        },
      },
    });

    const targetMake = (make || "").trim().toLowerCase();
    const targetModel = (model || "").trim().toLowerCase();
    const targetTrim = (trim || "").trim().toLowerCase();

    const matchedFitments = (fitments || []).filter((f) => {
      const mMake = (f.make || "").trim().toLowerCase();
      const mModel = (f.model || "").trim().toLowerCase();
      const mTrim = (f.trim || "").trim().toLowerCase();
      const makeMatch = mMake === targetMake;
      const modelMatch = mModel === targetModel;
      const trimMatch = !targetTrim || mTrim === targetTrim;
      return makeMatch && modelMatch && trimMatch;
    });

    const fitmentProducts = matchedFitments.flatMap((f) => f.products ?? []);
    const fitmentCollections = matchedFitments.flatMap((f) => f.collections ?? []);
    const fitmentTags = matchedFitments.flatMap((f) => f.tags ?? []);
    const fitmentSkus = matchedFitments.flatMap((f) => f.skus ?? []);

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

    // 2. Fetch products for assigned Collections, Tags, and SKUs from Shopify Admin GraphQL
    if (fitmentCollections.length > 0 || fitmentTags.length > 0 || fitmentSkus.length > 0) {
      try {
        const { admin } = await unauthenticated.admin(shop);

        if (admin) {
          // Fetch collection products
          for (const col of fitmentCollections) {
            if (!col.shopifyHandle) continue;
            try {
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
            } catch (colErr) {
              console.error("[api/search] Collection GraphQL error:", colErr);
            }
          }

          // Fetch tag products
          for (const t of fitmentTags) {
            if (!t.tag) continue;
            try {
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
            } catch (tagErr) {
              console.error("[api/search] Tag GraphQL error:", tagErr);
            }
          }

          // Fetch SKU products
          for (const s of fitmentSkus) {
            if (!s.sku) continue;
            try {
              const skuRes = await admin.graphql(
                `query getSkuProds($query: String!) {
                  products(first: 50, query: $query) {
                    nodes {
                      id
                      handle
                      title
                    }
                  }
                }`,
                { variables: { query: `sku:"${s.sku}"` } },
              );
              const skuData = await skuRes.json();
              const nodes = skuData.data?.products?.nodes ?? [];
              nodes.forEach((n) => {
                const key = n.id || n.handle;
                if (key && !productMap.has(key) && !productMap.has(n.handle)) {
                  productMap.set(key, {
                    shopifyProductId: n.id,
                    shopifyHandle: n.handle,
                    productTitle: n.title,
                    source: "sku",
                  });
                }
              });
            } catch (skuErr) {
              console.error("[api/search] SKU GraphQL error:", skuErr);
            }
          }
        }
      } catch (err) {
        console.error("[api/search] Error initializing unauthenticated.admin:", err);
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
      (universalProducts || []).forEach((u) => {
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
          trim: trim || "",
          resultCount: allProducts.length,
          hasResults,
          sessionId: sessionId ?? null,
        },
      });
    }

    return {
      data: {
        fitmentId: (matchedFitments && matchedFitments[0])?.id ?? null,
        year,
        make,
        model,
        trim: trim || "",
        products: allProducts,
        collections: fitmentCollections,
        tags: fitmentTags,
        resultCount: allProducts.length,
        hasResults,
      },
      status: 200,
    };
  } catch (err) {
    console.error("[api/search]", err);
    return { error: "Internal server error", status: 500 };
  }
}

// GET /apps/partmatch/api/search?year=&make=&model=&trim=
export async function loader({ request }) {
  const shop = await getShopFromRequest(request);
  const url = new URL(request.url);
  const year = url.searchParams.get("year");
  const make = url.searchParams.get("make");
  const model = url.searchParams.get("model");
  const trim = url.searchParams.get("trim") || "";

  const result = await handleSearch({ shop, year, make, model, trim });
  if (result.error) {
    return json({ error: result.error, products: [], hasResults: false, resultCount: 0 }, { status: result.status });
  }
  return json(result.data);
}

// POST /apps/partmatch/api/search  body: { year, make, model, trim?, sessionId? }
export async function action({ request }) {
  const shop = await getShopFromRequest(request);

  let body = {};
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { year, make, model, trim = "", sessionId } = body;
  const result = await handleSearch({ shop, year, make, model, trim, sessionId });

  if (result.error) {
    return json({ error: result.error, products: [], hasResults: false, resultCount: 0 }, { status: result.status });
  }
  return json(result.data);
}
