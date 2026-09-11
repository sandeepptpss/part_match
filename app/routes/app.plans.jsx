/* global process */
/* eslint-disable react/prop-types */
const json = (data, init) => Response.json(data, init);
import { useState } from "react";
import { useLoaderData, useFetcher, useActionData } from "react-router";
import { authenticate } from "../shopify.server";
import prismaDefault from "../db.server";
import { PrismaClient } from "@prisma/client";
import { BillingInterval } from "@shopify/shopify-app-react-router/server";
import { BILLING_PLAN_KEYS, getIsTestCharge, planLimits } from "../plans.config";
import { syncShopPlanFromBilling } from "../plans.server";
import { normalizeShopDomain } from "../utils/shopDomain";

function getPrisma() {
  if (prismaDefault?.quoteRequest) return prismaDefault;
  if (!global.prismaGlobal?.quoteRequest) {
    if (global.prismaGlobal) {
      try {
        global.prismaGlobal.$disconnect();
      } catch (e) {
        // ignore
      }
    }
    global.prismaGlobal = new PrismaClient();
  }
  return global.prismaGlobal;
}

export const loader = async ({ request }) => {
  const prisma = getPrisma();
  const { session, billing } = await authenticate.admin(request);
  const shop = session.shop;

  const sessionEmail = session.email || "";
  const shopDomain = (shop || "").toLowerCase();
  const adminStore = (process.env.ADMIN_STORE_NAME || "").toLowerCase().trim();
  const adminEmail = (process.env.ADMIN_EMAIL || "").toLowerCase().trim();
  const userEmail = (sessionEmail || "").toLowerCase().trim();

  const isAdmin =
    Boolean(adminStore && (shopDomain === adminStore || shopDomain === `${adminStore}.myshopify.com`)) ||
    Boolean(userEmail && adminEmail && userEmail === adminEmail);

  let fitmentCount = 0;
  let productMappingCount = 0;
  let universalCount = 0;
  let searchLogCount = 0;
  let vinLookupCount = 0;
  let appSettings = null;
  let globalSettings = null;

  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  try {
    const res = await Promise.all([
      prisma.fitmentRecord?.count({ where: { shop } }) ?? 0,
      prisma.fitmentProduct?.count({ where: { fitment: { shop } } }) ?? 0,
      prisma.universalProduct?.count({ where: { shop } }) ?? 0,
      prisma.searchLog?.count({ where: { shop } }) ?? 0,
      prisma.vinLookupLog?.count({ where: { shop, createdAt: { gte: startOfMonth } } }) ?? 0,
      prisma.appSettings?.findFirst({ where: { shop } }),
      prisma.appSettings?.findFirst({ where: { shop: "__GLOBAL__" } }),
    ]);
    fitmentCount = res[0];
    productMappingCount = res[1];
    universalCount = res[2];
    searchLogCount = res[3];
    vinLookupCount = res[4];
    appSettings = res[5];
    globalSettings = res[6];
  } catch (err) {
    console.error("[plans loader] Error fetching stats:", err);
  }

  const globalAnnualDiscount = globalSettings?.annualDiscountPercent ?? 20;
  const merchantDiscount =
    appSettings?.merchantDiscountPercent != null
      ? appSettings.merchantDiscountPercent
      : appSettings?.annualDiscountPercent != null && appSettings.annualDiscountPercent !== globalAnnualDiscount
        ? appSettings.annualDiscountPercent
        : 0;

  const isCustomMerchantDiscount = merchantDiscount > 0;
  const totalAnnualDiscount = globalAnnualDiscount + merchantDiscount;

  // VIP Free Offer logic (Growth Pro X Months Free for first N or manually granted stores)
  const autoGrantFirst10 = globalSettings?.autoGrantFirst10 ?? false;
  const vipFreeOfferMonths = appSettings?.vipFreeOfferMonths ?? globalSettings?.vipFreeOfferMonths ?? 2;
  const vipFreeOfferStoreLimit = appSettings?.vipFreeOfferStoreLimit ?? globalSettings?.vipFreeOfferStoreLimit ?? 10;
  let isEligibleStore = false;
  try {
    const rawStores = (await prisma.appSettings.findMany({
      where: { shop: { not: "__GLOBAL__" } },
      select: { shop: true, id: true },
      orderBy: { id: "asc" },
    })) ?? [];
    const uniqueStoreSet = new Set();
    const allStores = [];
    for (const s of rawStores) {
      const norm = normalizeShopDomain(s.shop);
      if (norm && norm !== "__GLOBAL__" && !uniqueStoreSet.has(norm)) {
        uniqueStoreSet.add(norm);
        allStores.push(norm);
      }
    }
    const normShop = normalizeShopDomain(shop);
    const shopIndex = allStores.indexOf(normShop);
    if (shopIndex !== -1 && shopIndex < vipFreeOfferStoreLimit) {
      isEligibleStore = true;
    }
  } catch (err) {
    console.warn("[plans loader] Error checking store index:", err);
  }

  const isVipFreeOfferExplicit = appSettings?.vipFreeOfferActive ?? false;
  const isVipFreeOfferClaimed = appSettings?.vipFreeOfferClaimed ?? false;
  const isVipFreeOfferActive = isVipFreeOfferExplicit || (autoGrantFirst10 && isEligibleStore);

  const shopPlan = await syncShopPlanFromBilling(billing, shop);
  const limits = planLimits(shopPlan.plan, shopPlan.customFitmentLimit);

  let pendingQuote = null;
  try {
    pendingQuote = await prisma.quoteRequest.findFirst({
      where: { shop },
      orderBy: { id: "desc" },
    });
  } catch (err) {
    console.warn("[plans loader] Error loading quoteRequest:", err);
  }

  return json({
    shop,
    fitmentCount,
    productMappingCount,
    universalCount,
    searchLogCount,
    vinLookupCount,
    sessionEmail,
    isAdmin,
    globalAnnualDiscount,
    merchantDiscount,
    totalAnnualDiscount,
    isCustomMerchantDiscount,
    isVipFreeOfferActive,
    isVipFreeOfferClaimed,
    vipFreeOfferMonths,
    vipFreeOfferStoreLimit,
    activePlan: shopPlan.plan,
    activeBillingCycle: shopPlan.billingCycle || "monthly",
    customFitmentLimit: shopPlan.customFitmentLimit,
    customMonthlyPrice: shopPlan.customMonthlyPrice,
    isManualGrant: shopPlan.isManualGrant,
    recordsLimit: Number.isFinite(limits.fitmentLimit) ? limits.fitmentLimit : null,
    isCustomQuota: Boolean(limits.isCustomQuota),
    pendingQuote,
    vinLimit: limits.vinMonthlyLimit,
    vinOverageRate: limits.vinOverageRate,
  });
};

export const action = async ({ request }) => {
  const prisma = getPrisma();
  const { session, billing } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "submitQuoteRequest") {
    const quoteIdRaw = formData.get("quoteId")?.toString()?.trim();
    const quoteId = quoteIdRaw && !isNaN(parseInt(quoteIdRaw, 10)) ? parseInt(quoteIdRaw, 10) : null;
    const requestedPlan = formData.get("requestedPlan")?.toString() || "enterprise";
    const requestedFitments = parseInt(formData.get("requestedFitments")?.toString() || "50000", 10) || 50000;
    const rawBudget = formData.get("monthlyBudget")?.toString()?.trim();
    const monthlyBudget = rawBudget && !isNaN(parseFloat(rawBudget)) ? parseFloat(rawBudget) : null;
    const contactEmail = formData.get("contactEmail")?.toString() || session?.email || "";
    const dataRequirements = formData.get("dataRequirements")?.toString() || "";
    const notes = formData.get("notes")?.toString() || "";

    try {
      if (quoteId != null) {
        await prisma.quoteRequest.updateMany({
          where: { id: quoteId, shop },
          data: {
            contactEmail,
            requestedPlan,
            requestedFitments,
            monthlyBudget,
            dataRequirements,
            notes,
            status: "PENDING",
          },
        });
      } else {
        await prisma.quoteRequest.create({
          data: {
            shop,
            contactEmail,
            requestedPlan,
            requestedFitments,
            monthlyBudget,
            dataRequirements,
            notes,
            status: "PENDING",
          },
        });
      }

      return json({
        quoteSuccess: true,
        quoteMessage: `Your custom enterprise quote request for ${requestedFitments.toLocaleString("en-US")} vehicle fitments has been ${quoteId != null ? "updated" : "submitted"}! Your current active plan remains unaffected while our automotive catalog engineering team reviews your specifications.`,
      });
    } catch (err) {
      console.error("[submitQuoteRequest] Error saving quote:", err);
      return json({ quoteError: `Unable to submit quote request: ${err?.message || "Internal database error"}. Please try again.` });
    }
  }

  if (intent === "claimVipFreeOffer") {
    // Verify eligibility on server before granting free upgrade
    const globalSettings = await prisma.appSettings.findFirst({ where: { shop: "__GLOBAL__" } });
    const currentSettings = await prisma.appSettings.findFirst({ where: { shop } });

    const autoGrantFirst10 = globalSettings?.autoGrantFirst10 ?? false;
    const vipFreeOfferStoreLimit = currentSettings?.vipFreeOfferStoreLimit ?? globalSettings?.vipFreeOfferStoreLimit ?? 10;

    let isEligibleStore = false;
    try {
      const rawStores = (await prisma.appSettings.findMany({
        where: { shop: { not: "__GLOBAL__" } },
        select: { shop: true, id: true },
        orderBy: { id: "asc" },
      })) ?? [];
      const uniqueStoreSet = new Set();
      const allStores = [];
      for (const s of rawStores) {
        const norm = normalizeShopDomain(s.shop);
        if (norm && norm !== "__GLOBAL__" && !uniqueStoreSet.has(norm)) {
          uniqueStoreSet.add(norm);
          allStores.push(norm);
        }
      }
      const normShop = normalizeShopDomain(shop);
      const shopIndex = allStores.indexOf(normShop);
      if (shopIndex !== -1 && shopIndex < vipFreeOfferStoreLimit) {
        isEligibleStore = true;
      }
    } catch (err) {
      console.warn("[claimVipFreeOffer] Error checking store index:", err);
    }

    const isVipFreeOfferExplicit = currentSettings?.vipFreeOfferActive ?? false;
    const isEligible = isVipFreeOfferExplicit || (autoGrantFirst10 && isEligibleStore);

    if (!isEligible) {
      return json({ success: false, message: "Your store is not currently eligible for the VIP Free Offer." }, { status: 403 });
    }

    try {
      await prisma.shopPlan.upsert({
        where: { shop },
        update: { plan: "growth", billingCycle: "monthly" },
        create: { shop, plan: "growth", billingCycle: "monthly" },
      });
    } catch (err) {
      console.warn("[claimVipFreeOffer] Error upserting shopPlan:", err?.message);
    }

    try {
      await prisma.appSettings.upsert({
        where: { shop },
        update: {
          vipFreeOfferActive: true,
          vipFreeOfferClaimed: true,
          vipFreeOfferGrantedAt: new Date(),
        },
        create: {
          shop,
          vipFreeOfferActive: true,
          vipFreeOfferClaimed: true,
          vipFreeOfferGrantedAt: new Date(),
        },
      });
    } catch (err) {
      console.warn("[claimVipFreeOffer] Error upserting appSettings:", err?.message);
    }

    const vipMonths = currentSettings?.vipFreeOfferMonths ?? globalSettings?.vipFreeOfferMonths ?? 2;
    const vipDays = vipMonths * 30;

    return json({
      success: true,
      message: `Growth Pro ${vipMonths}-Months FREE Offer activated successfully! All Growth Pro features unlocked for ${vipDays} days.`,
    });
  }

  if (intent === "selectPlan") {
    const selectedPlan = formData.get("plan");
    const billingCycle = formData.get("billingCycle") === "annual" ? "annual" : "monthly";
    const isTest = getIsTestCharge(shop);

    if (selectedPlan === "free") {
      try {
        const { appSubscriptions } = await billing.check();
        const active = appSubscriptions?.[0];
        if (active) {
          await billing.cancel({ subscriptionId: active.id, isTest });
        }
      } catch (err) {
        console.warn("[plans action] Error cancelling subscription:", err);
      }
      await prisma.shopPlan.upsert({
        where: { shop },
        update: { plan: "free", billingCycle: "monthly", subscriptionId: null },
        create: { shop, plan: "free", billingCycle: "monthly", subscriptionId: null },
      });
      return json({ success: true, message: "Plan updated to STARTER FREE." });
    }

    const billingPlanKey = BILLING_PLAN_KEYS[selectedPlan]?.[billingCycle];

    if (!billingPlanKey) {
      return json(
        { success: false, message: "Invalid plan or billing cycle selected." },
        { status: 400 },
      );
    }

    const url = new URL(request.url);
    const origin = process.env.SHOPIFY_APP_URL
      ? new URL(process.env.SHOPIFY_APP_URL).origin
      : url.origin;
    let returnUrl = `${origin}/app/plans${url.search}`;
    if (returnUrl.startsWith("http://")) {
      returnUrl = returnUrl.replace("http://", "https://");
    }

    const globalSettings = await prisma.appSettings.findFirst({ where: { shop: "__GLOBAL__" } });
    const appSettings = await prisma.appSettings.findFirst({ where: { shop } });
    const globalAnnualDiscount = globalSettings?.annualDiscountPercent ?? 20;
    const merchantDiscount =
      appSettings?.merchantDiscountPercent != null
        ? appSettings.merchantDiscountPercent
        : 0;
    const totalAnnualDiscount = globalAnnualDiscount + merchantDiscount;

    // High conversion pricing strategy: $19 Starter, $49 Growth Pro, $99 Enterprise
    let baseMonthlyPrice = 19.0;
    if (selectedPlan === "growth") baseMonthlyPrice = 49.0;
    if (selectedPlan === "enterprise") baseMonthlyPrice = 99.0;

    let dynamicLineItem;

    if (billingCycle === "annual") {
      const annualPrice = parseFloat(((baseMonthlyPrice * 12) * (1 - totalAnnualDiscount / 100)).toFixed(2));
      dynamicLineItem = {
        amount: annualPrice,
        currencyCode: "USD",
        interval: BillingInterval.Annual,
      };
    } else {
      const monthlyPrice = parseFloat((baseMonthlyPrice * (1 - merchantDiscount / 100)).toFixed(2));
      dynamicLineItem = {
        amount: monthlyPrice,
        currencyCode: "USD",
        interval: BillingInterval.Every30Days,
      };
    }

    try {
      await billing.request({
        plan: billingPlanKey,
        isTest,
        returnUrl,
        trialDays: 14,
        lineItems: [dynamicLineItem],
      });
    } catch (error) {
      if (
        error instanceof Response ||
        (error && typeof error === "object" && "status" in error && "headers" in error)
      ) {
        throw error;
      }

      console.error("[plans action] Error requesting billing:", error);

      // Only auto-grant the plan without a completed Shopify charge on
      // recognized dev/test stores. A billing.request() failure on a real
      // store must never silently unlock a paid plan for free — surface it
      // as an error instead so the merchant can retry.
      if (!isTest) {
        return json(
          {
            success: false,
            message: "We couldn't start your subscription with Shopify Billing. Please try again in a moment.",
          },
          { status: 502 },
        );
      }

      await prisma.shopPlan.upsert({
        where: { shop },
        update: { plan: selectedPlan, billingCycle, subscriptionId: null },
        create: { shop, plan: selectedPlan, billingCycle, subscriptionId: null },
      });

      const planName = selectedPlan === "starter" ? "Starter Pro" : selectedPlan === "growth" ? "Growth Pro" : "Enterprise Unlimited";
      return json({
        success: true,
        message: `Plan activated: ${planName}! (Development/Custom Mode: Live Shopify Billing active).`,
      });
    }
  }

  return json({ success: false });
};

export default function PlansPage() {
  const {
    shop,
    sessionEmail,
    fitmentCount,
    merchantDiscount,
    totalAnnualDiscount,
    isVipFreeOfferActive,
    isVipFreeOfferClaimed,
    vipFreeOfferMonths = 2,
    activePlan,
    activeBillingCycle,
    customFitmentLimit,
    customMonthlyPrice,
    recordsLimit,
    isCustomQuota,
    pendingQuote,
  } = useLoaderData();

  const actionData = useActionData();
  const vipClaimFetcher = useFetcher();
  const isVipClaiming = vipClaimFetcher.state !== "idle";

  const quoteFetcher = useFetcher();
  const isSubmittingQuote = quoteFetcher.state !== "idle";
  const [quoteModalOpen, setQuoteModalOpen] = useState(false);
  const [quoteId, setQuoteId] = useState(null);
  const [quoteTargetPlan, setQuoteTargetPlan] = useState("enterprise");
  const [quoteFitments, setQuoteFitments] = useState(100000);
  const [quoteBudget, setQuoteBudget] = useState("");
  const [quoteEmail, setQuoteEmail] = useState(sessionEmail || "");
  const [quoteNotes, setQuoteNotes] = useState("");
  const [selectedRequirements, setSelectedRequirements] = useState([
    "ACES 3.2 / 4.0 XML Standard",
    "Automated Daily SFTP Sync",
  ]);
  const [customIntegration, setCustomIntegration] = useState("");

  const availableRequirements = [
    { label: "ACES 3.2 / 4.0 XML Standard", hint: "Auto Care vehicle fitment standard" },
    { label: "Automated Daily SFTP Sync", hint: "Nightly automated catalog ingestion" },
    { label: "SEMA Data Co-op (SDC) Feed", hint: "Direct SEMA distributor network sync" },
    { label: "PIES 7.2 Product Data", hint: "Extended part attributes & specifications" },
    { label: "WHI Nexpart / Epicor Integration", hint: "Major aftermarket parts networks" },
    { label: "High-Volume Quota Expansion", hint: "100k+ to 1,000,000+ vehicle records" },
    { label: "Competitor Catalog Migration", hint: "Seamless import from RevParts or SureFit" },
    { label: "Custom Invoicing & Annual PO", hint: "B2B terms & corporate invoicing" },
  ];

  const openQuoteModal = (targetPlan = "enterprise", fitments = 100000) => {
    if (pendingQuote && pendingQuote.status === "PENDING") {
      setQuoteId(pendingQuote.id);
      setQuoteTargetPlan(pendingQuote.requestedPlan || targetPlan);
      setQuoteFitments(pendingQuote.requestedFitments || fitments);
      setQuoteBudget(pendingQuote.monthlyBudget ? String(pendingQuote.monthlyBudget) : "");
      setQuoteEmail(pendingQuote.contactEmail || sessionEmail || "");
      setQuoteNotes(pendingQuote.notes || "");
      const rawReqs = (pendingQuote.dataRequirements || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      setSelectedRequirements(rawReqs.length > 0 ? rawReqs : ["ACES 3.2 / 4.0 XML Standard", "Automated Daily SFTP Sync"]);
      setCustomIntegration("");
    } else {
      setQuoteId(null);
      setQuoteTargetPlan(targetPlan);
      setQuoteFitments(fitments);
      setQuoteBudget("");
      setQuoteEmail(sessionEmail || "");
      setQuoteNotes("");
      setSelectedRequirements(
        targetPlan === "enterprise"
          ? ["ACES 3.2 / 4.0 XML Standard", "Automated Daily SFTP Sync"]
          : ["High-Volume Quota Expansion"]
      );
      setCustomIntegration("");
    }
    setQuoteModalOpen(true);
  };

  const toggleRequirement = (label) => {
    setSelectedRequirements((prev) =>
      prev.includes(label) ? prev.filter((item) => item !== label) : [...prev, label]
    );
  };

  const [billingCycle, setBillingCycle] = useState("monthly");

  const calcMonthly = (basePrice) => {
    if (basePrice === 0) return "$0";
    const discounted = basePrice * (1 - merchantDiscount / 100);
    return `$${discounted.toFixed(2)}`;
  };

  const calcAnnualMonthlyEq = (basePrice) => {
    if (basePrice === 0) return "$0";
    const discountedMonthly = basePrice * (1 - totalAnnualDiscount / 100);
    return `$${discountedMonthly.toFixed(2)}`;
  };

  const calcAnnualTotal = (basePrice) => {
    if (basePrice === 0) return "$0";
    const total = (basePrice * 12) * (1 - totalAnnualDiscount / 100);
    return `$${total.toFixed(2)}`;
  };

  // High conversion $19 / $49 / $99 pricing strategy tailored for Shopify Auto Parts Merchants
  const plans = [
    {
      id: "free",
      name: "Starter Free",
      priceMonthly: "$0",
      priceAnnual: "$0",
      priceAnnualNote: "Free Forever · No Credit Card Required",
      period: "forever",
      dailyCost: "$0/day · 100 fitments limit",
      description: "For brand new stores testing basic fitment search functionality.",
      recordsLimit: "100 Mapped Vehicle Records",
      badge: null,
      trialBadge: "Instant Setup",
      highlight: false,
      ctaText: "Downgrade to Free",
      features: [
        "Up to 100 Fitment Records",
        "Year / Make / Model Search Widget",
        "Single Page & Collection Results Grid",
        "Product Page Fitment Checker Badge",
        "Local Storage Vehicle Garage",
        "Standard Email Support",
      ],
      disabledFeatures: [
        "Sub-Model & Trim Level Filtering",
        "VIN Lookup & Auto-Decoder",
        "ACES / PIES XML Export & Import",
        "1-Click Competitor Importer",
        "AI Voice Search Assistant",
        "CSV Bulk Import & Export",
        "Search Analytics & Gap Intelligence",
        "AI Catalog Auto-Fitter",
      ],
    },
    {
      id: "starter",
      name: "Starter Pro",
      priceMonthly: calcMonthly(19.0),
      priceAnnual: calcAnnualMonthlyEq(19.0),
      priceAnnualNote: `Billed annually at ${calcAnnualTotal(19.0)}/year (${totalAnnualDiscount}% OFF)`,
      period: "per month",
      dailyCost: "~$0.63/day · 1 saved return pays for full month",
      description: "Essential fitment & YMM tools for boutique auto parts shops.",
      recordsLimit: "5,000 Mapped Vehicle Records",
      badge: null,
      trialBadge: "14-Day Free Trial",
      highlight: false,
      ctaText: "Start 14-Day Free Trial →",
      features: [
        "14-Day Risk-Free Trial",
        "Up to 5,000 Fitment Records",
        "Sub-Model & Trim Level Filtering",
        "25 Free VIN Lookups/mo ($0.08 after)",
        "Product Page Fitment Checker Badge",
        "Unlimited Universal Products",
        "Standard CSV Import & Export",
        "Standard Analytics & Logging",
        "Email Support",
      ],
      disabledFeatures: [
        "ACES / PIES XML Export & Import",
        "1-Click Competitor Importer",
        "AI Voice Search Assistant",
        "AI Catalog Auto-Fitter",
      ],
    },
    {
      id: "growth",
      name: "Growth Pro",
      priceMonthly: isVipFreeOfferActive ? `$0.00 (${vipFreeOfferMonths} Mo Free)` : calcMonthly(49.0),
      priceAnnual: isVipFreeOfferActive ? `$0.00 (${vipFreeOfferMonths} Mo Free)` : calcAnnualMonthlyEq(49.0),
      priceAnnualNote: isVipFreeOfferActive
        ? `Growth Pro ${vipFreeOfferMonths}-Months FREE Offer Granted by Admin ($0 for ${vipFreeOfferMonths * 30} Days)`
        : `Billed annually at ${calcAnnualTotal(49.0)}/year (${totalAnnualDiscount}% OFF)`,
      period: isVipFreeOfferActive ? `for ${vipFreeOfferMonths * 30} days` : "per month",
      dailyCost: isVipFreeOfferActive ? `$0/day for ${vipFreeOfferMonths * 30} days · Admin VIP Special` : "~$1.63/day · High ROI for growing retailers",
      description: "Complete fitment solution with ACES/PIES & AI Voice for growing stores.",
      recordsLimit: "20,000 Mapped Vehicle Records",
      badge: isVipFreeOfferActive ? `VIP ${vipFreeOfferMonths}-MONTHS FREE OFFER UNLOCKED` : "MOST POPULAR — BEST VALUE",
      trialBadge: isVipFreeOfferActive ? `${vipFreeOfferMonths * 30} Days Free ($0)` : "14-Day Free Trial",
      highlight: true,
      ctaText: isVipFreeOfferActive
        ? isVipFreeOfferClaimed
          ? `Active Plan (${vipFreeOfferMonths} Mo Free)`
          : `Claim ${vipFreeOfferMonths} Months FREE Growth Pro →`
        : "Start 14-Day Free Trial →",
      features: [
        isVipFreeOfferActive ? `${vipFreeOfferMonths * 30} Days Risk-Free ($0/mo)` : "14-Day Risk-Free Trial",
        "Up to 20,000 Fitment Records",
        "250 Free VIN Lookups/mo ($0.05 after)",
        "ACES / PIES XML & CSV Import/Export",
        "1-Click Competitor Data Importer (Easy YMM/ACES)",
        "Staging Conflict Guard & 1-Click Rollback",
        "AI Voice & Conversational Search Assistant",
        "Sub-Model & Trim Level Filtering",
        "Unlimited Universal Products",
        "Product Page Fitment Checker Badge",
        "My Garage Vehicle Persistence",
        "CSV Bulk Import & Export",
        "Search Analytics & Failed Query Logging",
        "Priority Email & Live Support",
      ],
      disabledFeatures: ["AI Catalog Auto-Fitter (Beta)", "AI PDF/Catalog Import"],
    },
    {
      id: "enterprise",
      name: "Enterprise Unlimited",
      priceMonthly: calcMonthly(99.0),
      priceAnnual: calcAnnualMonthlyEq(99.0),
      priceAnnualNote: `Billed annually at ${calcAnnualTotal(99.0)}/year (${totalAnnualDiscount}% OFF)`,
      period: "per month",
      dailyCost: "~$3.30/day · Maximum scale for large catalogs",
      description: "Maximum scale, AI auto-fitter & dedicated performance for large automotive stores.",
      recordsLimit: "Unlimited Fitment Records",
      badge: "UNLIMITED SCALE",
      trialBadge: "14-Day Free Trial",
      highlight: false,
      ctaText: "Start 14-Day Free Trial →",
      features: [
        "14-Day Risk-Free Trial",
        "Unlimited Fitment Records",
        "1,000 Free VIN Lookups/mo ($0.03 after)",
        "AI Vehicle Fitment Import (PDF & Catalogs)",
        "1-Click AI Catalog Auto-Fitter (Beta)",
        "1-Click Competitor Data Importer (Unlimited)",
        "Advanced AI Voice & Conversational Engine",
        "Enterprise ACES / PIES Standard Engine",
        "Import Conflict Guard & Instant Rollback",
        "Cross-Device Garage Persistence",
        "High-Speed Proxy SLA & Edge Caching",
        "VIP Dedicated 1-on-1 Account Manager",
      ],
      disabledFeatures: [],
    },
  ];

  // Feature Matrix Groups (4 Plans: Free, Starter, Growth, Enterprise)
  const matrixGroups = [
    {
      category: "Core Scale & Capacity",
      rows: [
        {
          name: "14-Day Risk-Free Trial",
          free: "Instant Setup",
          starter: "✓ 14 Days Free",
          growth: "✓ 14 Days Free",
          enterprise: "✓ 14 Days Free",
        },
        {
          name: "Fitment Records Capacity",
          free: "100",
          starter: "5,000",
          growth: "20,000",
          enterprise: "Unlimited",
        },
        {
          name: "Results Display Options",
          free: "Inline Widget & Single Page",
          starter: "✓ Inline & Collection Grid",
          growth: "✓ Full Collections Grid, Dedicated Page & Inline Widget",
          enterprise: "✓ Multi-Layout, Custom Theme Integration & Proxy SLA",
        },
      ],
    },
    {
      category: "ACES / PIES & Data Engineering",
      rows: [
        {
          name: "ACES / PIES Standard Engine (XML & CSV)",
          free: "✕",
          starter: "✕",
          growth: "✓ Import & Export",
          enterprise: "✓ Full Enterprise Engine",
        },
        {
          name: "AI Vehicle Fitment Import (PDF & Catalogs)",
          free: "✕",
          starter: "✕",
          growth: "✕",
          enterprise: "✓ Gemini AI Document & Spec Extraction",
        },
        {
          name: "Staging Queue & Conflict Detection Guard",
          free: "✕",
          starter: "✓ Basic Staging",
          growth: "✓ Full Staging & Conflict Alerts",
          enterprise: "✓ Full Conflict Guard & Automated Normalization",
        },
        {
          name: "Import History & 1-Click Rollback",
          free: "✕",
          starter: "✕",
          growth: "✓ Full Audit History & Rollback",
          enterprise: "✓ Unlimited Audit Logs & Instant Rollback",
        },
        {
          name: "CSV Bulk Import & Export",
          free: "✕",
          starter: "✓ Standard CSV",
          growth: "✓ Unlimited CSV",
          enterprise: "✓ Automated Sync & Unlimited",
        },
        {
          name: "1-Click Competitor Data Migration Importer",
          free: "✕",
          starter: "✕",
          growth: "✓ Easy YMM / Fitment Group / ACES",
          enterprise: "✓ Unlimited Migration Tools",
        },
      ],
    },
    {
      category: "VIN & Search AI Intelligence",
      rows: [
        {
          name: "VIN Lookup & Auto-Decoder",
          free: "✕",
          starter: "✓ 25 Free/mo ($0.08 overage)",
          growth: "✓ 250 Free/mo ($0.05 overage)",
          enterprise: "✓ 1,000 Free/mo ($0.03 overage)",
        },
        {
          name: "AI Voice & Conversational Search Assistant",
          free: "✕",
          starter: "✕",
          growth: "✓ Standard Natural Voice",
          enterprise: "✓ Advanced AI Engine",
        },
        {
          name: "1-Click AI Catalog Auto-Fitter (Beta)",
          free: "✕",
          starter: "✕",
          growth: "✕",
          enterprise: "✓ Full Access (100% Automated)",
        },
        {
          name: "Search Analytics & Intelligence",
          free: "Basic Queries",
          starter: "Standard Analytics",
          growth: "Detailed + No-Result Gap Logs",
          enterprise: "Real-Time Export & Dashboard",
        },
      ],
    },
    {
      category: "Storefront Fitment & Garage",
      rows: [
        {
          name: "Sub-Model & Trim Level Filtering",
          free: "Basic Year/Make/Model only",
          starter: "✓ Sub-Model & Trim",
          growth: "✓ Full Trim Support",
          enterprise: "✓ Advanced Engine",
        },
        {
          name: "Unlimited Universal Products Support",
          free: "✕",
          starter: "✓ Unlimited",
          growth: "✓ Unlimited",
          enterprise: "✓ Unlimited",
        },
        {
          name: "Product Page Fitment Checker Badge",
          free: "✓ Basic",
          starter: "✓ Included",
          growth: "✓ Included",
          enterprise: "✓ Custom Styling",
        },
        {
          name: "My Garage Saved Vehicles Persistence",
          free: "Local Storage (5 cars)",
          starter: "Local Storage (5 cars)",
          growth: "✓ Cross-Device Customer DB",
          enterprise: "✓ Cross-Device Customer DB",
        },
      ],
    },
    {
      category: "Performance, SLAs & Support",
      rows: [
        {
          name: "Storefront Proxy SLA & Edge Caching",
          free: "Standard App Proxy",
          starter: "Standard App Proxy",
          growth: "✓ High-Speed Global CDN Proxy",
          enterprise: "✓ Dedicated Edge Caching & SLA",
        },
        {
          name: "Daily Automated Database Backups",
          free: "✕",
          starter: "Weekly Backup",
          growth: "✓ Daily Automated Backups",
          enterprise: "✓ Real-Time Hourly Backups",
        },
        {
          name: "Customer Support SLA",
          free: "Standard Email (48h)",
          starter: "Email Support (24h)",
          growth: "✓ Priority Email & Live Desk (12h)",
          enterprise: "✓ Dedicated 1-on-1 Account Manager",
        },
      ],
    },
  ];

  return (
    <div style={{ width: "100%", maxWidth: "100%", boxSizing: "border-box", margin: "0 auto", padding: "28px 24px 60px", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif", color: "#0f172a" }}>
      {/* Action Notification Banner */}
      {actionData?.message && (
        <div
          style={{
            background: actionData?.success !== false ? "#ecfdf5" : "#fef2f2",
            border: `1px solid ${actionData?.success !== false ? "#a7f3d0" : "#fecaca"}`,
            color: actionData?.success !== false ? "#047857" : "#991b1b",
            padding: "16px 20px",
            borderRadius: "12px",
            marginBottom: "24px",
            fontWeight: "700",
            fontSize: "14px",
          }}
        >
          <span style={{ fontWeight: "800" }}>{actionData?.success !== false ? "Success:" : "Error:"}</span> {actionData.message}
        </div>
      )}

      {/* Quote Submission Banner */}
      {quoteFetcher.data?.quoteMessage && (
        <div style={{ background: "#f0fdf4", border: "1px solid #86efac", color: "#166534", padding: "16px 20px", borderRadius: "12px", marginBottom: "24px", fontSize: "14px", fontWeight: "600", display: "flex", alignItems: "center", gap: "10px" }}>
          <span style={{ fontSize: "18px" }}>✅</span>
          <div>
            <span style={{ fontWeight: "800" }}>Quote Status Updated:</span> {quoteFetcher.data.quoteMessage}
          </div>
        </div>
      )}

      {quoteFetcher.data?.quoteError && (
        <div style={{ background: "#fef2f2", border: "1px solid #fecaca", color: "#991b1b", padding: "16px 20px", borderRadius: "12px", marginBottom: "24px", fontSize: "14px", fontWeight: "700" }}>
          <span>Error:</span> {quoteFetcher.data.quoteError}
        </div>
      )}

      {/* Custom Quota Active Banner */}
      {isCustomQuota && customFitmentLimit != null && (
        <div style={{ background: "linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%)", border: "1px solid #86efac", borderRadius: "14px", padding: "18px 24px", marginBottom: "24px", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "12px", boxShadow: "0 2px 8px rgba(22, 101, 52, 0.08)" }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
              <span style={{ background: "#166534", color: "#ffffff", padding: "2px 8px", borderRadius: "6px", fontSize: "10px", fontWeight: "800", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                CUSTOM PLAN QUOTA ACTIVE
              </span>
              <span style={{ fontSize: "15px", fontWeight: "800", color: "#14532d" }}>
                Active Quota: {customFitmentLimit.toLocaleString()} Vehicle Fitments
              </span>
            </div>
            <p style={{ margin: 0, fontSize: "13px", color: "#15803d" }}>
              Your store has been assigned a custom negotiated plan with expanded fitment database capacity
              {customMonthlyPrice != null ? ` at $${customMonthlyPrice.toFixed(2)}/mo` : ""}.
            </p>
          </div>
          <span style={{ background: "#ffffff", color: "#166534", border: "1px solid #bbf7d0", padding: "4px 12px", borderRadius: "8px", fontSize: "12px", fontWeight: "700" }}>
            Admin Managed Quote
          </span>
        </div>
      )}

      {/* Pending Quote Request Notice */}
      {pendingQuote && pendingQuote.status === "PENDING" && !isCustomQuota && (
        <div style={{ background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: "14px", padding: "18px 22px", marginBottom: "24px", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "16px", boxShadow: "0 2px 8px rgba(37, 99, 235, 0.08)" }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "6px" }}>
              <span style={{ background: "#2563eb", color: "#ffffff", padding: "3px 8px", borderRadius: "6px", fontSize: "10px", fontWeight: "800", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                ENTERPRISE QUOTE IN REVIEW
              </span>
              <span style={{ fontSize: "15px", fontWeight: "800", color: "#1e40af" }}>
                Request #{pendingQuote.id} · {pendingQuote.requestedFitments.toLocaleString()} Vehicle Records ({pendingQuote.requestedPlan.toUpperCase()})
              </span>
            </div>
            <p style={{ margin: 0, fontSize: "13px", color: "#3b82f6", lineHeight: "1.5" }}>
              Our automotive engineering team is reviewing your specifications. <strong>Your active plan ({activePlan.toUpperCase()}) remains unaffected</strong> with continuous storefront fitment searches.
            </p>
          </div>
          <button
            type="button"
            onClick={() => openQuoteModal(pendingQuote.requestedPlan, pendingQuote.requestedFitments)}
            style={{ background: "#ffffff", border: "1px solid #93c5fd", color: "#1d4ed8", padding: "8px 16px", borderRadius: "8px", fontSize: "13px", fontWeight: "700", cursor: "pointer", boxShadow: "0 1px 3px rgba(0,0,0,0.05)" }}
          >
            Review & Edit Quote Details →
          </button>
        </div>
      )}

      {/* VIP Free 2-Months Offer Banner */}
      {isVipFreeOfferActive && !isVipFreeOfferClaimed && activePlan !== "growth" && activePlan !== "enterprise" && (
        <div
          style={{
            background: "linear-gradient(135deg, #064e3b 0%, #047857 50%, #d97706 100%)",
            borderRadius: "16px",
            padding: "22px 26px",
            color: "#ffffff",
            marginBottom: "24px",
            boxShadow: "0 8px 24px rgba(4, 120, 87, 0.25)",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "16px" }}>
            <div>
              <span
                style={{
                  background: "#f59e0b",
                  color: "#000000",
                  padding: "4px 10px",
                  borderRadius: "12px",
                  fontSize: "11px",
                  fontWeight: "800",
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                }}
              >
                VIP EXCLUSIVE OFFER UNLOCKED
              </span>
              <h2 style={{ margin: "10px 0 4px", fontSize: "20px", fontWeight: "800", color: "#ffffff" }}>
                Growth Pro FREE for {vipFreeOfferMonths} Months ($0/mo for {vipFreeOfferMonths * 30} Days)!
              </h2>
              <p style={{ margin: 0, color: "#a7f3d0", fontSize: "13px", maxWidth: "650px", lineHeight: "1.4" }}>
                You have been granted an exclusive VIP invitation by PartMatch Admin. Enjoy all Growth Pro features (20,000 Fitments, 250 VIN lookups/mo, ACES/PIES import, & AI Voice Search) completely free for {vipFreeOfferMonths * 30} days!
              </p>
            </div>

            <vipClaimFetcher.Form method="post">
              <input type="hidden" name="intent" value="claimVipFreeOffer" />
              <button
                type="submit"
                disabled={isVipClaiming}
                style={{
                  background: "#ffffff",
                  color: "#047857",
                  border: "none",
                  padding: "12px 24px",
                  borderRadius: "10px",
                  fontSize: "14px",
                  fontWeight: "800",
                  cursor: isVipClaiming ? "not-allowed" : "pointer",
                  boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
                  transition: "all 0.15s ease",
                  whiteSpace: "nowrap",
                }}
              >
                {isVipClaiming ? "Activating..." : `Claim ${vipFreeOfferMonths} Months FREE Growth Pro →`}
              </button>
            </vipClaimFetcher.Form>
          </div>
        </div>
      )}

      {/* Hero Header */}
      <div
        style={{
          background: "linear-gradient(135deg, #0b1329 0%, #1e293b 100%)",
          borderRadius: "20px",
          padding: "32px 32px 28px",
          marginBottom: "32px",
          color: "#ffffff",
          boxShadow: "0 10px 30px rgba(15, 23, 42, 0.3)",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "20px", marginBottom: "24px" }}>
          <div>
            <div style={{ display: "inline-block", background: "rgba(16, 185, 129, 0.2)", border: "1px solid #10b981", padding: "4px 10px", borderRadius: "20px", fontSize: "12px", fontWeight: "700", color: "#34d399", marginBottom: "12px", textTransform: "uppercase", letterSpacing: "0.5px" }}>
              PartMatch Automotive Fitment Plans
            </div>
            <h1 style={{ margin: "0 0 8px", fontSize: "28px", fontWeight: "800", letterSpacing: "-0.5px" }}>
              Transparent, Scalable Pricing for Automotive Stores
            </h1>
            <p style={{ margin: 0, color: "#94a3b8", fontSize: "15px" }}>
              Start with a 14-day free trial. Cancel or change plans anytime with 1 click.
            </p>
          </div>
          <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
            <div style={{ background: "rgba(255, 255, 255, 0.1)", border: "1px solid rgba(255, 255, 255, 0.2)", color: "#ffffff", padding: "8px 14px", borderRadius: "12px", fontSize: "13px", fontWeight: "700" }}>
              Catalog Usage: <strong style={{ color: "#34d399" }}>{fitmentCount.toLocaleString()}</strong> / {recordsLimit === null ? "Unlimited" : recordsLimit.toLocaleString()} Records
            </div>
          </div>
        </div>

        <div style={{ height: "1px", background: "rgba(255, 255, 255, 0.12)", margin: "24px 0" }} />

        {/* Billing Toggle */}
        <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: "14px" }}>
          <span style={{ fontSize: "14px", fontWeight: billingCycle === "monthly" ? "700" : "500", color: billingCycle === "monthly" ? "#ffffff" : "#94a3b8" }}>
            Monthly Billing
          </span>

          <button
            type="button"
            onClick={() => setBillingCycle(billingCycle === "monthly" ? "annual" : "monthly")}
            style={{
              background: billingCycle === "annual" ? "#008060" : "#475569",
              border: "none",
              borderRadius: "20px",
              padding: "4px 8px",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              width: "50px",
              transition: "background 0.3s",
            }}
          >
            <div
              style={{
                width: "18px",
                height: "18px",
                borderRadius: "50%",
                background: "#ffffff",
                transform: billingCycle === "annual" ? "translateX(22px)" : "translateX(0)",
                transition: "transform 0.3s",
              }}
            />
          </button>

          <span style={{ fontSize: "14px", fontWeight: billingCycle === "annual" ? "700" : "500", color: billingCycle === "annual" ? "#ffffff" : "#94a3b8" }}>
            Annual Billing <span style={{ background: "#059669", color: "#ffffff", padding: "2px 8px", borderRadius: "10px", fontSize: "11px", fontWeight: "800", marginLeft: "4px" }}>Save {totalAnnualDiscount}%</span>
          </span>
        </div>
      </div>

      {/* Pricing Cards Grid (4 Tiers) */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: "20px", marginBottom: "40px" }}>
        {plans.map((plan) => {
          const isCurrent = activePlan === plan.id && (plan.id === "free" ? true : billingCycle === (activeBillingCycle || "monthly"));
          const displayPrice = billingCycle === "annual" ? plan.priceAnnual : plan.priceMonthly;

          let buttonLabel = plan.ctaText;
          if (isCurrent) {
            buttonLabel = "Current Active Plan";
          } else if (activePlan === plan.id) {
            buttonLabel = billingCycle === "annual" ? `Switch to Annual (Save ${totalAnnualDiscount}%)` : "Switch to Monthly";
          } else if (plan.id === "free") {
            buttonLabel = "Downgrade to Free";
          }

          return (
            <div
              key={plan.id}
              style={{
                background: "#ffffff",
                border: plan.highlight
                  ? "2px solid #008060"
                  : isCurrent
                  ? "2px solid #10b981"
                  : "1px solid #e2e8f0",
                borderRadius: "16px",
                padding: "26px 22px 22px",
                boxShadow: plan.highlight
                  ? "0 12px 30px rgba(0, 128, 96, 0.15)"
                  : "0 2px 10px rgba(0,0,0,0.04)",
                position: "relative",
                display: "flex",
                flexDirection: "column",
                justifyContent: "space-between",
                transform: plan.highlight ? "scale(1.02)" : "none",
                transition: "all 0.2s ease",
              }}
            >
              {plan.badge && (
                <div
                  style={{
                    position: "absolute",
                    top: "-12px",
                    right: "20px",
                    background: plan.highlight ? "#008060" : "#7c3aed",
                    color: "#ffffff",
                    padding: "3px 10px",
                    borderRadius: "10px",
                    fontSize: "11px",
                    fontWeight: "800",
                    letterSpacing: "0.5px",
                    boxShadow: "0 2px 6px rgba(0,0,0,0.2)",
                  }}
                >
                  {plan.badge}
                </div>
              )}
              {isCurrent && !plan.badge && (
                <div
                  style={{
                    position: "absolute",
                    top: "-12px",
                    right: "20px",
                    background: "#10b981",
                    color: "#ffffff",
                    padding: "3px 10px",
                    borderRadius: "10px",
                    fontSize: "11px",
                    fontWeight: "800",
                    letterSpacing: "0.5px",
                  }}
                >
                  CURRENT ACTIVE PLAN
                </div>
              )}

              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "4px" }}>
                  <h3 style={{ margin: 0, fontSize: "19px", fontWeight: "800", color: "#0f172a" }}>
                    {plan.name}
                  </h3>
                  <span style={{ fontSize: "11px", background: "#f1f5f9", color: "#475569", padding: "2px 8px", borderRadius: "10px", fontWeight: "600" }}>
                    {plan.trialBadge}
                  </span>
                </div>

                <p style={{ margin: "0 0 16px", color: "#64748b", fontSize: "13px", lineHeight: "1.4", minHeight: "36px" }}>
                  {plan.description}
                </p>

                <div style={{ display: "flex", alignItems: "baseline", gap: "4px", marginBottom: "4px" }}>
                  <span style={{ fontSize: "34px", fontWeight: "800", color: "#0f172a", letterSpacing: "-1px" }}>
                    {displayPrice}
                  </span>
                  <span style={{ fontSize: "13px", color: "#64748b", fontWeight: "500" }}>
                    / {plan.period}
                  </span>
                </div>

                <div style={{ fontSize: "11px", color: "#059669", fontWeight: "600", minHeight: "16px", marginBottom: "8px" }}>
                  {billingCycle === "annual" && plan.priceAnnualNote ? plan.priceAnnualNote : " "}
                </div>

                <div style={{ minHeight: "28px", marginBottom: "14px" }}>
                  {plan.dailyCost ? (
                    <div style={{ fontSize: "11px", color: "#047857", fontWeight: "700", background: "#ecfdf5", border: "1px solid #a7f3d0", padding: "4px 8px", borderRadius: "6px", display: "inline-block", lineHeight: "1.3" }}>
                      {plan.dailyCost}
                    </div>
                  ) : (
                    <div style={{ fontSize: "11px", color: "#64748b", fontWeight: "600", padding: "4px 0" }}>
                      100% Risk-Free Starter Plan
                    </div>
                  )}
                </div>

                <div style={{ display: "inline-block", background: "#f1f5f9", color: "#334155", padding: "5px 10px", borderRadius: "8px", fontSize: "12px", fontWeight: "700", marginBottom: "18px" }}>
                  {plan.recordsLimit}
                </div>

                {/* Action CTA Button */}
                <PlanCardForm
                  plan={plan}
                  billingCycle={billingCycle}
                  isCurrent={isCurrent}
                  activePlan={activePlan}
                  buttonLabel={buttonLabel}
                />

                <div style={{ height: "1px", background: "#f1f5f9", margin: "18px 0 16px" }} />

                {/* Features list */}
                <div style={{ display: "flex", flexDirection: "column", gap: "9px" }}>
                  <span style={{ fontSize: "11px", fontWeight: "800", color: "#64748b", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                    Included Capabilities:
                  </span>
                  {plan.features.map((feat, i) => (
                    <div key={i} style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "13px", color: "#1e293b" }}>
                      <span style={{ color: "#008060", fontWeight: "800", fontSize: "14px" }}>•</span>
                      <span>{feat}</span>
                    </div>
                  ))}
                  {plan.disabledFeatures.map((feat, i) => (
                    <div key={`d-${i}`} style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "13px", color: "#94a3b8" }}>
                      <span style={{ color: "#cbd5e1", fontSize: "14px" }}>•</span>
                      <span style={{ textDecoration: "line-through" }}>{feat}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Enterprise Custom Solutions - Clean & Simple Light Card */}
      <div style={{
        background: "#ffffff",
        border: "1px solid #e2e8f0",
        borderRadius: "14px",
        padding: "24px 28px",
        marginBottom: "36px",
        boxShadow: "0 1px 4px rgba(0, 0, 0, 0.04)",
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        flexWrap: "wrap",
        gap: "20px",
      }}>
        <div style={{ maxWidth: "740px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px", flexWrap: "wrap" }}>
            <span style={{
              background: "#eff6ff",
              color: "#2563eb",
              border: "1px solid #bfdbfe",
              padding: "3px 9px",
              borderRadius: "6px",
              fontSize: "11px",
              fontWeight: "700",
              textTransform: "uppercase",
              letterSpacing: "0.5px",
            }}>
              High-Volume Auto Enterprise & Distributors ($200+ / mo)
            </span>
            <span style={{
              background: "#f0fdf4",
              color: "#166534",
              border: "1px solid #bbf7d0",
              padding: "3px 8px",
              borderRadius: "6px",
              fontSize: "11px",
              fontWeight: "600",
            }}>
              ✓ Available on Any Active Plan
            </span>
          </div>

          <h2 style={{ fontSize: "18px", fontWeight: "700", margin: "0 0 6px", color: "#0f172a" }}>
            Need ACES 3.2 / 4.0 XML, SEMA Data Co-op (SDC), or Automated SFTP Sync?
          </h2>

          <p style={{ margin: "0 0 10px", fontSize: "13px", color: "#475569", lineHeight: "1.5" }}>
            Custom fitment database scale for 100,000 to 1,000,000+ SKUs. Includes automated daily SFTP catalog ingestion, distributor feeds (SEMA Data Co-op & WHI Nexpart), and a dedicated automotive catalog engineer.
          </p>

          <div style={{ display: "flex", gap: "16px", flexWrap: "wrap", fontSize: "12px", color: "#64748b", fontWeight: "500" }}>
            <span>• ACES 3.2 & 4.0 Standard XML</span>
            <span>• PIES 7.2 Product Data Feeds</span>
            <span>• Automated SFTP / FTP Ingestion</span>
            <span>• Dedicated Catalog Engineer</span>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "6px", minWidth: "220px", flexShrink: 0 }}>
          <button
            type="button"
            onClick={() => openQuoteModal("enterprise", 100000)}
            style={{
              background: "#4f46e5",
              color: "#ffffff",
              padding: "11px 20px",
              borderRadius: "8px",
              fontWeight: "600",
              fontSize: "13px",
              textAlign: "center",
              border: "none",
              cursor: "pointer",
              boxShadow: "0 1px 3px rgba(79, 70, 229, 0.25)",
              transition: "background 0.15s ease",
            }}
          >
            {pendingQuote && pendingQuote.status === "PENDING"
              ? "Review / Edit Quote Request →"
              : "Request Enterprise Quote →"}
          </button>
          <div style={{ textAlign: "center", fontSize: "12px", color: "#64748b" }}>
            {pendingQuote && pendingQuote.status === "PENDING" ? (
              <span style={{ color: "#2563eb", fontWeight: "600" }}>
                ✓ Request #{pendingQuote.id} under review
              </span>
            ) : (
              <span>Zero disruption to active plan • Free quote</span>
            )}
          </div>
        </div>
      </div>

      {/* Comprehensive Feature Comparison Matrix (4 Plans) */}
      <div style={{ background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: "16px", padding: "28px", marginBottom: "40px", boxShadow: "0 4px 16px rgba(0,0,0,0.03)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "12px", marginBottom: "24px" }}>
          <div>
            <h2 style={{ margin: "0 0 4px", fontSize: "22px", fontWeight: "800", color: "#0f172a" }}>
              Comprehensive Feature Comparison Matrix
            </h2>
            <p style={{ margin: 0, color: "#64748b", fontSize: "14px" }}>
              Detailed breakdown of features, limits, data standards, and support options across all 4 plans.
            </p>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "12px", color: "#475569" }}>
            <span style={{ width: "10px", height: "10px", borderRadius: "50%", background: "#10b981", display: "inline-block" }}></span>
            <span>Your current active plan is highlighted below</span>
          </div>
        </div>

        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left", fontSize: "13px" }}>
            <thead>
              <tr style={{ borderBottom: "2px solid #cbd5e1", background: "#f8fafc" }}>
                <th style={{ padding: "14px", width: "28%", color: "#334155", fontWeight: "800", fontSize: "13px" }}>
                  Feature Specification
                </th>

                {/* Starter Free Header */}
                <th style={{
                  padding: "14px 10px",
                  textAlign: "center",
                  width: "18%",
                  background: activePlan === "free" ? "#f0fdf4" : "transparent",
                  borderLeft: activePlan === "free" ? "2px solid #10b981" : "none",
                  borderRight: activePlan === "free" ? "2px solid #10b981" : "none",
                  borderTop: activePlan === "free" ? "3px solid #10b981" : "none",
                }}>
                  {activePlan === "free" && (
                    <div style={{ background: "#10b981", color: "#ffffff", padding: "2px 6px", borderRadius: "8px", fontSize: "9px", fontWeight: "800", textTransform: "uppercase", marginBottom: "4px", display: "inline-block" }}>
                      ACTIVE PLAN
                    </div>
                  )}
                  <div style={{ fontWeight: "800", color: "#0f172a", fontSize: "15px" }}>Starter Free</div>
                  <div style={{ fontSize: "12px", color: "#64748b", fontWeight: "500", marginTop: "2px" }}>$0 / month</div>
                </th>

                {/* Starter Pro Header */}
                <th style={{
                  padding: "14px 10px",
                  textAlign: "center",
                  width: "18%",
                  background: activePlan === "starter" ? "#f0fdf4" : "transparent",
                  borderLeft: activePlan === "starter" ? "2px solid #10b981" : "none",
                  borderRight: activePlan === "starter" ? "2px solid #10b981" : "none",
                  borderTop: activePlan === "starter" ? "3px solid #10b981" : "none",
                }}>
                  {activePlan === "starter" && (
                    <div style={{ background: "#10b981", color: "#ffffff", padding: "2px 6px", borderRadius: "8px", fontSize: "9px", fontWeight: "800", textTransform: "uppercase", marginBottom: "4px", display: "inline-block" }}>
                      ACTIVE PLAN
                    </div>
                  )}
                  <div style={{ fontWeight: "800", color: "#0f172a", fontSize: "15px" }}>Starter Pro</div>
                  <div style={{ fontSize: "12px", color: "#64748b", fontWeight: "500", marginTop: "2px" }}>
                    {billingCycle === "annual" ? `${calcAnnualMonthlyEq(19.0)} / mo` : `${calcMonthly(19.0)} / mo`}
                  </div>
                </th>

                {/* Growth Pro Header */}
                <th style={{
                  padding: "14px 10px",
                  textAlign: "center",
                  width: "18%",
                  background: activePlan === "growth" ? "#ecfdf5" : "#f0fdf4",
                  borderLeft: activePlan === "growth" ? "2px solid #10b981" : "none",
                  borderRight: activePlan === "growth" ? "2px solid #10b981" : "none",
                  borderTop: activePlan === "growth" ? "3px solid #10b981" : "none",
                }}>
                  {activePlan === "growth" && (
                    <div style={{ background: "#10b981", color: "#ffffff", padding: "2px 6px", borderRadius: "8px", fontSize: "9px", fontWeight: "800", textTransform: "uppercase", marginBottom: "4px", display: "inline-block" }}>
                      ACTIVE PLAN
                    </div>
                  )}
                  <div style={{ fontWeight: "800", color: "#0f172a", fontSize: "15px" }}>Growth Pro</div>
                  <div style={{ fontSize: "12px", color: "#008060", fontWeight: "700", marginTop: "2px" }}>
                    {isVipFreeOfferActive
                      ? `$0.00 (${vipFreeOfferMonths} Mo Free)`
                      : billingCycle === "annual"
                      ? `${calcAnnualMonthlyEq(49.0)} / mo`
                      : `${calcMonthly(49.0)} / mo`}
                  </div>
                </th>

                {/* Enterprise Header */}
                <th style={{
                  padding: "14px 10px",
                  textAlign: "center",
                  width: "18%",
                  background: activePlan === "enterprise" ? "#f0fdf4" : "transparent",
                  borderLeft: activePlan === "enterprise" ? "2px solid #10b981" : "none",
                  borderRight: activePlan === "enterprise" ? "2px solid #10b981" : "none",
                  borderTop: activePlan === "enterprise" ? "3px solid #10b981" : "none",
                }}>
                  {activePlan === "enterprise" && (
                    <div style={{ background: "#10b981", color: "#ffffff", padding: "2px 6px", borderRadius: "8px", fontSize: "9px", fontWeight: "800", textTransform: "uppercase", marginBottom: "4px", display: "inline-block" }}>
                      ACTIVE PLAN
                    </div>
                  )}
                  <div style={{ fontWeight: "800", color: "#0f172a", fontSize: "15px" }}>Enterprise Unlimited</div>
                  <div style={{ fontSize: "12px", color: "#64748b", fontWeight: "500", marginTop: "2px" }}>
                    {billingCycle === "annual" ? `${calcAnnualMonthlyEq(99.0)} / mo` : `${calcMonthly(99.0)} / mo`}
                  </div>
                </th>
              </tr>
            </thead>

            <tbody>
              {matrixGroups.map((group, gIdx) => (
                <MatrixGroupSection
                  key={gIdx}
                  group={group}
                  activePlan={activePlan}
                />
              ))}

              {/* Bottom CTA Row in Matrix */}
              <tr style={{ background: "#f8fafc", borderTop: "2px solid #cbd5e1" }}>
                <td style={{ padding: "16px 14px", fontWeight: "800", color: "#0f172a" }}>
                  Select Plan
                </td>

                {/* Free CTA */}
                <td style={{ padding: "12px", textAlign: "center", background: activePlan === "free" ? "#f0fdf4" : "transparent" }}>
                  <PlanCardForm
                    plan={plans[0]}
                    billingCycle={billingCycle}
                    isCurrent={activePlan === "free"}
                    activePlan={activePlan}
                    buttonLabel={activePlan === "free" ? "Active Plan" : "Free"}
                  />
                </td>

                {/* Starter CTA */}
                <td style={{ padding: "12px", textAlign: "center", background: activePlan === "starter" ? "#f0fdf4" : "transparent" }}>
                  <PlanCardForm
                    plan={plans[1]}
                    billingCycle={billingCycle}
                    isCurrent={activePlan === "starter" && billingCycle === (activeBillingCycle || "monthly")}
                    activePlan={activePlan}
                    buttonLabel={
                      activePlan === "starter" && billingCycle === (activeBillingCycle || "monthly")
                        ? "Active Plan"
                        : "Starter $19 →"
                    }
                  />
                </td>

                {/* Growth CTA */}
                <td style={{ padding: "12px", textAlign: "center", background: activePlan === "growth" ? "#ecfdf5" : "transparent" }}>
                  <PlanCardForm
                    plan={plans[2]}
                    billingCycle={billingCycle}
                    isCurrent={activePlan === "growth" && billingCycle === (activeBillingCycle || "monthly")}
                    activePlan={activePlan}
                    buttonLabel={
                      activePlan === "growth" && billingCycle === (activeBillingCycle || "monthly")
                        ? "Active Plan"
                        : "Growth $49 →"
                    }
                  />
                </td>

                {/* Enterprise CTA */}
                <td style={{ padding: "12px", textAlign: "center", background: activePlan === "enterprise" ? "#f0fdf4" : "transparent" }}>
                  <PlanCardForm
                    plan={plans[3]}
                    billingCycle={billingCycle}
                    isCurrent={activePlan === "enterprise" && billingCycle === (activeBillingCycle || "monthly")}
                    activePlan={activePlan}
                    buttonLabel={
                      activePlan === "enterprise" && billingCycle === (activeBillingCycle || "monthly")
                        ? "Active Plan"
                        : "Enterprise $99 →"
                    }
                  />
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* Quote Request Modal */}
      {quoteModalOpen && (
        <div style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: "rgba(15, 23, 42, 0.75)",
          backdropFilter: "blur(6px)",
          zIndex: 9999,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "20px",
        }}>
          <div style={{
            background: "#ffffff",
            borderRadius: "20px",
            maxWidth: "640px",
            width: "100%",
            padding: "32px",
            boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.25), 0 10px 20px -5px rgba(0, 0, 0, 0.1)",
            position: "relative",
            maxHeight: "92vh",
            overflowY: "auto",
            border: "1px solid #e2e8f0",
          }}>
            {/* Modal Header */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "18px" }}>
              <div>
                <span style={{ background: "linear-gradient(135deg, #ede9fe 0%, #e0e7ff 100%)", color: "#4f46e5", padding: "4px 10px", borderRadius: "6px", fontSize: "11px", fontWeight: "800", textTransform: "uppercase", letterSpacing: "0.6px" }}>
                  CUSTOM CATALOG SCALE & ENTERPRISE
                </span>
                <h3 style={{ margin: "8px 0 4px", fontSize: "20px", fontWeight: "800", color: "#0f172a", letterSpacing: "-0.3px" }}>
                  {quoteId ? "Review & Update Quote Request" : "Request Enterprise Custom Quote"}
                </h3>
                <p style={{ margin: 0, fontSize: "13px", color: "#64748b", lineHeight: "1.5" }}>
                  Scale your fitment database beyond standard limits with custom XML/SFTP feeds and dedicated automotive catalog engineering.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setQuoteModalOpen(false)}
                style={{ background: "#f1f5f9", border: "none", borderRadius: "50%", width: "32px", height: "32px", cursor: "pointer", fontSize: "18px", fontWeight: "bold", color: "#64748b", display: "flex", alignItems: "center", justifyContent: "center" }}
              >
                ×
              </button>
            </div>

            {/* Merchant Reassurance Guarantee */}
            <div style={{
              background: "linear-gradient(135deg, #f0fdf4 0%, #ecfdf5 100%)",
              border: "1px solid #a7f3d0",
              borderRadius: "12px",
              padding: "13px 16px",
              marginBottom: "20px",
              display: "flex",
              gap: "12px",
              alignItems: "flex-start",
            }}>
              <span style={{ fontSize: "20px", lineHeight: "1" }}>🛡️</span>
              <div style={{ fontSize: "12px", color: "#065f46", lineHeight: "1.5" }}>
                <strong>Risk-Free Merchant Guarantee:</strong> Submitting this quote will <strong>never cancel, downgrade, or disrupt</strong> your live active plan (<strong>{activePlan ? activePlan.toUpperCase() : "ACTIVE"}</strong>). Your store continues operating smoothly while our team prepares a personalized proposal.
                <div style={{ marginTop: "6px", color: "#047857", display: "flex", gap: "14px", flexWrap: "wrap", fontSize: "11px", fontWeight: "700" }}>
                  <span>🏪 Store: {shop}</span>
                  <span>🚗 Catalog Size: {fitmentCount.toLocaleString()} records</span>
                </div>
              </div>
            </div>

            <quoteFetcher.Form method="post" onSubmit={() => setQuoteModalOpen(false)}>
              <input type="hidden" name="intent" value="submitQuoteRequest" />
              {quoteId && <input type="hidden" name="quoteId" value={quoteId} />}
              <input
                type="hidden"
                name="dataRequirements"
                value={[...selectedRequirements, ...(customIntegration.trim() ? [customIntegration.trim()] : [])].join(", ")}
              />

              {/* Target Plan Tier */}
              <div style={{ marginBottom: "18px" }}>
                <label htmlFor="quote-target-plan" style={{ display: "block", fontSize: "13px", fontWeight: "700", color: "#1e293b", marginBottom: "6px" }}>
                  Target Plan Tier
                </label>
                <select
                  id="quote-target-plan"
                  name="requestedPlan"
                  value={quoteTargetPlan}
                  onChange={(e) => setQuoteTargetPlan(e.target.value)}
                  style={{ width: "100%", padding: "10px 12px", borderRadius: "8px", border: "1px solid #cbd5e1", fontSize: "13px", background: "#ffffff", fontWeight: "600", color: "#0f172a" }}
                >
                  <option value="enterprise">Enterprise Custom (ACES/PIES 3.2 XML, Daily SFTP, SEMA Data Co-op, 100k+ to 1M+ SKUs)</option>
                  <option value="growth">Growth Pro Custom (Garage Sync, 250+ VIN lookups, Sub-model Filtering, 20k-75k SKUs)</option>
                  <option value="starter">Starter Pro Custom (Storefront Fitment, Standard CSV, 5k-20k SKUs)</option>
                </select>
              </div>

              {/* Requested Fitments */}
              <div style={{ marginBottom: "18px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
                  <label htmlFor="quote-fitments-input" style={{ fontSize: "13px", fontWeight: "700", color: "#1e293b" }}>
                    Required Fitment Record Quota
                  </label>
                  <span style={{ fontSize: "12px", color: "#6366f1", fontWeight: "700" }}>
                    {quoteFitments.toLocaleString()} Records Selected
                  </span>
                </div>
                <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", marginBottom: "8px" }}>
                  {[25000, 50000, 100000, 250000, 500000, 1000000].map((num) => (
                    <button
                      key={num}
                      type="button"
                      onClick={() => setQuoteFitments(num)}
                      style={{
                        background: quoteFitments === num ? "#1e1b4b" : "#f1f5f9",
                        color: quoteFitments === num ? "#ffffff" : "#475569",
                        border: `1px solid ${quoteFitments === num ? "#4338ca" : "#e2e8f0"}`,
                        padding: "6px 12px",
                        borderRadius: "6px",
                        fontSize: "12px",
                        fontWeight: "700",
                        cursor: "pointer",
                        transition: "all 0.15s ease",
                      }}
                    >
                      {num >= 1000000 ? "1M+ Records" : `${(num / 1000).toFixed(0)}k Records`}
                    </button>
                  ))}
                </div>
                <input
                  id="quote-fitments-input"
                  type="number"
                  name="requestedFitments"
                  value={quoteFitments}
                  onChange={(e) => setQuoteFitments(parseInt(e.target.value, 10) || 0)}
                  placeholder="e.g. 100000"
                  style={{ width: "100%", padding: "10px 12px", borderRadius: "8px", border: "1px solid #cbd5e1", fontSize: "13px", boxSizing: "border-box" }}
                />
              </div>

              {/* Automotive Data Standards & Integrations */}
              <div style={{ marginBottom: "18px" }}>
                <div style={{ fontSize: "13px", fontWeight: "700", color: "#1e293b", marginBottom: "4px" }}>
                  Automotive Data Feeds & Integrations (Click to select)
                </div>
                <p style={{ margin: "0 0 8px", fontSize: "12px", color: "#64748b" }}>
                  Select the automotive standards and distributor connections your catalog requires:
                </p>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", marginBottom: "10px" }}>
                  {availableRequirements.map((item) => {
                    const isSelected = selectedRequirements.includes(item.label);
                    return (
                      <button
                        key={item.label}
                        type="button"
                        onClick={() => toggleRequirement(item.label)}
                        title={item.hint}
                        style={{
                          background: isSelected ? "#e0e7ff" : "#f8fafc",
                          border: `1px solid ${isSelected ? "#6366f1" : "#cbd5e1"}`,
                          color: isSelected ? "#3730a3" : "#334155",
                          padding: "6px 12px",
                          borderRadius: "8px",
                          fontSize: "12px",
                          fontWeight: isSelected ? "700" : "500",
                          cursor: "pointer",
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "6px",
                          transition: "all 0.15s ease",
                        }}
                      >
                        <span style={{ fontSize: "13px", fontWeight: "800", color: isSelected ? "#4f46e5" : "#94a3b8" }}>
                          {isSelected ? "✓" : "+"}
                        </span>
                        <span>{item.label}</span>
                      </button>
                    );
                  })}
                </div>
                <input
                  type="text"
                  value={customIntegration}
                  onChange={(e) => setCustomIntegration(e.target.value)}
                  placeholder="Other supplier / warehouse feed (e.g. Turn14, Meyer, Keystone, Quadratec, SAP)..."
                  style={{ width: "100%", padding: "9px 12px", borderRadius: "8px", border: "1px solid #cbd5e1", fontSize: "12px", boxSizing: "border-box" }}
                />
              </div>

              {/* Budget & Contact */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", marginBottom: "18px" }}>
                <div>
                  <label htmlFor="quote-monthly-budget" style={{ display: "block", fontSize: "13px", fontWeight: "700", color: "#1e293b", marginBottom: "6px" }}>
                    Monthly Budget ($ USD, Optional)
                  </label>
                  <input
                    id="quote-monthly-budget"
                    type="number"
                    name="monthlyBudget"
                    value={quoteBudget}
                    onChange={(e) => setQuoteBudget(e.target.value)}
                    placeholder="e.g. 199"
                    style={{ width: "100%", padding: "10px 12px", borderRadius: "8px", border: "1px solid #cbd5e1", fontSize: "13px", boxSizing: "border-box" }}
                  />
                </div>
                <div>
                  <label htmlFor="quote-contact-email" style={{ display: "block", fontSize: "13px", fontWeight: "700", color: "#1e293b", marginBottom: "6px" }}>
                    Contact Email
                  </label>
                  <input
                    id="quote-contact-email"
                    type="email"
                    name="contactEmail"
                    value={quoteEmail}
                    onChange={(e) => setQuoteEmail(e.target.value)}
                    placeholder="billing@yourstore.com"
                    required
                    style={{ width: "100%", padding: "10px 12px", borderRadius: "8px", border: "1px solid #cbd5e1", fontSize: "13px", boxSizing: "border-box" }}
                  />
                </div>
              </div>

              {/* Additional Notes */}
              <div style={{ marginBottom: "24px" }}>
                <label htmlFor="quote-catalog-notes" style={{ display: "block", fontSize: "13px", fontWeight: "700", color: "#1e293b", marginBottom: "6px" }}>
                  Catalog Notes & Brand Fitments (Optional)
                </label>
                <textarea
                  id="quote-catalog-notes"
                  name="notes"
                  rows={3}
                  value={quoteNotes}
                  onChange={(e) => setQuoteNotes(e.target.value)}
                  placeholder="Share details about your vehicle part types, suppliers, CSV structure, or catalog update frequency..."
                  style={{ width: "100%", padding: "10px 12px", borderRadius: "8px", border: "1px solid #cbd5e1", fontSize: "13px", boxSizing: "border-box" }}
                />
              </div>

              {/* Footer Actions */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "12px", borderTop: "1px solid #f1f5f9", paddingTop: "18px" }}>
                <div style={{ fontSize: "12px", color: "#64748b" }}>
                  ⚡ Engineering response within 24 business hours
                </div>
                <div style={{ display: "flex", gap: "10px" }}>
                  <button
                    type="button"
                    onClick={() => setQuoteModalOpen(false)}
                    style={{ background: "#ffffff", border: "1px solid #cbd5e1", padding: "10px 18px", borderRadius: "8px", fontSize: "13px", fontWeight: "600", cursor: "pointer", color: "#475569" }}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isSubmittingQuote}
                    style={{
                      background: "linear-gradient(135deg, #4338ca 0%, #312e81 100%)",
                      color: "#ffffff",
                      border: "none",
                      padding: "10px 24px",
                      borderRadius: "8px",
                      fontSize: "13px",
                      fontWeight: "700",
                      cursor: isSubmittingQuote ? "not-allowed" : "pointer",
                      opacity: isSubmittingQuote ? 0.7 : 1,
                      boxShadow: "0 4px 12px rgba(67, 56, 202, 0.35)",
                    }}
                  >
                    {isSubmittingQuote
                      ? "Submitting Quote..."
                      : quoteId
                        ? "Update Quote Request →"
                        : "Submit Enterprise Request (Free & No Obligation) →"}
                  </button>
                </div>
              </div>
            </quoteFetcher.Form>
          </div>
        </div>
      )}
    </div>
  );
}

function MatrixGroupSection({ group, activePlan }) {
  return (
    <>
      {/* Category Section Header */}
      <tr style={{ background: "#f1f5f9", borderBottom: "1px solid #cbd5e1" }}>
        <td
          colSpan={5}
          style={{
            padding: "8px 14px",
            fontWeight: "800",
            fontSize: "11px",
            color: "#334155",
            textTransform: "uppercase",
            letterSpacing: "0.8px",
          }}
        >
          {group.category}
        </td>
      </tr>

      {/* Category Rows */}
      {group.rows.map((row, rIdx) => (
        <tr
          key={rIdx}
          style={{
            borderBottom: "1px solid #f1f5f9",
            background: "#ffffff",
          }}
        >
          <td style={{ padding: "12px 14px", fontWeight: "700", color: "#0f172a" }}>
            {row.name}
          </td>

          {/* Starter Free Cell */}
          <td
            style={{
              padding: "12px 14px",
              textAlign: "center",
              color: row.free === "✕" ? "#cbd5e1" : "#334155",
              fontWeight: row.free.startsWith("✓") ? "700" : "500",
              background: activePlan === "free" ? "#f0fdf4" : "transparent",
              borderLeft: activePlan === "free" ? "2px solid #10b981" : "none",
              borderRight: activePlan === "free" ? "2px solid #10b981" : "none",
            }}
          >
            {formatMatrixCell(row.free)}
          </td>

          {/* Starter Pro Cell */}
          <td
            style={{
              padding: "12px 14px",
              textAlign: "center",
              color: row.starter === "✕" ? "#cbd5e1" : "#334155",
              fontWeight: row.starter.startsWith("✓") ? "700" : "500",
              background: activePlan === "starter" ? "#f0fdf4" : "transparent",
              borderLeft: activePlan === "starter" ? "2px solid #10b981" : "none",
              borderRight: activePlan === "starter" ? "2px solid #10b981" : "none",
            }}
          >
            {formatMatrixCell(row.starter)}
          </td>

          {/* Growth Pro Cell */}
          <td
            style={{
              padding: "12px 14px",
              textAlign: "center",
              fontWeight: row.growth.startsWith("✓") ? "800" : "600",
              color: row.growth.startsWith("✓") ? "#047857" : (row.growth === "✕" ? "#cbd5e1" : "#0f172a"),
              background: activePlan === "growth" ? "#ecfdf5" : "#f8fafc",
              borderLeft: activePlan === "growth" ? "2px solid #10b981" : "none",
              borderRight: activePlan === "growth" ? "2px solid #10b981" : "none",
            }}
          >
            {formatMatrixCell(row.growth)}
          </td>

          {/* Enterprise Cell */}
          <td
            style={{
              padding: "12px 14px",
              textAlign: "center",
              fontWeight: row.enterprise.startsWith("✓") ? "800" : "600",
              color: row.enterprise.startsWith("✓") ? "#047857" : (row.enterprise === "✕" ? "#cbd5e1" : "#0f172a"),
              background: activePlan === "enterprise" ? "#f0fdf4" : "transparent",
              borderLeft: activePlan === "enterprise" ? "2px solid #10b981" : "none",
              borderRight: activePlan === "enterprise" ? "2px solid #10b981" : "none",
            }}
          >
            {formatMatrixCell(row.enterprise)}
          </td>
        </tr>
      ))}
    </>
  );
}

function formatMatrixCell(text) {
  if (text === "✕") {
    return <span style={{ color: "#cbd5e1", fontSize: "16px" }}>✕</span>;
  }
  if (text.startsWith("✓")) {
    return (
      <span style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}>
        <span style={{ color: "#10b981", fontWeight: "800" }}>✓</span>
        <span>{text.replace(/^✓\s*/, "")}</span>
      </span>
    );
  }
  return text;
}

function PlanCardForm({ plan, billingCycle, isCurrent, activePlan, buttonLabel }) {
  const fetcher = useFetcher();
  const isCardSubmitting = fetcher.state !== "idle";

  return (
    <fetcher.Form method="post" style={{ margin: 0 }}>
      <input type="hidden" name="intent" value="selectPlan" />
      <input type="hidden" name="plan" value={plan.id} />
      <input type="hidden" name="billingCycle" value={billingCycle} />
      <button
        type="submit"
        disabled={isCurrent || isCardSubmitting}
        style={{
          width: "100%",
          padding: "11px 14px",
          borderRadius: "10px",
          border: plan.highlight || (!isCurrent && activePlan === plan.id) ? "none" : "1px solid #cbd5e1",
          background: isCurrent ? "#f1f5f9" : (plan.highlight || activePlan === plan.id) ? "#008060" : "#ffffff",
          color: isCurrent ? "#94a3b8" : (plan.highlight || activePlan === plan.id) ? "#ffffff" : "#1e293b",
          fontSize: "13px",
          fontWeight: "700",
          cursor: isCurrent || isCardSubmitting ? "default" : "pointer",
          boxShadow: !isCurrent && (plan.highlight || activePlan === plan.id) ? "0 4px 12px rgba(0, 128, 96, 0.25)" : "none",
          transition: "all 0.2s",
          opacity: isCardSubmitting ? 0.7 : 1,
        }}
      >
        {isCardSubmitting ? "Activating Plan..." : buttonLabel}
      </button>
    </fetcher.Form>
  );
}
