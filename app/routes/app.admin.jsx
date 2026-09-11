const json = (data, init) => Response.json(data, init);
import { useState, useMemo, useEffect } from "react";
import { useLoaderData, useFetcher, useRevalidator, redirect } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { normalizeShopDomain } from "../utils/shopDomain";

export const loader = async ({ request }) => {
  const { session, admin } = await authenticate.admin(request);
  const currentShop = session.shop;

  const adminEmail = (process.env.ADMIN_EMAIL || "").toLowerCase().trim();
  const adminStore = (process.env.ADMIN_STORE_NAME || "").toLowerCase().trim();
  const sessionEmail = session.email ? session.email.toLowerCase().trim() : "";
  const shopDomain = (currentShop || "").toLowerCase().trim();

  // Admin access check: strict store domain match or verified admin session email
  const isAdmin =
    Boolean(adminStore && (shopDomain === adminStore || shopDomain === `${adminStore}.myshopify.com`)) ||
    Boolean(sessionEmail && adminEmail && sessionEmail === adminEmail);

  if (!isAdmin) {
    return redirect("/app");
  }

  let shopsList = [];
  let totalRecords = 0;
  let totalProducts = 0;
  let totalSearches = 0;
  let globalDiscount = 20;

  let isSupportOnline = true;
  let autoGrantFirst10 = false;
  let vipFreeOfferMonths = 2;
  let vipFreeOfferStoreLimit = 10;

  try {
    // Fetch Global Settings
    const globalSettings = await prisma.appSettings.findFirst({
      where: { shop: "__GLOBAL__" },
    });
    if (globalSettings?.annualDiscountPercent != null) {
      globalDiscount = globalSettings.annualDiscountPercent;
    }
    if (globalSettings?.isSupportOnline != null) {
      isSupportOnline = globalSettings.isSupportOnline;
    }
    if (globalSettings?.autoGrantFirst10 != null) {
      autoGrantFirst10 = globalSettings.autoGrantFirst10;
    }
    if (globalSettings?.vipFreeOfferMonths != null) {
      vipFreeOfferMonths = globalSettings.vipFreeOfferMonths;
    }
    if (globalSettings?.vipFreeOfferStoreLimit != null) {
      vipFreeOfferStoreLimit = globalSettings.vipFreeOfferStoreLimit;
    }

    // Get unique shops
    const settingsList = (await prisma.appSettings.findMany()) ?? [];
    const sessions = (await prisma.session.findMany({ select: { shop: true, email: true } })) ?? [];
    const shopPlansList = (await prisma.shopPlan.findMany()) ?? [];

    let currentShopName = "";
    try {
      if (admin?.graphql) {
        const shopRes = await admin.graphql(`{ shop { name } }`);
        const shopJson = await shopRes.json();
        currentShopName = shopJson?.data?.shop?.name || "";
      }
    } catch (err) {
      console.warn("[admin loader] Error fetching shop name:", err?.message);
    }

    // Get unique canonical shops
    const rawCandidateShops = [
      currentShop,
      ...settingsList.map((s) => s.shop),
      ...sessions.map((s) => s.shop),
      ...shopPlansList.map((s) => s.shop),
    ];

    const shopSet = new Set();
    for (const raw of rawCandidateShops) {
      const normalized = normalizeShopDomain(raw);
      if (normalized && normalized !== "__GLOBAL__") {
        shopSet.add(normalized);
      }
    }

    const shopDomains = Array.from(shopSet);

    // Detailed per-shop stats
    shopsList = await Promise.all(
      shopDomains.map(async (domain, index) => {
        const [fitments, mappings, universals, searches, settings] = await Promise.all([
          prisma.fitmentRecord.count({ where: { shop: domain } }) ?? 0,
          prisma.fitmentProduct.count({ where: { fitment: { shop: domain } } }) ?? 0,
          prisma.universalProduct.count({ where: { shop: domain } }) ?? 0,
          prisma.searchLog.count({ where: { shop: domain } }) ?? 0,
          prisma.appSettings.findFirst({ where: { shop: domain } }),
        ]);

        let storeName = "";
        if (domain === currentShop && currentShopName) {
          storeName = currentShopName;
        } else {
          const rawPrefix = domain.replace(/\.myshopify\.com$/i, "");
          storeName = rawPrefix
            .split(/[-_]+/)
            .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
            .join(" ");
        }

        const sessionMatch = sessions.find((s) => normalizeShopDomain(s.shop) === domain);
        const contactEmail = sessionMatch?.email || "";
        const merchantDiscount =
          settings?.merchantDiscountPercent != null
            ? settings.merchantDiscountPercent
            : settings?.annualDiscountPercent != null && settings.annualDiscountPercent !== globalDiscount
            ? settings.annualDiscountPercent
            : 0;
        const isCustomDiscount = merchantDiscount > 0;

        const isFirst10 = index < vipFreeOfferStoreLimit;
        const isVipExplicit = settings?.vipFreeOfferActive ?? false;
        const vipFreeOfferActive = isVipExplicit || (autoGrantFirst10 && isFirst10);
        const vipFreeOfferClaimed = settings?.vipFreeOfferClaimed ?? false;

        const planObj = shopPlansList.find((p) => normalizeShopDomain(p.shop) === domain);
        const basePrices = { free: 0, starter: 19, growth: 49, enterprise: 99 };
        const planTitles = {
          free: "Starter Free",
          starter: "Starter Pro",
          growth: "Growth Pro",
          enterprise: "Enterprise Unlimited",
        };
        const userPlanKey = planObj?.plan || "free";
        const customMonthlyPrice =
          planObj?.customMonthlyPrice != null && !isNaN(Number(planObj.customMonthlyPrice))
            ? Number(planObj.customMonthlyPrice)
            : null;
        const basePrice = customMonthlyPrice !== null ? customMonthlyPrice : (basePrices[userPlanKey] ?? 0);
        const effectivePrice = basePrice > 0 ? (basePrice * (1 - merchantDiscount / 100)).toFixed(2) : "0";
        const activePlanLabel = `${planTitles[userPlanKey] || "Starter Free"} ($${effectivePrice}/mo)`;

        return {
          shop: domain,
          name: storeName,
          email: contactEmail,
          fitments,
          mappings,
          universals,
          searches,
          merchantDiscountPercent: merchantDiscount,
          isCustomDiscount,
          activePlan: activePlanLabel,
          planKey: userPlanKey,
          customFitmentLimit: planObj?.customFitmentLimit ?? null,
          customMonthlyPrice: planObj?.customMonthlyPrice ?? null,
          isManualGrant: planObj?.isManualGrant ?? false,
          adminNotes: planObj?.adminNotes ?? "",
          status: "Active",
          storeIndex: index,
          isFirst10,
          isVipExplicit,
          vipFreeOfferActive,
          vipFreeOfferClaimed,
        };
      })
    );

    // Global aggregations
    totalRecords = (await prisma.fitmentRecord.count()) ?? 0;
    totalProducts = (await prisma.fitmentProduct.count()) ?? 0;
    totalSearches = (await prisma.searchLog.count()) ?? 0;
  } catch (err) {
    console.error("[admin loader error]", err);
  }

  let quoteRequests = [];
  try {
    quoteRequests = await prisma.quoteRequest.findMany({
      orderBy: { id: "desc" },
      take: 50,
    });
  } catch (err) {
    console.warn("[admin loader] Error fetching quoteRequests:", err);
  }

  return json({
    currentShop,
    sessionEmail,
    isAdmin,
    shopsList,
    quoteRequests,
    totalRecords,
    totalProducts,
    totalSearches,
    globalDiscount,
    isSupportOnline,
    autoGrantFirst10,
    vipFreeOfferMonths,
    vipFreeOfferStoreLimit,
  });
};

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const currentShop = session.shop;
  const adminEmail = (process.env.ADMIN_EMAIL || "").toLowerCase().trim();
  const adminStore = (process.env.ADMIN_STORE_NAME || "").toLowerCase().trim();
  const sessionEmail = session.email ? session.email.toLowerCase().trim() : "";
  const shopDomain = (currentShop || "").toLowerCase().trim();

  const isAdmin =
    Boolean(adminStore && (shopDomain === adminStore || shopDomain === `${adminStore}.myshopify.com`)) ||
    Boolean(sessionEmail && adminEmail && sessionEmail === adminEmail);

  if (!isAdmin) {
    return Response.json({ success: false, error: "Unauthorized" }, { status: 403 });
  }

  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "toggleSupportStatus") {
    const currentStatus = formData.get("currentSupportStatus") === "true";
    const nextStatus = !currentStatus;

    const globalRec = await prisma.appSettings.findFirst({ where: { shop: "__GLOBAL__" } });
    if (globalRec) {
      await prisma.appSettings.update({
        where: { id: globalRec.id },
        data: { isSupportOnline: nextStatus },
      });
    } else {
      await prisma.appSettings.create({
        data: { shop: "__GLOBAL__", isSupportOnline: nextStatus },
      });
    }

    return json({
      success: true,
      intent: "toggleSupportStatus",
      isSupportOnline: nextStatus,
      message: `Global Merchant Support Desk status set to: ${nextStatus ? "ONLINE" : "OFFLINE"}!`,
    });
  }

  if (intent === "saveGlobalDiscount") {
    const discount = parseInt(formData.get("globalDiscountPercent"), 10) || 20;

    const globalRec = await prisma.appSettings.findFirst({ where: { shop: "__GLOBAL__" } });
    if (globalRec) {
      await prisma.appSettings.update({
        where: { id: globalRec.id },
        data: { annualDiscountPercent: discount },
      });
    } else {
      await prisma.appSettings.create({
        data: { shop: "__GLOBAL__", annualDiscountPercent: discount },
      });
    }

    return json({
      success: true,
      intent: "saveGlobalDiscount",
      message: `Global Default Annual Discount updated to ${discount}% successfully!`,
    });
  }

  if (intent === "saveUserDiscount") {
    const rawTargetShop = formData.get("targetShop");
    const targetShop = normalizeShopDomain(rawTargetShop);
    const userDiscount = parseInt(formData.get("userDiscountPercent"), 10);

    if (!targetShop || isNaN(userDiscount) || userDiscount < 0 || userDiscount > 95) {
      return json({ success: false, message: "Invalid shop domain or discount rate (must be 0% - 95%)." }, { status: 400 });
    }

    const globalSettings = await prisma.appSettings.findFirst({ where: { shop: "__GLOBAL__" } });
    const globalDiscount = globalSettings?.annualDiscountPercent ?? 20;
    const annualDiscountToSave = userDiscount > 0 ? userDiscount : globalDiscount;

    try {
      const shopRec = await prisma.appSettings.findFirst({ where: { shop: targetShop } });
      if (shopRec) {
        await prisma.appSettings.update({
          where: { id: shopRec.id },
          data: {
            merchantDiscountPercent: userDiscount,
            annualDiscountPercent: annualDiscountToSave,
          },
        });
      } else {
        await prisma.appSettings.create({
          data: {
            shop: targetShop,
            merchantDiscountPercent: userDiscount,
            annualDiscountPercent: annualDiscountToSave,
          },
        });
      }
    } catch (err) {
      console.warn("[saveUserDiscount] Error saving merchant discount:", err?.message);
    }

    return json({
      success: true,
      intent: "saveUserDiscount",
      targetShop,
      message:
        userDiscount > 0
          ? `Merchant VIP discount of ${userDiscount}% applied successfully for: ${targetShop}!`
          : `Merchant discount for ${targetShop} set to 0% (Standard)!`,
    });
  }

  if (intent === "resetUserDiscount") {
    const rawTargetShop = formData.get("targetShop");
    const targetShop = normalizeShopDomain(rawTargetShop);

    if (!targetShop) {
      return json({ success: false, message: "Invalid shop domain." }, { status: 400 });
    }

    const globalSettings = await prisma.appSettings.findFirst({ where: { shop: "__GLOBAL__" } });
    const globalDiscount = globalSettings?.annualDiscountPercent ?? 20;

    try {
      const shopRec = await prisma.appSettings.findFirst({ where: { shop: targetShop } });
      if (shopRec) {
        await prisma.appSettings.update({
          where: { id: shopRec.id },
          data: {
            merchantDiscountPercent: 0,
            annualDiscountPercent: globalDiscount,
          },
        });
      } else {
        await prisma.appSettings.create({
          data: {
            shop: targetShop,
            merchantDiscountPercent: 0,
            annualDiscountPercent: globalDiscount,
          },
        });
      }
    } catch (err) {
      console.warn("[resetUserDiscount] Error resetting merchant discount:", err?.message);
    }

    return json({
      success: true,
      intent: "resetUserDiscount",
      targetShop,
      message: `Merchant discount for ${targetShop} reset to Global Default (${globalDiscount}%).`,
    });
  }

  if (intent === "saveVipFreeOfferConfig") {
    const rawMonths = formData.get("vipFreeOfferMonths");
    const rawStoreLimit = formData.get("vipFreeOfferStoreLimit");
    const months = parseInt(rawMonths, 10) > 0 ? parseInt(rawMonths, 10) : 2;
    const storeLimit = parseInt(rawStoreLimit, 10) > 0 ? parseInt(rawStoreLimit, 10) : 10;
    const autoGrant = formData.get("autoGrantFirst10") === "true";

    try {
      const globalRec = await prisma.appSettings.findFirst({ where: { shop: "__GLOBAL__" } });
      if (globalRec) {
        await prisma.appSettings.update({
          where: { id: globalRec.id },
          data: {
            vipFreeOfferMonths: months,
            vipFreeOfferStoreLimit: storeLimit,
            autoGrantFirst10: autoGrant,
          },
        });
      } else {
        await prisma.appSettings.create({
          data: {
            shop: "__GLOBAL__",
            vipFreeOfferMonths: months,
            vipFreeOfferStoreLimit: storeLimit,
            autoGrantFirst10: autoGrant,
          },
        });
      }

      const perShopUpdateData = {
        vipFreeOfferMonths: months,
        vipFreeOfferStoreLimit: storeLimit,
        autoGrantFirst10: autoGrant,
      };

      if (!autoGrant) {
        perShopUpdateData.vipFreeOfferActive = false;
        perShopUpdateData.vipFreeOfferClaimed = false;
      }

      await prisma.appSettings.updateMany({
        where: { shop: { not: "__GLOBAL__" } },
        data: perShopUpdateData,
      });
    } catch (err) {
      console.warn("[saveVipFreeOfferConfig] Error updating appSettings:", err?.message);
      return json({ success: false, message: "Error saving VIP offer config. Please try again." }, { status: 500 });
    }

    return json({
      success: true,
      intent: "saveVipFreeOfferConfig",
      autoGrantFirst10: autoGrant,
      vipFreeOfferMonths: months,
      vipFreeOfferStoreLimit: storeLimit,
      message: `VIP Free Offer settings saved! (${months} Months FREE for First ${storeLimit} Stores, Auto-Grant: ${
        autoGrant ? "ENABLED" : "DISABLED"
      })`,
    });
  }

  if (intent === "toggleAutoGrantFirst10") {
    const currentVal = formData.get("currentAutoGrantFirst10") === "true";
    const nextVal = !currentVal;
    const rawMonths = formData.get("vipFreeOfferMonths");
    const rawStoreLimit = formData.get("vipFreeOfferStoreLimit");

    const globalRec = await prisma.appSettings.findFirst({ where: { shop: "__GLOBAL__" } });
    const months = parseInt(rawMonths, 10) > 0 ? parseInt(rawMonths, 10) : globalRec?.vipFreeOfferMonths ?? 2;
    const storeLimit = parseInt(rawStoreLimit, 10) > 0 ? parseInt(rawStoreLimit, 10) : globalRec?.vipFreeOfferStoreLimit ?? 10;

    try {
      if (globalRec) {
        await prisma.appSettings.update({
          where: { id: globalRec.id },
          data: {
            autoGrantFirst10: nextVal,
            vipFreeOfferMonths: months,
            vipFreeOfferStoreLimit: storeLimit,
          },
        });
      } else {
        await prisma.appSettings.create({
          data: {
            shop: "__GLOBAL__",
            autoGrantFirst10: nextVal,
            vipFreeOfferMonths: months,
            vipFreeOfferStoreLimit: storeLimit,
          },
        });
      }

      const perShopUpdateData = {
        autoGrantFirst10: nextVal,
        vipFreeOfferMonths: months,
        vipFreeOfferStoreLimit: storeLimit,
      };

      if (!nextVal) {
        perShopUpdateData.vipFreeOfferActive = false;
        perShopUpdateData.vipFreeOfferClaimed = false;
      }

      await prisma.appSettings.updateMany({
        where: { shop: { not: "__GLOBAL__" } },
        data: perShopUpdateData,
      });
    } catch (err) {
      console.warn("[toggleAutoGrantFirst10] Error updating appSettings:", err?.message);
      return json({ success: false, message: "Error toggling Auto-Grant status. Please try again." }, { status: 500 });
    }

    return json({
      success: true,
      intent: "toggleAutoGrantFirst10",
      autoGrantFirst10: nextVal,
      vipFreeOfferMonths: months,
      vipFreeOfferStoreLimit: storeLimit,
      message: `Auto-grant FREE Growth Pro offer to First Stores is now ${
        nextVal ? "ENABLED" : "DISABLED"
      }! (${months} Months FREE, First ${storeLimit} Stores)`,
    });
  }

  if (intent === "toggleMerchantVipOffer") {
    const rawTargetShop = formData.get("targetShop");
    const targetShop = normalizeShopDomain(rawTargetShop);
    const currentOfferActive = formData.get("currentOfferActive") === "true";
    const nextOfferState = !currentOfferActive;

    if (!targetShop) {
      return json({ success: false, message: "Invalid target shop." }, { status: 400 });
    }

    const globalSet = await prisma.appSettings.findFirst({ where: { shop: "__GLOBAL__" } });
    const currentMonths = globalSet?.vipFreeOfferMonths ?? 2;
    const currentLimit = globalSet?.vipFreeOfferStoreLimit ?? 10;

    try {
      const shopRec = await prisma.appSettings.findFirst({ where: { shop: targetShop } });
      if (shopRec) {
        await prisma.appSettings.update({
          where: { id: shopRec.id },
          data: {
            vipFreeOfferActive: nextOfferState,
            vipFreeOfferMonths: currentMonths,
            vipFreeOfferStoreLimit: currentLimit,
            vipFreeOfferGrantedAt: nextOfferState ? new Date() : null,
          },
        });
      } else {
        await prisma.appSettings.create({
          data: {
            shop: targetShop,
            vipFreeOfferActive: nextOfferState,
            vipFreeOfferMonths: currentMonths,
            vipFreeOfferStoreLimit: currentLimit,
            vipFreeOfferGrantedAt: nextOfferState ? new Date() : null,
          },
        });
      }
    } catch (err) {
      console.warn("[toggleMerchantVipOffer] Error updating appSettings:", err?.message);
    }

    return json({
      success: true,
      intent: "toggleMerchantVipOffer",
      targetShop,
      vipFreeOfferActive: nextOfferState,
      message: nextOfferState
        ? `Growth Pro ${currentMonths}-Months FREE Offer granted to: ${targetShop}! Merchant notified in app.`
        : `Growth Pro ${currentMonths}-Months FREE Offer revoked for: ${targetShop}.`,
    });
  }

  if (intent === "saveVolumeDiscountConfig") {
    const isVolumeActive = formData.get("isVolumeDiscountActive") === "true";
    const volumePercent = parseInt(formData.get("volumeDiscountPercent"), 10) || 25;
    const volumeThreshold = parseInt(formData.get("volumeDiscountThreshold"), 10) || 10;

    try {
      const globalRec = await prisma.appSettings.findFirst({ where: { shop: "__GLOBAL__" } });
      if (globalRec) {
        await prisma.appSettings.update({
          where: { id: globalRec.id },
          data: {
            isVolumeDiscountActive: isVolumeActive,
            volumeDiscountPercent: volumePercent,
            volumeDiscountThreshold: volumeThreshold,
          },
        });
      } else {
        await prisma.appSettings.create({
          data: {
            shop: "__GLOBAL__",
            isVolumeDiscountActive: isVolumeActive,
            volumeDiscountPercent: volumePercent,
            volumeDiscountThreshold: volumeThreshold,
          },
        });
      }
    } catch (err) {
      console.warn("[saveVolumeDiscountConfig] Error updating appSettings:", err?.message);
    }

    return json({
      success: true,
      intent: "saveVolumeDiscountConfig",
      message: `Volume Discount config saved! (${volumePercent}% OFF for ${volumeThreshold}+ stores, Status: ${
        isVolumeActive ? "ACTIVE" : "INACTIVE"
      })`,
    });
  }

  if (intent === "clearLogs") {
    await prisma.searchLog.deleteMany({});
    return json({
      success: true,
      intent: "clearLogs",
      message: "Search logs cleared successfully across all merchant accounts!",
    });
  }

  if (intent === "updateMerchantPlanQuote") {
    const rawTargetShop = formData.get("targetShop")?.toString();
    const targetShop = normalizeShopDomain(rawTargetShop);
    const rawPlan = formData.get("plan")?.toString()?.toLowerCase()?.trim() || "starter";
    const allowedPlans = ["free", "starter", "growth", "enterprise"];
    const plan = allowedPlans.includes(rawPlan) ? rawPlan : "starter";

    const customLimitStr = formData.get("customFitmentLimit")?.toString();
    const parsedLimit = customLimitStr && customLimitStr.trim() !== "" ? parseInt(customLimitStr, 10) : null;
    const customFitmentLimit = parsedLimit != null && !isNaN(parsedLimit) && parsedLimit >= 0 ? parsedLimit : null;

    const customPriceStr = formData.get("customMonthlyPrice")?.toString();
    const parsedPrice = customPriceStr && customPriceStr.trim() !== "" ? parseFloat(customPriceStr) : null;
    const customMonthlyPrice = parsedPrice != null && !isNaN(parsedPrice) && parsedPrice >= 0 ? parsedPrice : null;

    const isManualGrant = formData.get("isManualGrant") === "true" || formData.get("isManualGrant") === "on";
    const adminNotes = formData.get("adminNotes")?.toString() || "";
    const quoteRequestId = parseInt(formData.get("quoteRequestId")?.toString() || "0", 10);

    if (!targetShop) {
      return json({ success: false, message: "Invalid target shop domain." }, { status: 400 });
    }

    try {
      await prisma.shopPlan.upsert({
        where: { shop: targetShop },
        update: {
          plan,
          customFitmentLimit,
          customMonthlyPrice,
          isManualGrant,
          adminNotes,
        },
        create: {
          shop: targetShop,
          plan,
          billingCycle: "monthly",
          customFitmentLimit,
          customMonthlyPrice,
          isManualGrant,
          adminNotes,
        },
      });

      if (quoteRequestId) {
        try {
          await prisma.quoteRequest.update({
            where: { id: quoteRequestId },
            data: {
              status: "APPROVED",
              quotedPrice: customMonthlyPrice,
            },
          });
        } catch (qrErr) {
          console.warn("[updateMerchantPlanQuote] QuoteRequest update error:", qrErr?.message);
        }
      }

      return json({
        success: true,
        intent: "updateMerchantPlanQuote",
        message: `Plan & Quote updated successfully for ${targetShop}! Active Plan: ${plan.toUpperCase()}, Quota: ${
          customFitmentLimit ? customFitmentLimit.toLocaleString() : "Default"
        } fitments.`,
      });
    } catch (err) {
      console.error("[updateMerchantPlanQuote] Error updating shop plan:", err);
      return json({ success: false, message: "Failed to update plan & quote." }, { status: 500 });
    }
  }

  if (intent === "updateQuoteRequestStatus") {
    const quoteRequestId = parseInt(formData.get("quoteRequestId")?.toString() || "0", 10);
    const rawStatus = formData.get("status")?.toString()?.toUpperCase() || "PENDING";
    const allowedStatuses = ["PENDING", "CONTACTED", "APPROVED", "REJECTED"];
    const status = allowedStatuses.includes(rawStatus) ? rawStatus : "PENDING";

    if (quoteRequestId) {
      try {
        await prisma.quoteRequest.update({
          where: { id: quoteRequestId },
          data: { status },
        });
        return json({
          success: true,
          intent: "updateQuoteRequestStatus",
          message: `Quote request #${quoteRequestId} status updated to ${status}.`,
        });
      } catch (err) {
        console.warn("[updateQuoteRequestStatus] Error:", err?.message);
        return json({ success: false, message: "Failed to update quote request status." }, { status: 500 });
      }
    }
    return json({ success: false, message: "Invalid quote request ID." }, { status: 400 });
  }

  return json({ success: false });
};

export default function AdminPage() {
  const {
    currentShop,
    sessionEmail,
    shopsList,
    quoteRequests = [],
    totalRecords,
    totalProducts,
    totalSearches,
    globalDiscount,
    isSupportOnline: initialIsSupportOnline,
    autoGrantFirst10: initialAutoGrantFirst10,
    vipFreeOfferMonths: initialVipFreeOfferMonths = 2,
    vipFreeOfferStoreLimit: initialVipFreeOfferStoreLimit = 10,
  } = useLoaderData();

  const supportFetcher = useFetcher();
  const discountFetcher = useFetcher();
  const logsFetcher = useFetcher();
  const userDiscountFetcher = useFetcher();
  const autoGrantFetcher = useFetcher();
  const vipOfferFetcher = useFetcher();
  const planQuoteFetcher = useFetcher();
  const revalidator = useRevalidator();
  const isSupportOnline = supportFetcher.data?.isSupportOnline ?? initialIsSupportOnline;
  const autoGrantFirst10 = autoGrantFetcher.data?.autoGrantFirst10 ?? initialAutoGrantFirst10;

  const isSupportSubmitting = supportFetcher.state !== "idle";
  const isDiscountSubmitting = discountFetcher.state !== "idle";
  const isLogsSubmitting = logsFetcher.state !== "idle";
  const isUserDiscountSubmitting = userDiscountFetcher.state !== "idle";
  const isAutoGrantSubmitting = autoGrantFetcher.state !== "idle";
  const isVipOfferSubmitting = vipOfferFetcher.state !== "idle";
  const isPlanQuoteSubmitting = planQuoteFetcher.state !== "idle";

  const activeNotification =
    planQuoteFetcher.data?.message
      ? planQuoteFetcher.data
      : supportFetcher.data?.message
      ? supportFetcher.data
      : discountFetcher.data?.message
      ? discountFetcher.data
      : logsFetcher.data?.message
      ? logsFetcher.data
      : userDiscountFetcher.data?.message
      ? userDiscountFetcher.data
      : autoGrantFetcher.data?.message
      ? autoGrantFetcher.data
      : vipOfferFetcher.data?.message
      ? vipOfferFetcher.data
      : null;

  const [activeTab, setActiveTab] = useState("merchants");
  const [globalDiscountInput, setGlobalDiscountInput] = useState(globalDiscount);
  const [vipMonthsInput, setVipMonthsInput] = useState(initialVipFreeOfferMonths);
  const [vipStoreLimitInput, setVipStoreLimitInput] = useState(initialVipFreeOfferStoreLimit);
  const [autoGrantToggle, setAutoGrantToggle] = useState(initialAutoGrantFirst10);
  const [searchQuery, setSearchQuery] = useState("");
  const [showPurgeConfirmModal, setShowPurgeConfirmModal] = useState(false);

  // Quote & Plan Override Modal State
  const [quoteModalShop, setQuoteModalShop] = useState(null);
  const [quoteModalShopName, setQuoteModalShopName] = useState("");
  const [quoteModalPlan, setQuoteModalPlan] = useState("starter");
  const [quoteModalLimit, setQuoteModalLimit] = useState("");
  const [quoteModalPrice, setQuoteModalPrice] = useState("");
  const [quoteModalManualGrant, setQuoteModalManualGrant] = useState(true);
  const [quoteModalNotes, setQuoteModalNotes] = useState("");
  const [quoteModalRequestId, setQuoteModalRequestId] = useState(null);

  const openPlanQuoteModal = (merchant, quoteReq = null) => {
    setQuoteModalShop(merchant.shop);
    setQuoteModalShopName(merchant.name || merchant.shop);
    setQuoteModalPlan(quoteReq?.requestedPlan || merchant.planKey || "starter");
    setQuoteModalLimit(quoteReq?.requestedFitments || merchant.customFitmentLimit || "");
    setQuoteModalPrice(quoteReq?.monthlyBudget || merchant.customMonthlyPrice || "");
    setQuoteModalManualGrant(merchant.isManualGrant ?? true);
    setQuoteModalNotes(quoteReq?.notes || merchant.adminNotes || "");
    setQuoteModalRequestId(quoteReq?.id || null);
  };
  const [userDiscountInputs, setUserDiscountInputs] = useState(() => {
    const initial = {};
    shopsList.forEach((s) => {
      initial[s.shop] = s.merchantDiscountPercent;
    });
    return initial;
  });

  useEffect(() => {
    const updatedInputs = {};
    shopsList.forEach((s) => {
      updatedInputs[s.shop] = s.merchantDiscountPercent;
    });
    setUserDiscountInputs(updatedInputs);
  }, [shopsList]);

  useEffect(() => {
    setVipMonthsInput(initialVipFreeOfferMonths);
    setVipStoreLimitInput(initialVipFreeOfferStoreLimit);
    setAutoGrantToggle(initialAutoGrantFirst10);
  }, [initialVipFreeOfferMonths, initialVipFreeOfferStoreLimit, initialAutoGrantFirst10]);

  useEffect(() => {
    if (
      (autoGrantFetcher.data?.intent === "saveVipFreeOfferConfig" ||
        autoGrantFetcher.data?.intent === "toggleAutoGrantFirst10") &&
      autoGrantFetcher.state === "idle"
    ) {
      if (autoGrantFetcher.data.vipFreeOfferMonths != null) {
        setVipMonthsInput(autoGrantFetcher.data.vipFreeOfferMonths);
      }
      if (autoGrantFetcher.data.vipFreeOfferStoreLimit != null) {
        setVipStoreLimitInput(autoGrantFetcher.data.vipFreeOfferStoreLimit);
      }
      if (autoGrantFetcher.data.autoGrantFirst10 != null) {
        setAutoGrantToggle(autoGrantFetcher.data.autoGrantFirst10);
      }
      revalidator.revalidate();
    }
  }, [autoGrantFetcher.data, autoGrantFetcher.state, revalidator]);

  useEffect(() => {
    if (vipOfferFetcher.data?.intent === "toggleMerchantVipOffer" && vipOfferFetcher.state === "idle") {
      revalidator.revalidate();
    }
  }, [vipOfferFetcher.data, vipOfferFetcher.state, revalidator]);

  useEffect(() => {
    if (
      (planQuoteFetcher.data?.intent === "updateMerchantPlanQuote" ||
        planQuoteFetcher.data?.intent === "updateQuoteRequestStatus") &&
      planQuoteFetcher.state === "idle"
    ) {
      if (planQuoteFetcher.data?.success !== false) {
        setQuoteModalShop(null);
      }
      revalidator.revalidate();
    }
  }, [planQuoteFetcher.data, planQuoteFetcher.state, revalidator]);

  const pendingQuotesCount = useMemo(() => {
    return (quoteRequests || []).filter((q) => q.status === "PENDING").length;
  }, [quoteRequests]);

  const handleUserDiscountChange = (shop, value) => {
    setUserDiscountInputs((prev) => ({
      ...prev,
      [shop]: value,
    }));
  };

  const filteredShops = useMemo(() => {
    if (!searchQuery.trim()) return shopsList;
    const query = searchQuery.toLowerCase();
    return shopsList.filter(
      (s) =>
        (s.name && s.name.toLowerCase().includes(query)) ||
        s.shop.toLowerCase().includes(query) ||
        (s.email && s.email.toLowerCase().includes(query))
    );
  }, [shopsList, searchQuery]);

  return (
    <div
      style={{
        width: "100%",
        maxWidth: "100%",
        boxSizing: "border-box",
        margin: "0 auto",
        padding: "28px 24px 60px",
        fontFamily:
          "-apple-system, BlinkMacSystemFont, 'San Francisco', 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
        color: "#0f172a",
      }}
    >
      {/* Toast Notification Alert */}
      {activeNotification?.message && (
        <div
          style={{
            background: activeNotification?.success !== false ? "#f0fdf4" : "#fef2f2",
            border: `1px solid ${
              activeNotification?.success !== false ? "#bbf7d0" : "#fecaca"
            }`,
            color: activeNotification?.success !== false ? "#166534" : "#991b1b",
            padding: "12px 16px",
            borderRadius: "10px",
            marginBottom: "20px",
            fontWeight: "600",
            fontSize: "13px",
            display: "flex",
            alignItems: "center",
            gap: "10px",
          }}
        >
          <span style={{ display: "inline-flex", alignItems: "center" }}>
            {activeNotification?.success !== false ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12"></polyline>
              </svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10"></circle>
                <line x1="12" y1="8" x2="12" y2="12"></line>
                <line x1="12" y1="16" x2="12.01" y2="16"></line>
              </svg>
            )}
          </span>
          <div>{activeNotification.message}</div>
        </div>
      )}

      {/* Top Banner */}
      <div
        style={{
          background: "linear-gradient(135deg, #064e3b 0%, #047857 60%, #0f766e 100%)",
          color: "#ffffff",
          borderRadius: "14px",
          padding: "24px 28px",
          marginBottom: "24px",
          boxShadow: "0 4px 20px -2px rgba(6, 78, 59, 0.2)",
          position: "relative",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            flexWrap: "wrap",
            gap: "16px",
          }}
        >
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px" }}>
              <span
                style={{
                  background: "rgba(255, 255, 255, 0.18)",
                  color: "#ffffff",
                  padding: "3px 9px",
                  borderRadius: "20px",
                  fontSize: "10px",
                  fontWeight: "700",
                  letterSpacing: "0.05em",
                  textTransform: "uppercase",
                  border: "1px solid rgba(255, 255, 255, 0.25)",
                }}
              >
                Super Admin Console
              </span>
              <span
                style={{
                  background: "#34d399",
                  color: "#064e3b",
                  padding: "2px 8px",
                  borderRadius: "10px",
                  fontSize: "10px",
                  fontWeight: "800",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "4px",
                }}
              >
                <span style={{ width: "5px", height: "5px", borderRadius: "50%", background: "#064e3b" }}></span>
                System Live
              </span>
            </div>
            <h1
              style={{
                margin: "0 0 4px",
                fontSize: "24px",
                fontWeight: "800",
                letterSpacing: "-0.02em",
                color: "#ffffff",
              }}
            >
              PartMatch Control Center
            </h1>
            <p style={{ margin: 0, color: "#a7f3d0", fontSize: "13px", fontWeight: "500" }}>
              Logged in as <strong>{sessionEmail}</strong> &bull; Active Domain: <strong>{currentShop}</strong>
            </p>
          </div>

          <div
            style={{
              background: "rgba(255, 255, 255, 0.12)",
              padding: "12px 20px",
              borderRadius: "12px",
              border: "1px solid rgba(255, 255, 255, 0.2)",
              backdropFilter: "blur(8px)",
              textAlign: "right",
            }}
          >
            <div style={{ fontSize: "10px", color: "#a7f3d0", fontWeight: "700", letterSpacing: "0.05em", textTransform: "uppercase", marginBottom: "2px" }}>
              Global Default Discount
            </div>
            <div style={{ fontSize: "22px", fontWeight: "800", color: "#ffffff", letterSpacing: "-0.02em" }}>
              {globalDiscount}% <span style={{ fontSize: "12px", fontWeight: "700", color: "#6ee7b7" }}>OFF</span>
            </div>
          </div>
        </div>
      </div>

      {/* System Metrics Grid */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          gap: "16px",
          marginBottom: "24px",
        }}
      >
        {/* Installed Stores Card */}
        <div
          style={{
            background: "#ffffff",
            border: "1px solid #e2e8f0",
            borderTop: "3px solid #059669",
            borderRadius: "12px",
            padding: "18px 20px",
            boxShadow: "0 1px 3px rgba(0, 0, 0, 0.04)",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
            <span style={{ fontSize: "11px", color: "#64748b", fontWeight: "700", letterSpacing: "0.05em", textTransform: "uppercase" }}>
              Installed Stores
            </span>
            <div style={{ width: "34px", height: "34px", background: "#ecfdf5", color: "#059669", borderRadius: "8px", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path>
                <polyline points="9 22 9 12 15 12 15 22"></polyline>
              </svg>
            </div>
          </div>
          <div style={{ fontSize: "28px", fontWeight: "800", color: "#0f172a", lineHeight: "1.2" }}>
            {shopsList.length}
          </div>
          <div style={{ fontSize: "12px", color: "#059669", fontWeight: "600", marginTop: "4px" }}>
            Active Merchant Accounts
          </div>
        </div>

        {/* Fitment Records Card */}
        <div
          style={{
            background: "#ffffff",
            border: "1px solid #e2e8f0",
            borderTop: "3px solid #2563eb",
            borderRadius: "12px",
            padding: "18px 20px",
            boxShadow: "0 1px 3px rgba(0, 0, 0, 0.04)",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
            <span style={{ fontSize: "11px", color: "#64748b", fontWeight: "700", letterSpacing: "0.05em", textTransform: "uppercase" }}>
              Fitment Records
            </span>
            <div style={{ width: "34px", height: "34px", background: "#eff6ff", color: "#2563eb", borderRadius: "8px", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <ellipse cx="12" cy="5" rx="9" ry="3"></ellipse>
                <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"></path>
                <path d="M21 19c0 1.66-4 3-9 3s-9-1.34-9-3"></path>
              </svg>
            </div>
          </div>
          <div style={{ fontSize: "28px", fontWeight: "800", color: "#0f172a", lineHeight: "1.2" }}>
            {totalRecords.toLocaleString()}
          </div>
          <div style={{ fontSize: "12px", color: "#2563eb", fontWeight: "600", marginTop: "4px" }}>
            Vehicle Mappings in DB
          </div>
        </div>

        {/* Linked Products Card */}
        <div
          style={{
            background: "#ffffff",
            border: "1px solid #e2e8f0",
            borderTop: "3px solid #7c3aed",
            borderRadius: "12px",
            padding: "18px 20px",
            boxShadow: "0 1px 3px rgba(0, 0, 0, 0.04)",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
            <span style={{ fontSize: "11px", color: "#64748b", fontWeight: "700", letterSpacing: "0.05em", textTransform: "uppercase" }}>
              Linked Products
            </span>
            <div style={{ width: "34px", height: "34px", background: "#f5f3ff", color: "#7c3aed", borderRadius: "8px", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path>
                <polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline>
                <line x1="12" y1="22.08" x2="12" y2="12"></line>
              </svg>
            </div>
          </div>
          <div style={{ fontSize: "28px", fontWeight: "800", color: "#0f172a", lineHeight: "1.2" }}>
            {totalProducts.toLocaleString()}
          </div>
          <div style={{ fontSize: "12px", color: "#7c3aed", fontWeight: "600", marginTop: "4px" }}>
            Mapped Catalog Items
          </div>
        </div>

        {/* Storefront Search Volume Card */}
        <div
          style={{
            background: "#ffffff",
            border: "1px solid #e2e8f0",
            borderTop: "3px solid #ea580c",
            borderRadius: "12px",
            padding: "18px 20px",
            boxShadow: "0 1px 3px rgba(0, 0, 0, 0.04)",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
            <span style={{ fontSize: "11px", color: "#64748b", fontWeight: "700", letterSpacing: "0.05em", textTransform: "uppercase" }}>
              Storefront Search Volume
            </span>
            <div style={{ width: "34px", height: "34px", background: "#fff7ed", color: "#ea580c", borderRadius: "8px", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8"></circle>
                <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
              </svg>
            </div>
          </div>
          <div style={{ fontSize: "28px", fontWeight: "800", color: "#0f172a", lineHeight: "1.2" }}>
            {totalSearches.toLocaleString()}
          </div>
          <div style={{ fontSize: "12px", color: "#ea580c", fontWeight: "600", marginTop: "4px" }}>
            Logged Customer Queries
          </div>
        </div>
      </div>

      {/* Navigation Tabs */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "8px",
          marginBottom: "24px",
          background: "#ffffff",
          padding: "6px",
          borderRadius: "12px",
          border: "1px solid #e2e8f0",
          boxShadow: "0 1px 3px rgba(0, 0, 0, 0.04)",
          overflowX: "auto",
        }}
      >
        <button
          type="button"
          onClick={() => setActiveTab("merchants")}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "8px",
            padding: "8px 16px",
            borderRadius: "8px",
            fontSize: "13px",
            fontWeight: "700",
            border: "none",
            cursor: "pointer",
            background: activeTab === "merchants" ? "#047857" : "transparent",
            color: activeTab === "merchants" ? "#ffffff" : "#64748b",
            transition: "all 0.15s ease",
          }}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
            <circle cx="9" cy="7" r="4"></circle>
            <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
            <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
          </svg>
          Merchant Accounts
          <span
            style={{
              background: activeTab === "merchants" ? "rgba(255,255,255,0.25)" : "#e2e8f0",
              color: activeTab === "merchants" ? "#ffffff" : "#475569",
              padding: "2px 6px",
              borderRadius: "10px",
              fontSize: "11px",
              fontWeight: "800",
            }}
          >
            {shopsList.length}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("quotes")}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "8px",
            padding: "8px 16px",
            borderRadius: "8px",
            fontSize: "13px",
            fontWeight: "700",
            border: "none",
            cursor: "pointer",
            background: activeTab === "quotes" ? "#047857" : "transparent",
            color: activeTab === "quotes" ? "#ffffff" : "#64748b",
            transition: "all 0.15s ease",
          }}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
            <polyline points="14 2 14 8 20 8"></polyline>
            <line x1="16" y1="13" x2="8" y2="13"></line>
            <line x1="16" y1="17" x2="8" y2="17"></line>
            <polyline points="10 9 9 9 8 9"></polyline>
          </svg>
          Quotes &amp; Custom Quotas
          <span
            style={{
              background:
                pendingQuotesCount > 0
                  ? activeTab === "quotes"
                    ? "#f59e0b"
                    : "#fef3c7"
                  : activeTab === "quotes"
                  ? "rgba(255,255,255,0.25)"
                  : "#e2e8f0",
              color:
                pendingQuotesCount > 0
                  ? activeTab === "quotes"
                    ? "#ffffff"
                    : "#b45309"
                  : activeTab === "quotes"
                  ? "#ffffff"
                  : "#475569",
              padding: "2px 7px",
              borderRadius: "10px",
              fontSize: "11px",
              fontWeight: "800",
            }}
          >
            {pendingQuotesCount > 0 ? `${pendingQuotesCount} Pending` : quoteRequests.length}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("global")}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "8px",
            padding: "8px 16px",
            borderRadius: "8px",
            fontSize: "13px",
            fontWeight: "700",
            border: "none",
            cursor: "pointer",
            background: activeTab === "global" ? "#047857" : "transparent",
            color: activeTab === "global" ? "#ffffff" : "#64748b",
            transition: "all 0.15s ease",
          }}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3"></circle>
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
          </svg>
          Global Settings & System Tools
          <span
            style={{
              background: activeTab === "global" ? "rgba(255,255,255,0.25)" : "#e2e8f0",
              color: activeTab === "global" ? "#ffffff" : "#475569",
              padding: "2px 6px",
              borderRadius: "10px",
              fontSize: "11px",
              fontWeight: "800",
            }}
          >
            4
          </span>
        </button>
      </div>

      {/* Global Controls & Maintenance Cards */}
      <div
        style={{
          display: activeTab === "global" ? "grid" : "none",
          gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
          gap: "18px",
          marginBottom: "24px",
        }}
      >
        {/* Merchant Support Desk Global Status Toggle Card */}
        <div
          style={{
            background: "#ffffff",
            border: "1px solid #e2e8f0",
            borderTop: `3px solid ${isSupportOnline ? "#059669" : "#d97706"}`,
            borderRadius: "14px",
            padding: "20px 22px",
            boxShadow: "0 1px 3px rgba(0, 0, 0, 0.04)",
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
          }}
        >
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "6px" }}>
              <div style={{ width: "30px", height: "30px", background: isSupportOnline ? "#ecfdf5" : "#fffbe6", color: isSupportOnline ? "#047857" : "#d97706", borderRadius: "8px", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
                </svg>
              </div>
              <h2 style={{ margin: 0, fontSize: "16px", fontWeight: "800", color: "#0f172a" }}>
                Merchant Support Desk Status
              </h2>
            </div>
            <p style={{ margin: "0 0 16px", color: "#64748b", fontSize: "12px", lineHeight: "1.4" }}>
              Master Admin control switch to set Merchant Support online availability across all stores.
            </p>
          </div>

          <supportFetcher.Form method="post">
            <input type="hidden" name="intent" value="toggleSupportStatus" />
            <input type="hidden" name="currentSupportStatus" value={isSupportOnline ? "true" : "false"} />
            
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: "#f8fafc", padding: "12px 14px", borderRadius: "10px", border: "1px solid #cbd5e1" }}>
              <div>
                <strong style={{ fontSize: "13px", color: isSupportOnline ? "#15803d" : "#b45309", display: "flex", alignItems: "center", gap: "6px" }}>
                  Status: <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: isSupportOnline ? "#16a34a" : "#d97706", display: "inline-block" }}></span>{isSupportOnline ? "ONLINE" : "OFFLINE"}
                </strong>
                <span style={{ fontSize: "11px", color: "#64748b" }}>
                  {isSupportOnline ? "Merchants see 'Online & Available'" : "Merchants see 'Offline - Leave Message'"}
                </span>
              </div>

              <button
                type="submit"
                disabled={isSupportSubmitting}
                style={{
                  height: "36px",
                  background: isSupportOnline ? "#d97706" : "#047857",
                  color: "#ffffff",
                  border: "none",
                  padding: "0 14px",
                  borderRadius: "8px",
                  fontSize: "12px",
                  fontWeight: "800",
                  cursor: isSupportSubmitting ? "not-allowed" : "pointer",
                  boxShadow: isSupportOnline ? "0 2px 6px rgba(217, 119, 6, 0.2)" : "0 2px 6px rgba(4, 120, 87, 0.2)",
                  transition: "all 0.15s ease-in-out",
                  whiteSpace: "nowrap",
                }}
              >
                {isSupportSubmitting ? "Updating..." : isSupportOnline ? "SET OFFLINE" : "SET ONLINE"}
              </button>
            </div>
          </supportFetcher.Form>
        </div>
        {/* Global Annual Discount Settings Card */}
        <div
          style={{
            background: "#ffffff",
            border: "1px solid #e2e8f0",
            borderRadius: "14px",
            padding: "20px 22px",
            boxShadow: "0 1px 3px rgba(0, 0, 0, 0.04)",
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
          }}
        >
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "6px" }}>
              <div style={{ width: "30px", height: "30px", background: "#ecfdf5", color: "#047857", borderRadius: "8px", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"></path>
                  <line x1="7" y1="7" x2="7.01" y2="7"></line>
                </svg>
              </div>
              <h2 style={{ margin: 0, fontSize: "16px", fontWeight: "800", color: "#0f172a" }}>
                Global Default Discount
              </h2>
            </div>
            <p style={{ margin: "0 0 16px", color: "#64748b", fontSize: "12px", lineHeight: "1.4" }}>
              Set the default annual billing discount rate applied to all merchant accounts without a custom discount.
            </p>
          </div>

          <discountFetcher.Form method="post">
            <input type="hidden" name="intent" value="saveGlobalDiscount" />
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <div style={{ display: "flex", borderRadius: "8px", border: "1px solid #cbd5e1", overflow: "hidden", height: "38px" }}>
                <input
                  id="globalDiscountPercent"
                  type="number"
                  name="globalDiscountPercent"
                  min="0"
                  max="95"
                  value={globalDiscountInput}
                  onChange={(e) => setGlobalDiscountInput(e.target.value)}
                  style={{
                    width: "70px",
                    border: "none",
                    padding: "0 10px",
                    fontSize: "14px",
                    fontWeight: "800",
                    color: "#0f172a",
                    outline: "none",
                    textAlign: "center",
                    boxSizing: "border-box",
                  }}
                />
                <div
                  style={{
                    background: "#f1f5f9",
                    padding: "0 12px",
                    display: "flex",
                    alignItems: "center",
                    fontSize: "12px",
                    fontWeight: "700",
                    color: "#475569",
                    borderLeft: "1px solid #cbd5e1",
                  }}
                >
                  % OFF
                </div>
              </div>

              <button
                type="submit"
                disabled={isDiscountSubmitting}
                style={{
                  height: "38px",
                  background: isDiscountSubmitting ? "#94a3b8" : "#047857",
                  color: "#ffffff",
                  border: "none",
                  padding: "0 18px",
                  borderRadius: "8px",
                  fontSize: "13px",
                  fontWeight: "700",
                  cursor: isDiscountSubmitting ? "not-allowed" : "pointer",
                  boxShadow: "0 2px 6px rgba(4, 120, 87, 0.15)",
                  transition: "all 0.15s ease-in-out",
                  whiteSpace: "nowrap",
                }}
              >
                {isDiscountSubmitting ? "Updating..." : "Save Discount"}
              </button>
            </div>
          </discountFetcher.Form>
        </div>

        {/* Growth Pro VIP Free Offer Console Card */}
        <div
          style={{
            background: "#ffffff",
            border: "1px solid #e2e8f0",
            borderTop: `3px solid ${autoGrantFirst10 ? "#d97706" : "#94a3b8"}`,
            borderRadius: "14px",
            padding: "20px 22px",
            boxShadow: "0 1px 3px rgba(0, 0, 0, 0.04)",
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
          }}
        >
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "6px" }}>
              <div style={{ width: "30px", height: "30px", background: "#fef3c7", color: "#d97706", borderRadius: "8px", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20 12v10H4V12"></path>
                  <path d="M22 7H2v5h20V7z"></path>
                  <path d="M12 22V7"></path>
                  <path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z"></path>
                  <path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z"></path>
                </svg>
              </div>
              <h2 style={{ margin: 0, fontSize: "16px", fontWeight: "800", color: "#0f172a" }}>
                Growth Pro VIP Free Offer
              </h2>
            </div>
            <p style={{ margin: "0 0 14px", color: "#64748b", fontSize: "12px", lineHeight: "1.4" }}>
              Specify free offer duration (months) and number of eligible initial stores.
            </p>
          </div>

          <autoGrantFetcher.Form method="post">
            <input type="hidden" name="intent" value="saveVipFreeOfferConfig" />
            <input type="hidden" name="autoGrantFirst10" value={autoGrantToggle ? "true" : "false"} />

            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                {/* Free Months Input */}
                <div style={{ display: "flex", flex: 1, borderRadius: "8px", border: "1px solid #cbd5e1", overflow: "hidden", height: "36px" }}>
                  <input
                    type="number"
                    name="vipFreeOfferMonths"
                    min="1"
                    max="24"
                    value={vipMonthsInput}
                    onChange={(e) => setVipMonthsInput(e.target.value)}
                    style={{
                      width: "45px",
                      border: "none",
                      padding: "0 6px",
                      fontSize: "13px",
                      fontWeight: "800",
                      color: "#0f172a",
                      outline: "none",
                      textAlign: "center",
                    }}
                  />
                  <div style={{ background: "#f1f5f9", padding: "0 6px", display: "flex", alignItems: "center", fontSize: "11px", fontWeight: "700", color: "#475569", borderLeft: "1px solid #cbd5e1", flex: 1 }}>
                    Months Free
                  </div>
                </div>

                {/* Eligible Stores Input */}
                <div style={{ display: "flex", flex: 1, borderRadius: "8px", border: "1px solid #cbd5e1", overflow: "hidden", height: "36px" }}>
                  <div style={{ background: "#f1f5f9", padding: "0 6px", display: "flex", alignItems: "center", fontSize: "11px", fontWeight: "700", color: "#475569" }}>
                    First
                  </div>
                  <input
                    type="number"
                    name="vipFreeOfferStoreLimit"
                    min="1"
                    max="1000"
                    value={vipStoreLimitInput}
                    onChange={(e) => setVipStoreLimitInput(e.target.value)}
                    style={{
                      width: "45px",
                      border: "none",
                      padding: "0 4px",
                      fontSize: "13px",
                      fontWeight: "800",
                      color: "#0f172a",
                      outline: "none",
                      textAlign: "center",
                    }}
                  />
                  <div style={{ background: "#f1f5f9", padding: "0 6px", display: "flex", alignItems: "center", fontSize: "11px", fontWeight: "700", color: "#475569", borderLeft: "1px solid #cbd5e1", flex: 1 }}>
                    Stores
                  </div>
                </div>
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <button
                  type="button"
                  onClick={() => {
                    const nextVal = !autoGrantToggle;
                    setAutoGrantToggle(nextVal);
                    autoGrantFetcher.submit(
                      {
                        intent: "toggleAutoGrantFirst10",
                        currentAutoGrantFirst10: autoGrantToggle ? "true" : "false",
                      },
                      { method: "post" }
                    );
                  }}
                  disabled={isAutoGrantSubmitting}
                  style={{
                    height: "34px",
                    background: autoGrantToggle ? "#fffbe6" : "#f1f5f9",
                    color: autoGrantToggle ? "#b45309" : "#475569",
                    border: `1px solid ${autoGrantToggle ? "#fde68a" : "#cbd5e1"}`,
                    borderRadius: "8px",
                    padding: "0 10px",
                    fontSize: "11px",
                    fontWeight: "800",
                    cursor: isAutoGrantSubmitting ? "not-allowed" : "pointer",
                    flex: 1,
                    whiteSpace: "nowrap",
                    transition: "all 0.15s ease",
                  }}
                >
                  {isAutoGrantSubmitting
                    ? "Updating..."
                    : autoGrantToggle
                    ? "AUTO: ENABLED"
                    : "AUTO: DISABLED"}
                </button>

                <button
                  type="submit"
                  disabled={isAutoGrantSubmitting}
                  style={{
                    height: "34px",
                    background: isAutoGrantSubmitting ? "#94a3b8" : "#d97706",
                    color: "#ffffff",
                    border: "none",
                    padding: "0 14px",
                    borderRadius: "8px",
                    fontSize: "12px",
                    fontWeight: "800",
                    cursor: isAutoGrantSubmitting ? "not-allowed" : "pointer",
                    boxShadow: "0 2px 6px rgba(217, 119, 6, 0.2)",
                    transition: "all 0.15s ease-in-out",
                    whiteSpace: "nowrap",
                  }}
                >
                  {isAutoGrantSubmitting ? "Saving..." : "Save Config"}
                </button>
              </div>
            </div>
          </autoGrantFetcher.Form>
        </div>

        {/* System Diagnostics & Operations Card */}
        <div
          style={{
            background: "#ffffff",
            border: "1px solid #e2e8f0",
            borderRadius: "14px",
            padding: "20px 22px",
            boxShadow: "0 1px 3px rgba(0, 0, 0, 0.04)",
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
          }}
        >
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "6px" }}>
              <div style={{ width: "30px", height: "30px", background: "#f1f5f9", color: "#475569", borderRadius: "8px", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="3"></circle>
                  <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
                </svg>
              </div>
              <h2 style={{ margin: 0, fontSize: "16px", fontWeight: "800", color: "#0f172a" }}>
                System Maintenance & Tools
              </h2>
            </div>
            <p style={{ margin: "0 0 16px", color: "#64748b", fontSize: "12px", lineHeight: "1.4" }}>
              Perform global database cleanup and optimize search indexing logs.
            </p>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <div
              style={{
                flex: 1,
                height: "38px",
                background: "#f8fafc",
                border: "1px solid #e2e8f0",
                padding: "0 12px",
                borderRadius: "8px",
                fontSize: "12px",
                color: "#475569",
                fontWeight: "600",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                boxSizing: "border-box",
              }}
            >
              <span>Logged Queries:</span>
              <strong style={{ color: "#0f172a", fontWeight: "800" }}>{totalSearches.toLocaleString()}</strong>
            </div>

            <button
              type="button"
              disabled={isLogsSubmitting || totalSearches === 0}
              onClick={() => setShowPurgeConfirmModal(true)}
              style={{
                height: "38px",
                background: isLogsSubmitting || totalSearches === 0 ? "#cbd5e1" : "#ef4444",
                color: "#ffffff",
                border: "none",
                padding: "0 18px",
                borderRadius: "8px",
                fontSize: "13px",
                fontWeight: "700",
                cursor: isLogsSubmitting || totalSearches === 0 ? "not-allowed" : "pointer",
                boxShadow: totalSearches > 0 ? "0 2px 6px rgba(239, 68, 68, 0.15)" : "none",
                transition: "all 0.15s ease-in-out",
                whiteSpace: "nowrap",
              }}
            >
              {isLogsSubmitting ? "Clearing..." : "Purge Search Logs"}
            </button>
          </div>
        </div>
      </div>

      {/* Executive User-Friendly Purge Search Logs Modal Popup */}
      {showPurgeConfirmModal && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: "rgba(15, 23, 42, 0.65)",
            backdropFilter: "blur(4px)",
            zIndex: 99999,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "20px",
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowPurgeConfirmModal(false);
          }}
        >
          <div
            style={{
              background: "#ffffff",
              borderRadius: "16px",
              maxWidth: "480px",
              width: "100%",
              padding: "28px",
              boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.25)",
              border: "1px solid #e2e8f0",
              position: "relative",
            }}
          >
            {/* Modal Header Icon */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "18px" }}>
              <div
                style={{
                  width: "48px",
                  height: "48px",
                  borderRadius: "12px",
                  background: "#fef2f2",
                  border: "1px solid #fecaca",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "#dc2626",
                }}
              >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
                  <line x1="12" y1="9" x2="12" y2="13"></line>
                  <line x1="12" y1="17" x2="12.01" y2="17"></line>
                </svg>
              </div>
              <button
                type="button"
                onClick={() => setShowPurgeConfirmModal(false)}
                style={{
                  background: "transparent",
                  border: "none",
                  color: "#64748b",
                  fontSize: "18px",
                  fontWeight: "bold",
                  cursor: "pointer",
                  padding: "4px 8px",
                  borderRadius: "6px",
                }}
              >
                ✕
              </button>
            </div>

            {/* Modal Title & Text */}
            <h3 style={{ margin: "0 0 8px", fontSize: "20px", fontWeight: "800", color: "#0f172a", letterSpacing: "-0.5px" }}>
              Purge All Customer Search Logs?
            </h3>
            <p style={{ margin: "0 0 18px", fontSize: "14px", color: "#475569", lineHeight: "1.5" }}>
              You are about to permanently delete <strong>{totalSearches.toLocaleString()} customer search query logs</strong> across all merchant accounts.
            </p>

            {/* Warning Callout Box */}
            <div
              style={{
                background: "#fff5f5",
                border: "1px solid #fed7d7",
                borderRadius: "12px",
                padding: "14px 16px",
                marginBottom: "24px",
                fontSize: "13px",
                color: "#9b2c2c",
                lineHeight: "1.5",
              }}
            >
              <strong style={{ display: "block", marginBottom: "4px", color: "#c53030", fontWeight: "700" }}>
                Critical Warning: Permanent Data Loss
              </strong>
              This action cannot be undone. All storefront customer search queries and analytics data will be permanently cleared from the database.
            </div>

            {/* Action Buttons */}
            <div style={{ display: "flex", gap: "12px", justifyContent: "flex-end" }}>
              <button
                type="button"
                onClick={() => setShowPurgeConfirmModal(false)}
                disabled={isLogsSubmitting}
                style={{
                  background: "#ffffff",
                  color: "#475569",
                  border: "1px solid #cbd5e1",
                  padding: "10px 18px",
                  borderRadius: "10px",
                  fontSize: "14px",
                  fontWeight: "700",
                  cursor: "pointer",
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isLogsSubmitting}
                onClick={() => {
                  logsFetcher.submit({ intent: "clearLogs" }, { method: "post" });
                  setShowPurgeConfirmModal(false);
                }}
                style={{
                  background: "#dc2626",
                  color: "#ffffff",
                  border: "none",
                  padding: "10px 22px",
                  borderRadius: "10px",
                  fontSize: "14px",
                  fontWeight: "700",
                  cursor: isLogsSubmitting ? "not-allowed" : "pointer",
                  opacity: isLogsSubmitting ? 0.7 : 1,
                  boxShadow: "0 4px 12px rgba(220, 38, 38, 0.3)",
                }}
              >
                {isLogsSubmitting ? "Deleting Logs…" : "Yes, Purge Search Logs"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Adjust Plan & Custom Fitment Limit Modal */}
      {quoteModalShop && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: "rgba(15, 23, 42, 0.65)",
            backdropFilter: "blur(4px)",
            zIndex: 9999,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "20px",
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) setQuoteModalShop(null);
          }}
        >
          <div
            style={{
              background: "#ffffff",
              borderRadius: "16px",
              maxWidth: "520px",
              width: "100%",
              padding: "26px",
              boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.25)",
              border: "1px solid #e2e8f0",
              position: "relative",
              maxHeight: "90vh",
              overflowY: "auto",
            }}
          >
            {/* Modal Header */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "16px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <div
                  style={{
                    width: "40px",
                    height: "40px",
                    borderRadius: "10px",
                    background: "#ecfdf5",
                    border: "1px solid #a7f3d0",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "#047857",
                  }}
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="4" y1="21" x2="4" y2="14"></line>
                    <line x1="4" y1="10" x2="4" y2="3"></line>
                    <line x1="12" y1="21" x2="12" y2="12"></line>
                    <line x1="12" y1="8" x2="12" y2="3"></line>
                    <line x1="20" y1="21" x2="20" y2="16"></line>
                    <line x1="20" y1="12" x2="20" y2="3"></line>
                    <line x1="1" y1="14" x2="7" y2="14"></line>
                    <line x1="9" y1="8" x2="15" y2="8"></line>
                    <line x1="17" y1="16" x2="23" y2="16"></line>
                  </svg>
                </div>
                <div>
                  <h3 style={{ margin: "0 0 2px", fontSize: "18px", fontWeight: "800", color: "#0f172a" }}>
                    Adjust Plan &amp; Limit Quota
                  </h3>
                  <p style={{ margin: 0, fontSize: "12px", color: "#64748b" }}>
                    Store: <strong style={{ color: "#0f172a" }}>{quoteModalShopName || quoteModalShop}</strong> ({quoteModalShop})
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setQuoteModalShop(null)}
                style={{
                  background: "transparent",
                  border: "none",
                  color: "#64748b",
                  fontSize: "18px",
                  fontWeight: "bold",
                  cursor: "pointer",
                  padding: "4px 8px",
                  borderRadius: "6px",
                }}
              >
                ✕
              </button>
            </div>

            <planQuoteFetcher.Form method="post">
              <input type="hidden" name="intent" value="updateMerchantPlanQuote" />
              <input type="hidden" name="targetShop" value={quoteModalShop} />
              {quoteModalRequestId && <input type="hidden" name="quoteRequestId" value={quoteModalRequestId} />}

              {/* Target Plan Selection */}
              <div style={{ marginBottom: "16px" }}>
                <label style={{ display: "block", fontSize: "12px", fontWeight: "700", color: "#334155", marginBottom: "6px" }}>
                  Assigned App Plan
                </label>
                <select
                  name="plan"
                  value={quoteModalPlan}
                  onChange={(e) => setQuoteModalPlan(e.target.value)}
                  style={{
                    width: "100%",
                    height: "38px",
                    padding: "0 12px",
                    borderRadius: "8px",
                    border: "1px solid #cbd5e1",
                    fontSize: "13px",
                    fontWeight: "600",
                    color: "#0f172a",
                    background: "#ffffff",
                    outline: "none",
                  }}
                >
                  <option value="free">Starter Free ($0/mo - 100 fitments)</option>
                  <option value="starter">Starter Pro ($19/mo - 5,000 fitments)</option>
                  <option value="growth">Growth Pro ($49/mo - 20,000 fitments)</option>
                  <option value="enterprise">Enterprise Unlimited ($99/mo - Unlimited fitments)</option>
                </select>
              </div>

              {/* Custom Fitment Limit Quota */}
              <div style={{ marginBottom: "16px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
                  <label style={{ fontSize: "12px", fontWeight: "700", color: "#334155" }}>
                    Custom Fitment Limit Override (Records)
                  </label>
                  <span style={{ fontSize: "11px", color: "#64748b" }}>
                    Leave blank to use default plan limit
                  </span>
                </div>
                <input
                  type="number"
                  name="customFitmentLimit"
                  placeholder="e.g. 50000 or 100000"
                  value={quoteModalLimit}
                  onChange={(e) => setQuoteModalLimit(e.target.value)}
                  style={{
                    width: "100%",
                    height: "38px",
                    padding: "0 12px",
                    borderRadius: "8px",
                    border: "1px solid #cbd5e1",
                    fontSize: "13px",
                    fontWeight: "700",
                    color: "#0f172a",
                    outline: "none",
                    boxSizing: "border-box",
                  }}
                />

                {/* Quick Volume Preset Pills */}
                <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginTop: "8px" }}>
                  {[10000, 25000, 50000, 100000, 250000, 500000, 1000000].map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => setQuoteModalLimit(preset.toString())}
                      style={{
                        padding: "3px 8px",
                        borderRadius: "6px",
                        fontSize: "11px",
                        fontWeight: "700",
                        border: quoteModalLimit === preset.toString() ? "1px solid #047857" : "1px solid #cbd5e1",
                        background: quoteModalLimit === preset.toString() ? "#ecfdf5" : "#f8fafc",
                        color: quoteModalLimit === preset.toString() ? "#047857" : "#475569",
                        cursor: "pointer",
                      }}
                    >
                      {preset >= 1000000 ? `${preset / 1000000}M` : `${preset / 1000}k`}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => setQuoteModalLimit("")}
                    style={{
                      padding: "3px 8px",
                      borderRadius: "6px",
                      fontSize: "11px",
                      fontWeight: "600",
                      border: "1px dashed #cbd5e1",
                      background: "transparent",
                      color: "#64748b",
                      cursor: "pointer",
                    }}
                  >
                    Clear Override
                  </button>
                </div>
              </div>

              {/* Custom Monthly Price */}
              <div style={{ marginBottom: "16px" }}>
                <label style={{ display: "block", fontSize: "12px", fontWeight: "700", color: "#334155", marginBottom: "6px" }}>
                  Agreed Custom Monthly Price ($ USD / month)
                </label>
                <div style={{ position: "relative" }}>
                  <span style={{ position: "absolute", left: "12px", top: "50%", transform: "translateY(-50%)", color: "#64748b", fontWeight: "700", fontSize: "13px" }}>$</span>
                  <input
                    type="number"
                    step="0.01"
                    name="customMonthlyPrice"
                    placeholder="e.g. 149.00 or leave blank"
                    value={quoteModalPrice}
                    onChange={(e) => setQuoteModalPrice(e.target.value)}
                    style={{
                      width: "100%",
                      height: "38px",
                      paddingLeft: "26px",
                      paddingRight: "12px",
                      borderRadius: "8px",
                      border: "1px solid #cbd5e1",
                      fontSize: "13px",
                      fontWeight: "700",
                      color: "#0f172a",
                      outline: "none",
                      boxSizing: "border-box",
                    }}
                  />
                </div>
              </div>

              {/* Manual Admin Grant Protection */}
              <div
                style={{
                  background: "#f8fafc",
                  border: "1px solid #e2e8f0",
                  borderRadius: "10px",
                  padding: "12px 14px",
                  marginBottom: "16px",
                }}
              >
                <label style={{ display: "flex", alignItems: "flex-start", gap: "10px", cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    name="isManualGrant"
                    value="true"
                    checked={quoteModalManualGrant}
                    onChange={(e) => setQuoteModalManualGrant(e.target.checked)}
                    style={{ marginTop: "3px", width: "16px", height: "16px", cursor: "pointer", accentColor: "#047857" }}
                  />
                  <div>
                    <strong style={{ fontSize: "12px", color: "#0f172a", display: "block" }}>
                      Protect with Manual Admin Grant
                    </strong>
                    <span style={{ fontSize: "11px", color: "#64748b", lineHeight: "1.4", display: "block", marginTop: "2px" }}>
                      Prevents this store from being downgraded to Free if they are invoiced separately, pay via external contract, or received a complimentary upgrade.
                    </span>
                  </div>
                </label>
              </div>

              {/* Admin Notes */}
              <div style={{ marginBottom: "20px" }}>
                <label style={{ display: "block", fontSize: "12px", fontWeight: "700", color: "#334155", marginBottom: "6px" }}>
                  Admin Notes / Deal Reference
                </label>
                <textarea
                  name="adminNotes"
                  rows={2}
                  placeholder="e.g. Approved 50,000 fitments for Q3 enterprise contract."
                  value={quoteModalNotes}
                  onChange={(e) => setQuoteModalNotes(e.target.value)}
                  style={{
                    width: "100%",
                    padding: "8px 12px",
                    borderRadius: "8px",
                    border: "1px solid #cbd5e1",
                    fontSize: "12px",
                    color: "#0f172a",
                    outline: "none",
                    boxSizing: "border-box",
                    resize: "vertical",
                  }}
                />
              </div>

              {/* Modal Buttons */}
              <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px" }}>
                <button
                  type="button"
                  onClick={() => setQuoteModalShop(null)}
                  style={{
                    padding: "9px 16px",
                    background: "#f1f5f9",
                    color: "#475569",
                    border: "1px solid #cbd5e1",
                    borderRadius: "8px",
                    fontSize: "13px",
                    fontWeight: "600",
                    cursor: "pointer",
                  }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isPlanQuoteSubmitting}
                  style={{
                    padding: "9px 18px",
                    background: "#047857",
                    color: "#ffffff",
                    border: "none",
                    borderRadius: "8px",
                    fontSize: "13px",
                    fontWeight: "700",
                    cursor: isPlanQuoteSubmitting ? "not-allowed" : "pointer",
                    boxShadow: "0 2px 6px rgba(4, 120, 87, 0.25)",
                  }}
                >
                  {isPlanQuoteSubmitting ? "Saving Changes..." : "Save Plan & Limit"}
                </button>
              </div>
            </planQuoteFetcher.Form>
          </div>
        </div>
      )}

      {/* Quotes & Custom Quota Requests Table Card */}
      <div
        style={{
          display: activeTab === "quotes" ? "block" : "none",
          background: "#ffffff",
          border: "1px solid #e2e8f0",
          borderRadius: "14px",
          padding: "20px 22px",
          boxShadow: "0 1px 3px rgba(0, 0, 0, 0.04)",
          marginBottom: "24px",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            flexWrap: "wrap",
            gap: "16px",
            marginBottom: "18px",
          }}
        >
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <h2 style={{ margin: "0 0 2px", fontSize: "18px", fontWeight: "800", color: "#0f172a" }}>
                Merchant Quote &amp; Custom Quota Requests ({quoteRequests.length})
              </h2>
              {pendingQuotesCount > 0 && (
                <span
                  style={{
                    background: "#fef3c7",
                    color: "#b45309",
                    border: "1px solid #fde68a",
                    padding: "2px 8px",
                    borderRadius: "12px",
                    fontSize: "11px",
                    fontWeight: "700",
                  }}
                >
                  {pendingQuotesCount} Action Required
                </span>
              )}
            </div>
            <p style={{ margin: 0, color: "#64748b", fontSize: "12px" }}>
              Review custom volume and Enterprise quote requests from merchants. Approve quotes and assign custom fitment limits and pricing directly.
            </p>
          </div>
        </div>

        {quoteRequests.length === 0 ? (
          <div
            style={{
              padding: "48px 24px",
              textAlign: "center",
              background: "#f8fafc",
              borderRadius: "12px",
              border: "1px dashed #cbd5e1",
            }}
          >
            <div
              style={{
                width: "48px",
                height: "48px",
                borderRadius: "12px",
                background: "#ecfdf5",
                color: "#047857",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                marginBottom: "12px",
              }}
            >
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                <polyline points="14 2 14 8 20 8"></polyline>
              </svg>
            </div>
            <h3 style={{ margin: "0 0 6px", fontSize: "15px", fontWeight: "700", color: "#0f172a" }}>
              No Quote Requests Yet
            </h3>
            <p style={{ margin: 0, color: "#64748b", fontSize: "13px", maxWidth: "440px", display: "inline-block" }}>
              When merchants request custom fitment quotas or Enterprise packages from their Pricing page, requests will appear here for instant review and approval.
            </p>
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left", fontSize: "13px" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid #e2e8f0", background: "#f8fafc" }}>
                  <th style={{ padding: "10px 14px", color: "#64748b", fontWeight: "700", fontSize: "11px", letterSpacing: "0.04em", textTransform: "uppercase" }}>
                    Merchant &amp; Store
                  </th>
                  <th style={{ padding: "10px 14px", color: "#64748b", fontWeight: "700", fontSize: "11px", letterSpacing: "0.04em", textTransform: "uppercase" }}>
                    Requested Plan &amp; Volume
                  </th>
                  <th style={{ padding: "10px 14px", color: "#64748b", fontWeight: "700", fontSize: "11px", letterSpacing: "0.04em", textTransform: "uppercase" }}>
                    Budget &amp; Data Requirements
                  </th>
                  <th style={{ padding: "10px 14px", color: "#64748b", fontWeight: "700", fontSize: "11px", letterSpacing: "0.04em", textTransform: "uppercase" }}>
                    Notes
                  </th>
                  <th style={{ padding: "10px 14px", textAlign: "center", color: "#64748b", fontWeight: "700", fontSize: "11px", letterSpacing: "0.04em", textTransform: "uppercase" }}>
                    Status
                  </th>
                  <th style={{ padding: "10px 14px", textAlign: "right", color: "#64748b", fontWeight: "700", fontSize: "11px", letterSpacing: "0.04em", textTransform: "uppercase" }}>
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {quoteRequests.map((quote) => {
                  const matchingMerchant = shopsList.find((s) => s.shop === normalizeShopDomain(quote.shop)) || {
                    shop: quote.shop,
                    name: quote.shop,
                    email: quote.contactEmail,
                    planKey: quote.requestedPlan,
                  };

                  const isPending = quote.status === "PENDING";
                  const isApproved = quote.status === "APPROVED";
                  const isContacted = quote.status === "CONTACTED";

                  return (
                    <tr key={quote.id} style={{ borderBottom: "1px solid #f1f5f9" }}>
                      {/* Store & Contact */}
                      <td style={{ padding: "12px 14px", verticalAlign: "top" }}>
                        <div style={{ fontWeight: "700", color: "#0f172a", fontSize: "13px" }}>
                          {matchingMerchant.name || quote.shop}
                        </div>
                        <div style={{ color: "#64748b", fontSize: "11px", marginTop: "2px" }}>
                          {quote.shop}
                        </div>
                        <div style={{ color: "#2563eb", fontSize: "11px", marginTop: "2px" }}>
                          {quote.contactEmail}
                        </div>
                        <div style={{ color: "#94a3b8", fontSize: "10px", marginTop: "4px" }}>
                          {new Date(quote.createdAt).toLocaleDateString()} at {new Date(quote.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </div>
                      </td>

                      {/* Requested Plan & Volume */}
                      <td style={{ padding: "12px 14px", verticalAlign: "top" }}>
                        <span
                          style={{
                            background: "#eff6ff",
                            color: "#1e40af",
                            border: "1px solid #bfdbfe",
                            padding: "2px 8px",
                            borderRadius: "6px",
                            fontSize: "11px",
                            fontWeight: "700",
                            display: "inline-block",
                            textTransform: "capitalize",
                          }}
                        >
                          {quote.requestedPlan} Plan
                        </span>
                        <div style={{ marginTop: "6px", fontSize: "13px", fontWeight: "800", color: "#047857" }}>
                          {quote.requestedFitments ? `${quote.requestedFitments.toLocaleString()} Fitments` : "Custom Fitment Limit"}
                        </div>
                      </td>

                      {/* Budget & Data Requirements */}
                      <td style={{ padding: "12px 14px", verticalAlign: "top" }}>
                        <div style={{ fontSize: "12px", color: "#0f172a", fontWeight: "700" }}>
                          {quote.monthlyBudget ? `$${quote.monthlyBudget}/mo` : "Not specified"}
                        </div>
                        {quote.dataRequirements && (
                          <div style={{ fontSize: "11px", color: "#475569", marginTop: "4px", background: "#f8fafc", padding: "4px 8px", borderRadius: "4px", border: "1px solid #e2e8f0" }}>
                            {quote.dataRequirements}
                          </div>
                        )}
                      </td>

                      {/* Notes */}
                      <td style={{ padding: "12px 14px", verticalAlign: "top", maxWidth: "220px" }}>
                        <div style={{ fontSize: "12px", color: "#334155", lineHeight: "1.4", wordBreak: "break-word" }}>
                          {quote.notes || <span style={{ color: "#94a3b8", fontStyle: "italic" }}>No notes provided</span>}
                        </div>
                        {quote.quotedPrice && (
                          <div style={{ fontSize: "11px", color: "#047857", fontWeight: "700", marginTop: "4px" }}>
                            Agreed: ${quote.quotedPrice}/mo
                          </div>
                        )}
                      </td>

                      {/* Status */}
                      <td style={{ padding: "12px 14px", textAlign: "center", verticalAlign: "top" }}>
                        <span
                          style={{
                            background: isApproved ? "#ecfdf5" : isPending ? "#fffbeb" : isContacted ? "#eff6ff" : "#fef2f2",
                            color: isApproved ? "#047857" : isPending ? "#b45309" : isContacted ? "#1e40af" : "#991b1b",
                            border: `1px solid ${isApproved ? "#a7f3d0" : isPending ? "#fde68a" : isContacted ? "#bfdbfe" : "#fecaca"}`,
                            padding: "3px 8px",
                            borderRadius: "20px",
                            fontSize: "11px",
                            fontWeight: "700",
                            display: "inline-block",
                          }}
                        >
                          {quote.status}
                        </span>
                      </td>

                      {/* Actions */}
                      <td style={{ padding: "12px 14px", textAlign: "right", verticalAlign: "top" }}>
                        <div style={{ display: "flex", flexDirection: "column", gap: "6px", alignItems: "flex-end" }}>
                          <button
                            type="button"
                            onClick={() => openPlanQuoteModal(matchingMerchant, quote)}
                            style={{
                              background: isApproved ? "#f8fafc" : "#047857",
                              color: isApproved ? "#0f172a" : "#ffffff",
                              border: isApproved ? "1px solid #cbd5e1" : "none",
                              padding: "6px 12px",
                              borderRadius: "6px",
                              fontSize: "11px",
                              fontWeight: "700",
                              cursor: "pointer",
                              whiteSpace: "nowrap",
                              display: "inline-flex",
                              alignItems: "center",
                              gap: "4px",
                            }}
                          >
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M12 20h9"></path>
                              <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path>
                            </svg>
                            {isApproved ? "Adjust Limit & Plan" : "Approve & Set Quota"}
                          </button>

                          {isPending && (
                            <planQuoteFetcher.Form method="post" style={{ display: "inline" }}>
                              <input type="hidden" name="intent" value="updateQuoteRequestStatus" />
                              <input type="hidden" name="quoteRequestId" value={quote.id} />
                              <input type="hidden" name="status" value="CONTACTED" />
                              <button
                                type="submit"
                                style={{
                                  background: "transparent",
                                  border: "none",
                                  color: "#2563eb",
                                  fontSize: "11px",
                                  fontWeight: "600",
                                  cursor: "pointer",
                                  padding: 0,
                                  textDecoration: "underline",
                                }}
                              >
                                Mark as Contacted
                              </button>
                            </planQuoteFetcher.Form>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Installed Merchant Accounts Table Card */}
      <div
        style={{
          display: activeTab === "merchants" ? "block" : "none",
          background: "#ffffff",
          border: "1px solid #e2e8f0",
          borderRadius: "14px",
          padding: "20px 22px",
          boxShadow: "0 1px 3px rgba(0, 0, 0, 0.04)",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            flexWrap: "wrap",
            gap: "16px",
            marginBottom: "18px",
          }}
        >
          <div>
            <h2 style={{ margin: "0 0 2px", fontSize: "18px", fontWeight: "800", color: "#0f172a" }}>
              Installed Merchant Accounts ({shopsList.length})
            </h2>
            <p style={{ margin: 0, color: "#64748b", fontSize: "12px" }}>
              Set custom user-specific discounts per store. Discounts dynamically reflect on each merchant&apos;s plan page.
            </p>
          </div>

          {/* Search Filter */}
          <div style={{ position: "relative", width: "260px" }}>
            <div
              style={{
                position: "absolute",
                left: "10px",
                top: "50%",
                transform: "translateY(-50%)",
                color: "#94a3b8",
                display: "flex",
                alignItems: "center",
                pointerEvents: "none",
              }}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8"></circle>
                <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
              </svg>
            </div>
            <input
              type="text"
              placeholder="Search store domain or email..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{
                width: "100%",
                height: "36px",
                paddingLeft: "32px",
                paddingRight: "12px",
                borderRadius: "8px",
                border: "1px solid #cbd5e1",
                fontSize: "12px",
                outline: "none",
                boxSizing: "border-box",
                color: "#0f172a",
              }}
            />
          </div>
        </div>

        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left", fontSize: "13px" }}>
            <thead>
              <tr style={{ borderBottom: "1px solid #e2e8f0", background: "#f8fafc" }}>
                <th style={{ padding: "10px 14px", color: "#64748b", fontWeight: "700", fontSize: "11px", letterSpacing: "0.04em", textTransform: "uppercase" }}>Merchant & Store Name</th>
                <th style={{ padding: "10px 14px", color: "#64748b", fontWeight: "700", fontSize: "11px", letterSpacing: "0.04em", textTransform: "uppercase" }}>Contact Email</th>
                <th style={{ padding: "10px 14px", color: "#64748b", fontWeight: "700", fontSize: "11px", letterSpacing: "0.04em", textTransform: "uppercase" }}>Active Plan</th>
                <th style={{ padding: "10px 14px", textAlign: "center", color: "#64748b", fontWeight: "700", fontSize: "11px", letterSpacing: "0.04em", textTransform: "uppercase" }}>VIP {vipMonthsInput || initialVipFreeOfferMonths}-Mo Free Offer</th>
                <th style={{ padding: "10px 14px", textAlign: "center", color: "#64748b", fontWeight: "700", fontSize: "11px", letterSpacing: "0.04em", textTransform: "uppercase" }}>Fitment Stats</th>
                <th style={{ padding: "10px 14px", color: "#64748b", fontWeight: "700", fontSize: "11px", letterSpacing: "0.04em", textTransform: "uppercase", minWidth: "260px" }}>
                  User Discount Option (%)
                </th>
                <th style={{ padding: "10px 14px", textAlign: "center", color: "#64748b", fontWeight: "700", fontSize: "11px", letterSpacing: "0.04em", textTransform: "uppercase" }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {filteredShops.length === 0 ? (
                <tr>
                  <td colSpan="7" style={{ padding: "28px", textAlign: "center", color: "#94a3b8" }}>
                    No matching merchant accounts found.
                  </td>
                </tr>
              ) : (
                filteredShops.map((merchant) => {
                  const isCurrent = normalizeShopDomain(merchant.shop) === normalizeShopDomain(currentShop);
                  const currentInputValue =
                    userDiscountInputs[merchant.shop] ?? merchant.merchantDiscountPercent;
                  const currentLimit = parseInt(vipStoreLimitInput, 10) || 10;
                  const currentMonths = parseInt(vipMonthsInput, 10) || initialVipFreeOfferMonths;
                  const isStoreEligible = merchant.storeIndex < currentLimit;
                  const isDynamicVipActive = merchant.isVipExplicit || (autoGrantToggle && isStoreEligible);

                  return (
                    <tr
                      key={merchant.shop}
                      style={{
                        borderBottom: "1px solid #f1f5f9",
                        background: isCurrent ? "#f0fdf4" : "transparent",
                      }}
                    >
                      {/* Merchant Store Name & Domain */}
                      <td style={{ padding: "12px 14px", verticalAlign: "middle" }}>
                        <div style={{ fontWeight: "800", color: "#0f172a", fontSize: "13px", display: "flex", alignItems: "center", gap: "6px" }}>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#2563eb" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path>
                            <polyline points="9 22 9 12 15 12 15 22"></polyline>
                          </svg>
                          {merchant.name || merchant.shop}
                        </div>
                        <div style={{ color: "#64748b", fontSize: "11px", marginTop: "2px", fontWeight: "600" }}>
                          {merchant.shop}
                        </div>
                        <div style={{ display: "flex", gap: "6px", marginTop: "4px", flexWrap: "wrap" }}>
                          {isCurrent && (
                            <span
                              style={{
                                background: "#047857",
                                color: "#ffffff",
                                padding: "2px 6px",
                                borderRadius: "4px",
                                fontSize: "10px",
                                fontWeight: "800",
                                letterSpacing: "0.02em",
                              }}
                            >
                              SUPER ADMIN
                            </span>
                          )}
                          {merchant.isCustomDiscount ? (
                            <span
                              style={{
                                background: "#fef3c7",
                                color: "#b45309",
                                border: "1px solid #fde68a",
                                padding: "2px 6px",
                                borderRadius: "4px",
                                fontSize: "10px",
                                fontWeight: "700",
                              }}
                            >
                              MERCHANT VIP ({merchant.merchantDiscountPercent}% EXTRA OFF)
                            </span>
                          ) : (
                            <span
                              style={{
                                background: "#f1f5f9",
                                color: "#64748b",
                                padding: "2px 6px",
                                borderRadius: "4px",
                                fontSize: "10px",
                                fontWeight: "600",
                              }}
                            >
                              STANDARD (0% EXTRA DISCOUNT)
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Contact Email */}
                      <td style={{ padding: "12px 14px", color: "#334155", fontWeight: "500", verticalAlign: "middle", fontSize: "13px" }}>
                        {merchant.email}
                      </td>

                      {/* Active Plan */}
                      <td style={{ padding: "12px 14px", verticalAlign: "middle" }}>
                        <span
                          style={{
                            background: "#eff6ff",
                            color: "#1e40af",
                            border: "1px solid #bfdbfe",
                            padding: "3px 8px",
                            borderRadius: "6px",
                            fontSize: "11px",
                            fontWeight: "700",
                            display: "inline-block",
                          }}
                        >
                          {merchant.activePlan}
                        </span>
                        {merchant.customFitmentLimit && (
                          <div style={{ marginTop: "4px" }}>
                            <span
                              style={{
                                background: "#ecfdf5",
                                color: "#047857",
                                border: "1px solid #a7f3d0",
                                padding: "2px 6px",
                                borderRadius: "4px",
                                fontSize: "10px",
                                fontWeight: "700",
                                display: "inline-block",
                              }}
                            >
                              Limit: {merchant.customFitmentLimit.toLocaleString()} Fitments
                            </span>
                          </div>
                        )}
                        {merchant.isManualGrant && (
                          <div style={{ marginTop: "3px" }}>
                            <span
                              style={{
                                background: "#f8fafc",
                                color: "#475569",
                                border: "1px solid #cbd5e1",
                                padding: "2px 6px",
                                borderRadius: "4px",
                                fontSize: "10px",
                                fontWeight: "600",
                                display: "inline-block",
                              }}
                            >
                              Manual Admin Grant
                            </span>
                          </div>
                        )}
                        <div style={{ marginTop: "6px" }}>
                          <button
                            type="button"
                            onClick={() => openPlanQuoteModal(merchant)}
                            style={{
                              background: "#ffffff",
                              color: "#047857",
                              border: "1px solid #047857",
                              padding: "3px 8px",
                              borderRadius: "5px",
                              fontSize: "11px",
                              fontWeight: "700",
                              cursor: "pointer",
                              display: "inline-flex",
                              alignItems: "center",
                              gap: "4px",
                              whiteSpace: "nowrap",
                            }}
                          >
                            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M12 20h9"></path>
                              <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path>
                            </svg>
                            Adjust Plan / Limit
                          </button>
                        </div>
                      </td>

                      {/* VIP Free Offer Control */}
                      <td style={{ padding: "12px 14px", textAlign: "center", verticalAlign: "middle" }}>
                        <vipOfferFetcher.Form method="post" style={{ display: "inline-flex", flexDirection: "column", alignItems: "center", gap: "4px" }}>
                          <input type="hidden" name="intent" value="toggleMerchantVipOffer" />
                          <input type="hidden" name="targetShop" value={merchant.shop} />
                          <input type="hidden" name="currentOfferActive" value={isDynamicVipActive ? "true" : "false"} />

                          <button
                            type="submit"
                            disabled={isVipOfferSubmitting}
                            style={{
                              height: "30px",
                              background: isDynamicVipActive ? "#d97706" : "#f1f5f9",
                              color: isDynamicVipActive ? "#ffffff" : "#475569",
                              border: `1px solid ${isDynamicVipActive ? "#b45309" : "#cbd5e1"}`,
                              padding: "0 10px",
                              borderRadius: "6px",
                              fontSize: "11px",
                              fontWeight: "700",
                              cursor: isVipOfferSubmitting ? "not-allowed" : "pointer",
                              whiteSpace: "nowrap",
                              boxShadow: isDynamicVipActive ? "0 2px 4px rgba(217, 119, 6, 0.2)" : "none",
                              transition: "all 0.15s ease",
                            }}
                          >
                            {isDynamicVipActive ? `${currentMonths} Mo Free Active` : `+ Grant ${currentMonths} Mo Free`}
                          </button>

                          <span style={{ fontSize: "10px", color: merchant.vipFreeOfferClaimed ? "#059669" : isDynamicVipActive ? "#d97706" : "#64748b", fontWeight: "600" }}>
                            {merchant.vipFreeOfferClaimed ? "✓ Claimed by Store" : isDynamicVipActive ? "Active in Merchant App" : "Standard Pricing"}
                          </span>
                        </vipOfferFetcher.Form>
                      </td>

                      {/* Fitment Stats */}
                      <td style={{ padding: "12px 14px", textAlign: "center", verticalAlign: "middle" }}>
                        <div style={{ fontSize: "12px", fontWeight: "700", color: "#0f172a" }}>
                          {merchant.fitments} Records
                        </div>
                        <div style={{ fontSize: "11px", color: "#64748b", marginTop: "2px" }}>
                          {merchant.mappings} Maps &bull; {merchant.searches} Searches
                        </div>
                      </td>

                      {/* User Specific Discount Option */}
                      <td style={{ padding: "12px 14px", verticalAlign: "middle" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                          <userDiscountFetcher.Form method="post" style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                            <input type="hidden" name="intent" value="saveUserDiscount" />
                            <input type="hidden" name="targetShop" value={merchant.shop} />

                            <input
                              type="number"
                              name="userDiscountPercent"
                              min="0"
                              max="95"
                              value={currentInputValue}
                              onChange={(e) =>
                                handleUserDiscountChange(merchant.shop, e.target.value)
                              }
                              style={{
                                width: "52px",
                                height: "32px",
                                padding: "0 4px",
                                borderRadius: "6px",
                                border: merchant.isCustomDiscount
                                  ? "2px solid #f59e0b"
                                  : "1px solid #cbd5e1",
                                fontSize: "12px",
                                fontWeight: "800",
                                textAlign: "center",
                                outline: "none",
                                boxSizing: "border-box",
                              }}
                            />

                            <span style={{ fontSize: "12px", fontWeight: "700", color: "#475569" }}>%</span>

                            <button
                              type="submit"
                              disabled={isUserDiscountSubmitting}
                              style={{
                                height: "32px",
                                background: "#047857",
                                color: "#ffffff",
                                border: "none",
                                padding: "0 12px",
                                borderRadius: "6px",
                                fontSize: "11px",
                                fontWeight: "700",
                                cursor: "pointer",
                                transition: "background 0.15s ease-in-out",
                                whiteSpace: "nowrap",
                              }}
                            >
                              {isUserDiscountSubmitting ? "Saving..." : "Save Discount"}
                            </button>
                          </userDiscountFetcher.Form>

                          {merchant.isCustomDiscount && (
                            <userDiscountFetcher.Form method="post" style={{ display: "inline" }}>
                              <input type="hidden" name="intent" value="resetUserDiscount" />
                              <input type="hidden" name="targetShop" value={merchant.shop} />
                              <button
                                type="submit"
                                disabled={isUserDiscountSubmitting}
                                title="Reset to Global Default"
                                style={{
                                  height: "32px",
                                  background: "#f1f5f9",
                                  color: "#64748b",
                                  border: "1px solid #cbd5e1",
                                  padding: "0 8px",
                                  borderRadius: "6px",
                                  fontSize: "11px",
                                  fontWeight: "600",
                                  cursor: "pointer",
                                  whiteSpace: "nowrap",
                                }}
                              >
                                Reset
                              </button>
                            </userDiscountFetcher.Form>
                          )}
                        </div>
                      </td>

                      {/* Status */}
                      <td style={{ padding: "12px 14px", textAlign: "center", verticalAlign: "middle" }}>
                        <span
                          style={{
                            background: "#ecfdf5",
                            color: "#047857",
                            border: "1px solid #a7f3d0",
                            padding: "3px 8px",
                            borderRadius: "20px",
                            fontSize: "11px",
                            fontWeight: "700",
                            display: "inline-flex",
                            alignItems: "center",
                            gap: "4px",
                          }}
                        >
                          <span style={{ width: "5px", height: "5px", borderRadius: "50%", background: "#047857" }}></span>
                          {merchant.status}
                        </span>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

