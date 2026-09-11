/**
 * Canonical shop domain normalization utility.
 * Ensures consistent handling of Shopify myshopify.com domains across the app,
 * preventing duplicate store entries in database tables and admin views.
 */

export function normalizeShopDomain(shop) {
  if (!shop || typeof shop !== "string") return "";
  let cleaned = shop.trim().toLowerCase();
  
  // Preserve reserved global identifier
  if (cleaned === "__global__") return "__GLOBAL__";

  // Remove protocol and trailing paths if passed accidentally
  cleaned = cleaned.replace(/^https?:\/\//i, "").replace(/\/.*$/, "").trim();

  if (!cleaned) return "";

  // If already a fully-qualified domain, return it
  if (cleaned.includes(".")) {
    return cleaned;
  }

  // If just the store handle/subdomain was passed, append .myshopify.com
  return `${cleaned}.myshopify.com`;
}
