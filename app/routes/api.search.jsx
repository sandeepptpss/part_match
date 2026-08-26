const json = (data, init) => Response.json(data, init);
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

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
    const appSettings = await prisma.appSettings?.findUnique({ where: { shop } });
    const includeUniversal = appSettings?.includeUniversal ?? true;
    const logNoResults = appSettings?.logNoResults ?? true;

    // Find the fitment record
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
      },
    });

    const fitmentProducts = fitment?.products ?? [];

    let universalProducts = [];
    if (includeUniversal) {
      universalProducts = await prisma.universalProduct?.findMany({
        where: { shop },
        select: {
          shopifyProductId: true,
          shopifyHandle: true,
          productTitle: true,
        },
      });
    }

    const allProducts = [
      ...fitmentProducts,
      ...universalProducts.filter(
        (u) =>
          !fitmentProducts.some((p) => p.shopifyProductId === u.shopifyProductId),
      ),
    ];

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
      resultCount: allProducts.length,
      hasResults,
    });
  } catch (err) {
    console.error("[api/search]", err);
    return json({ error: "Internal server error" }, { status: 500 });
  }
}
