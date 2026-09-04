import "@shopify/shopify-app-react-router/adapters/node";
import {
  ApiVersion,
  AppDistribution,
  BillingInterval,
  shopifyApp,
} from "@shopify/shopify-app-react-router/server";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import prisma from "./db.server";

const shopify = shopifyApp({
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET || "",
  apiVersion: ApiVersion.July26,
  scopes: process.env.SCOPES?.split(","),
  appUrl: process.env.SHOPIFY_APP_URL || "",
  authPathPrefix: "/auth",
  sessionStorage: new PrismaSessionStorage(prisma),
  distribution: AppDistribution.AppStore,
  billing: {
    starter_monthly: {
      trialDays: 14,
      lineItems: [{ amount: 19.0, currencyCode: "USD", interval: BillingInterval.Every30Days }],
    },
    starter_annual: {
      trialDays: 14,
      lineItems: [{ amount: 182.4, currencyCode: "USD", interval: BillingInterval.Annual }],
    },
    growth_monthly: {
      trialDays: 14,
      lineItems: [{ amount: 49.0, currencyCode: "USD", interval: BillingInterval.Every30Days }],
    },
    growth_annual: {
      trialDays: 14,
      lineItems: [{ amount: 470.4, currencyCode: "USD", interval: BillingInterval.Annual }],
    },
    enterprise_monthly: {
      trialDays: 14,
      lineItems: [{ amount: 99.0, currencyCode: "USD", interval: BillingInterval.Every30Days }],
    },
    enterprise_annual: {
      trialDays: 14,
      lineItems: [{ amount: 950.4, currencyCode: "USD", interval: BillingInterval.Annual }],
    },
  },
  future: {
    expiringOfflineAccessTokens: true,
  },
  ...(process.env.SHOP_CUSTOM_DOMAIN
    ? { customShopDomains: [process.env.SHOP_CUSTOM_DOMAIN] }
    : {}),
});

export default shopify;
export const apiVersion = ApiVersion.July26;
export const addDocumentResponseHeaders = shopify.addDocumentResponseHeaders;
export const authenticate = shopify.authenticate;
export const unauthenticated = shopify.unauthenticated;
export const login = shopify.login;
export const registerWebhooks = shopify.registerWebhooks;
export const sessionStorage = shopify.sessionStorage;
