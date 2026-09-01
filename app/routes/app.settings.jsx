const json = (data, init) => Response.json(data, init);
import { useState, useEffect } from "react";
import { useLoaderData, Form, useNavigation, useActionData, Link } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { getShopPlan, planLimits } from "../plans.server";

const DEFAULT_SETTINGS = {
  requireYear: true,
  requireAllFields: true,
  logNoResults: true,
  includeUniversal: true,
  redirectOnSearch: true,
  resultsUrl: "/collections/all",
  persistSelection: true,
  enableGarage: true,
  showFitmentChecker: true,
};

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  // eslint-disable-next-line no-undef
  const adminEmail = process.env.ADMIN_EMAIL || "sandeepptpss@gmail.com";
  // eslint-disable-next-line no-undef
  const adminStore = process.env.ADMIN_STORE_NAME || "quickstart-749ac396";
  const sessionEmail = session.email || adminEmail;
  const isAdmin =
    shop.includes(adminStore) ||
    shop.includes("quickstart-749ac396") ||
    sessionEmail.includes("sandeepptpss") ||
    sessionEmail === adminEmail;

  let settings = null;
  try {
    settings = await prisma.appSettings.findUnique({
      where: { shop },
    });
    if (!settings) {
      settings = await prisma.appSettings.create({
        data: { shop, ...DEFAULT_SETTINGS },
      });
    }
  } catch (err) {
    console.error("[settings loader error]", err);
  }

  const { plan } = await getShopPlan(shop);
  const limits = planLimits(plan);

  return json({
    shop,
    settings: settings || DEFAULT_SETTINGS,
    planAllowsFitmentChecker: limits.fitmentChecker,
    planLabel: limits.label,
    isAdmin,
  });
};

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();

  const { plan } = await getShopPlan(shop);
  const limits = planLimits(plan);

  const redirectOnSearch = formData.get("redirect_on_search") === "true";
  const resultsUrl = formData.get("results_url")?.toString() || "/collections/all";

  const data = {
    requireYear: formData.get("require_year") === "true",
    requireAllFields: formData.get("require_all_fields") === "true",
    logNoResults: formData.get("log_no_results") === "true",
    includeUniversal: formData.get("include_universal") === "true",
    redirectOnSearch,
    resultsUrl,
    persistSelection: formData.get("persist_selection") === "true",
    enableGarage: formData.get("enable_garage") === "true",
    showFitmentChecker: formData.get("show_fitment_checker") === "true" && limits.fitmentChecker,
  };

  let savedSettings = null;
  try {
    savedSettings = await prisma.appSettings.upsert({
      where: { shop },
      update: data,
      create: { shop, ...data },
    });
  } catch (err) {
    console.error("[settings action error]", err);
  }

  return json({ saved: true, settings: savedSettings });
};

export default function Settings() {
  const { shop, settings, planAllowsFitmentChecker, planLabel } = useLoaderData();
  const actionData = useActionData();
  const navigation = useNavigation();

  const isSaving = navigation.state !== "idle";
  const initial = actionData?.settings || settings || DEFAULT_SETTINGS;

  const [formState, setFormState] = useState(() => ({
    requireYear: initial.requireYear ?? true,
    requireAllFields: initial.requireAllFields ?? true,
    logNoResults: initial.logNoResults ?? true,
    includeUniversal: initial.includeUniversal ?? true,
    redirectOnSearch: initial.redirectOnSearch ?? true,
    resultsUrl: initial.resultsUrl ?? "/collections/all",
    persistSelection: initial.persistSelection ?? true,
    enableGarage: initial.enableGarage ?? true,
    showFitmentChecker: initial.showFitmentChecker ?? true,
  }));

  useEffect(() => {
    const current = actionData?.settings || settings;
    if (current) {
      setFormState({
        requireYear: current.requireYear,
        requireAllFields: current.requireAllFields,
        logNoResults: current.logNoResults,
        includeUniversal: current.includeUniversal,
        redirectOnSearch: current.redirectOnSearch,
        resultsUrl: current.resultsUrl,
        persistSelection: current.persistSelection,
        enableGarage: current.enableGarage,
        showFitmentChecker: current.showFitmentChecker,
      });
    }
  }, [settings, actionData]);

  const handleChange = (key, value) => {
    setFormState((prev) => ({ ...prev, [key]: value }));
  };

  return (
    <div style={{ padding: "28px 24px 60px", maxWidth: "1140px", margin: "0 auto", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif", color: "#0f172a" }}>
      
      {/* Executive Header Banner */}
      <div style={{ background: "linear-gradient(135deg, #0f172a 0%, #1e293b 100%)", borderRadius: "16px", padding: "32px", color: "#ffffff", marginBottom: "24px", boxShadow: "0 10px 25px -5px rgba(15, 23, 42, 0.25)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "16px" }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "6px" }}>
              <h1 style={{ margin: 0, fontSize: "26px", fontWeight: "800", letterSpacing: "-0.5px" }}>
                Store Settings & Compatibility
              </h1>
              <span style={{ background: "rgba(37, 99, 235, 0.25)", border: "1px solid rgba(59, 130, 246, 0.4)", color: "#60a5fa", padding: "4px 12px", borderRadius: "20px", fontSize: "12px", fontWeight: "700" }}>
                {planLabel}
              </span>
            </div>
            <p style={{ margin: 0, color: "#94a3b8", fontSize: "14px" }}>
              Configure vehicle lookup behavior, storefront search redirection, customer garage tools, and theme blocks for <strong style={{ color: "#cbd5e1" }}>{shop}</strong>.
            </p>
          </div>

          <a
            href={`https://${shop}/admin/themes/current/editor`}
            target="_blank"
            rel="noreferrer"
            style={{
              background: "rgba(255, 255, 255, 0.1)",
              border: "1px solid rgba(255, 255, 255, 0.25)",
              color: "#ffffff",
              padding: "10px 18px",
              borderRadius: "10px",
              fontSize: "13px",
              fontWeight: "700",
              textDecoration: "none",
              display: "inline-flex",
              alignItems: "center",
              gap: "6px",
              backdropFilter: "blur(4px)",
              transition: "all 0.2s ease"
            }}
          >
            Open Theme Customizer →
          </a>
        </div>
      </div>

      {/* Success Notification Alert */}
      {actionData?.saved && (
        <div style={{ background: "#ecfdf5", border: "1px solid #a7f3d0", color: "#047857", padding: "16px 20px", borderRadius: "12px", marginBottom: "28px", display: "flex", alignItems: "center", gap: "12px", boxShadow: "0 4px 12px rgba(4, 120, 87, 0.06)" }}>
          <div style={{ background: "#047857", color: "#ffffff", width: "24px", height: "24px", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: "bold", fontSize: "13px" }}>
            ✓
          </div>
          <div>
            <strong style={{ fontSize: "15px", display: "block" }}>Settings Saved Successfully</strong>
            <span style={{ fontSize: "13px", opacity: 0.9 }}>Your updated configuration is now active across your storefront.</span>
          </div>
        </div>
      )}

      <Form method="post">
        <input type="hidden" name="redirect_on_search" value={formState.redirectOnSearch ? "true" : "false"} />
        <input type="hidden" name="results_url" value={formState.resultsUrl} />

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(480px, 1fr))", gap: "24px", marginBottom: "28px" }}>
          
          {/* Card 1: Search & Lookup Behavior */}
          <div style={cardStyle}>
            <div style={cardHeaderStyle}>
              <div style={badgeStyle("#eff6ff", "#1d4ed8")}>01</div>
              <div>
                <h3 style={cardTitleStyle}>Search & Lookup Logic</h3>
                <p style={cardSubStyle}>Control how customers interact with Year/Make/Model dropdowns.</p>
              </div>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
              <ToggleRow
                name="require_year"
                checked={formState.requireYear}
                onChange={(val) => handleChange("requireYear", val)}
                title="Require Year Selection First"
                desc="Forces customers to select a Year before Make and Model options become selectable."
              />

              <ToggleRow
                name="require_all_fields"
                checked={formState.requireAllFields}
                onChange={(val) => handleChange("requireAllFields", val)}
                title="Require All Fields (Year + Make + Model)"
                desc="Search action remains disabled until all 3 vehicle specifications are selected."
              />

              <ToggleRow
                name="log_no_results"
                checked={formState.logNoResults}
                onChange={(val) => handleChange("logNoResults", val)}
                title="Log No-Result Searches"
                desc="Record customer queries with 0 matching catalog items to uncover high-demand vehicle inventory gaps."
              />
            </div>
          </div>

          {/* Card 2: Product Matching & Results */}
          <div style={cardStyle}>
            <div style={cardHeaderStyle}>
              <div style={badgeStyle("#ecfdf5", "#047857")}>02</div>
              <div>
                <h3 style={cardTitleStyle}>Product Matching & Results</h3>
                <p style={cardSubStyle}>Determine how compatible products appear and redirect on search.</p>
              </div>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
              <ToggleRow
                name="include_universal"
                checked={formState.includeUniversal}
                onChange={(val) => handleChange("includeUniversal", val)}
                title="Include Universal Fit Products"
                desc="Display items marked as 'Universal' alongside specific vehicle fitment matches."
              />

              {/* Results Display Options */}
              <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "12px", padding: "18px" }}>
                <label style={{ fontSize: "14px", fontWeight: "800", color: "#0f172a", display: "block", marginBottom: "4px" }}>
                  Results Display Options
                </label>
                <span style={{ fontSize: "12px", color: "#64748b", display: "block", marginBottom: "14px" }}>
                  Choose where and how search results appear when a customer submits a search query.
                </span>

                <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                  {/* Option 1: /collections/all */}
                  <label
                    onClick={() => {
                      handleChange("redirectOnSearch", true);
                      handleChange("resultsUrl", "/collections/all");
                    }}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "12px",
                      padding: "12px 14px",
                      borderRadius: "8px",
                      background: formState.redirectOnSearch && formState.resultsUrl === "/collections/all" ? "#ffffff" : "#f1f5f9",
                      border: `1px solid ${formState.redirectOnSearch && formState.resultsUrl === "/collections/all" ? "#008060" : "#cbd5e1"}`,
                      cursor: "pointer",
                      transition: "all 0.15s ease",
                    }}
                  >
                    <input
                      type="radio"
                      name="display_option_radio"
                      checked={formState.redirectOnSearch && formState.resultsUrl === "/collections/all"}
                      onChange={() => {
                        handleChange("redirectOnSearch", true);
                        handleChange("resultsUrl", "/collections/all");
                      }}
                      style={{ accentColor: "#008060" }}
                    />
                    <div>
                      <strong style={{ fontSize: "13px", color: "#0f172a", display: "block" }}>/collections/all</strong>
                      <span style={{ fontSize: "12px", color: "#64748b" }}>Redirects search queries to the main store collection page.</span>
                    </div>
                  </label>

                  {/* Option 2: Dedicated Results Page */}
                  <label
                    onClick={() => {
                      handleChange("redirectOnSearch", true);
                      if (formState.resultsUrl === "/collections/all" || !formState.resultsUrl) {
                        handleChange("resultsUrl", "/pages/find-your-part");
                      }
                    }}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "12px",
                      padding: "12px 14px",
                      borderRadius: "8px",
                      background: formState.redirectOnSearch && formState.resultsUrl !== "/collections/all" ? "#ffffff" : "#f1f5f9",
                      border: `1px solid ${formState.redirectOnSearch && formState.resultsUrl !== "/collections/all" ? "#008060" : "#cbd5e1"}`,
                      cursor: "pointer",
                      transition: "all 0.15s ease",
                    }}
                  >
                    <input
                      type="radio"
                      name="display_option_radio"
                      checked={formState.redirectOnSearch && formState.resultsUrl !== "/collections/all"}
                      onChange={() => {
                        handleChange("redirectOnSearch", true);
                        if (formState.resultsUrl === "/collections/all" || !formState.resultsUrl) {
                          handleChange("resultsUrl", "/pages/find-your-part");
                        }
                      }}
                      style={{ accentColor: "#008060" }}
                    />
                    <div style={{ flex: 1 }}>
                      <strong style={{ fontSize: "13px", color: "#0f172a", display: "block" }}>Dedicated Results Page</strong>
                      <span style={{ fontSize: "12px", color: "#64748b" }}>Redirects to a custom store URL or dedicated page template.</span>
                    </div>
                  </label>

                  {/* Custom URL Input for Dedicated Page */}
                  {formState.redirectOnSearch && formState.resultsUrl !== "/collections/all" && (
                    <div style={{ marginLeft: "28px", marginTop: "2px" }}>
                      <input
                        value={formState.resultsUrl}
                        onChange={(e) => handleChange("resultsUrl", e.target.value)}
                        style={inputStyle}
                        placeholder="/pages/find-your-part"
                      />
                      <span style={{ fontSize: "11px", color: "#64748b", marginTop: "4px", display: "block" }}>
                        Enter dedicated page path (e.g. <code style={{ background: "#e2e8f0", padding: "1px 4px", borderRadius: "3px" }}>/pages/find-your-part</code>).
                      </span>
                    </div>
                  )}

                  {/* Option 3: Same Page (Inline Results) */}
                  <label
                    onClick={() => {
                      handleChange("redirectOnSearch", false);
                    }}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "12px",
                      padding: "12px 14px",
                      borderRadius: "8px",
                      background: !formState.redirectOnSearch ? "#ffffff" : "#f1f5f9",
                      border: `1px solid ${!formState.redirectOnSearch ? "#008060" : "#cbd5e1"}`,
                      cursor: "pointer",
                      transition: "all 0.15s ease",
                    }}
                  >
                    <input
                      type="radio"
                      name="display_option_radio"
                      checked={!formState.redirectOnSearch}
                      onChange={() => {
                        handleChange("redirectOnSearch", false);
                      }}
                      style={{ accentColor: "#008060" }}
                    />
                    <div>
                      <strong style={{ fontSize: "13px", color: "#0f172a", display: "block" }}>Same Page (Inline Results)</strong>
                      <span style={{ fontSize: "12px", color: "#64748b" }}>Renders matching product grid directly under the widget without redirection.</span>
                    </div>
                  </label>
                </div>
              </div>

            </div>
          </div>

          {/* Card 3: Customer Experience & Garage */}
          <div style={cardStyle}>
            <div style={cardHeaderStyle}>
              <div style={badgeStyle("#f5f3ff", "#6d5bd0")}>03</div>
              <div>
                <h3 style={cardTitleStyle}>Customer Experience & Garage</h3>
                <p style={cardSubStyle}>Manage vehicle persistence, saved garages, and product page badges.</p>
              </div>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
              <ToggleRow
                name="persist_selection"
                checked={formState.persistSelection}
                onChange={(val) => handleChange("persistSelection", val)}
                title="Persist Vehicle Selection Across Pages"
                desc="Store customer vehicle choice in local browser storage so it stays selected as they navigate."
              />

              <ToggleRow
                name="enable_garage"
                checked={formState.enableGarage}
                onChange={(val) => handleChange("enableGarage", val)}
                title="Enable 'My Garage' Widget"
                desc="Allow shoppers to save multiple vehicles to their account garage for quick switching."
              />

              <ToggleRow
                name="show_fitment_checker"
                checked={formState.showFitmentChecker && planAllowsFitmentChecker}
                disabled={!planAllowsFitmentChecker}
                onChange={(val) => handleChange("showFitmentChecker", val)}
                title="Show Product Page Fitment Checker"
                desc="Display automatic 'Fits your vehicle' status badges directly on product detail pages."
                planBadge={!planAllowsFitmentChecker ? (
                  <span style={{ fontSize: "11px", color: "#b45309", background: "#fef3c7", border: "1px solid #fde68a", padding: "2px 8px", borderRadius: "12px", fontWeight: "700" }}>
                    Growth Pro Plan Required
                  </span>
                ) : null}
              />
              {!planAllowsFitmentChecker && (
                <div style={{ background: "#fffbe6", border: "1px solid #ffe58f", borderRadius: "8px", padding: "12px 14px", fontSize: "13px", color: "#78350f" }}>
                  Product Page Fitment Verification requires Growth Pro. Current plan: <strong>{planLabel}</strong>.{" "}
                  <Link to="/app/plans" style={{ color: "#2563eb", fontWeight: "700", textDecoration: "none" }}>
                    Upgrade Plan →
                  </Link>
                </div>
              )}
            </div>
          </div>

          {/* Card 4: Theme App Extension Guide */}
          <div style={cardStyle}>
            <div style={cardHeaderStyle}>
              <div style={badgeStyle("#fff7ed", "#ea580c")}>04</div>
              <div>
                <h3 style={cardTitleStyle}>Storefront Theme Integration</h3>
                <p style={cardSubStyle}>Quick reference for embedding PartMatch widgets into your Shopify theme.</p>
              </div>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
              <IntegrationStep
                step="1"
                title="Open Theme Customizer"
                desc="Go to Online Store → Themes → Customize in your Shopify Admin."
              />
              <IntegrationStep
                step="2"
                title="Add Search Widget Block"
                desc="Add 'PartMatch Search' block to your Homepage, Header, or Collection template."
              />
              <IntegrationStep
                step="3"
                title="Add Product Checker"
                desc="Add 'PartMatch Fitment Check' block on your Product Detail page template."
              />
              <IntegrationStep
                step="4"
                title="Add Persistent Vehicle Bar"
                desc="Add 'PartMatch Vehicle Bar' to your store Header or Footer."
              />
            </div>
          </div>

        </div>

        {/* Action Bar */}
        <div style={{ background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: "16px", padding: "20px 28px", boxShadow: "0 10px 25px -5px rgba(0, 0, 0, 0.05)", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "16px" }}>
          <div>
            <strong style={{ fontSize: "15px", color: "#0f172a", display: "block" }}>Configuration Changes</strong>
            <span style={{ fontSize: "13px", color: "#64748b" }}>Click save to immediately apply settings across your storefront.</span>
          </div>

          <button
            type="submit"
            disabled={isSaving}
            style={{
              background: isSaving ? "#94a3b8" : "linear-gradient(135deg, #008060 0%, #005e46 100%)",
              color: "#ffffff",
              border: "none",
              padding: "12px 28px",
              borderRadius: "10px",
              fontSize: "14px",
              fontWeight: "700",
              cursor: isSaving ? "not-allowed" : "pointer",
              boxShadow: "0 4px 14px rgba(0, 128, 96, 0.25)",
              transition: "all 0.2s ease"
            }}
          >
            {isSaving ? "Saving Settings…" : "Save Settings"}
          </button>
        </div>

      </Form>
    </div>
  );
}

// ─── Sub-Components & Styles ───────────────────────────────────────────────────

function ToggleRow({ name, checked, onChange, title, desc, disabled, planBadge }) {
  return (
    <div
      onClick={() => !disabled && onChange(!checked)}
      style={{
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "space-between",
        gap: "16px",
        padding: "14px 16px",
        borderRadius: "12px",
        background: checked ? "#f8fafc" : "#ffffff",
        border: `1px solid ${checked ? "#cbd5e1" : "#e2e8f0"}`,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.6 : 1,
        transition: "all 0.15s ease",
      }}
    >
      <input type="hidden" name={name} value={checked ? "true" : "false"} />
      
      <div style={{ flex: 1 }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
          <span style={{ fontSize: "14px", fontWeight: "700", color: "#0f172a" }}>{title}</span>
          {planBadge}
        </div>
        <div style={{ fontSize: "13px", color: "#64748b", lineHeight: "1.4" }}>{desc}</div>
      </div>

      {/* Switch Toggle */}
      <div
        style={{
          width: "44px",
          height: "24px",
          borderRadius: "12px",
          background: checked ? "#008060" : "#cbd5e1",
          position: "relative",
          transition: "background 0.2s ease",
          flexShrink: 0,
          marginTop: "2px",
        }}
      >
        <div
          style={{
            width: "20px",
            height: "20px",
            borderRadius: "50%",
            background: "#ffffff",
            position: "absolute",
            top: "2px",
            left: checked ? "22px" : "2px",
            transition: "left 0.2s ease",
            boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
          }}
        />
      </div>
    </div>
  );
}

function IntegrationStep({ step, title, desc }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: "12px", padding: "10px 12px", borderRadius: "8px", background: "#f8fafc", border: "1px solid #f1f5f9" }}>
      <span style={{ width: "24px", height: "24px", borderRadius: "50%", background: "#e2e8f0", color: "#334155", fontWeight: "800", fontSize: "12px", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, marginTop: "2px" }}>
        {step}
      </span>
      <div>
        <strong style={{ fontSize: "13px", color: "#0f172a", display: "block" }}>{title}</strong>
        <span style={{ fontSize: "12px", color: "#64748b" }}>{desc}</span>
      </div>
    </div>
  );
}

const cardStyle = {
  background: "#ffffff",
  border: "1px solid #e2e8f0",
  borderRadius: "16px",
  padding: "24px",
  boxShadow: "0 4px 16px rgba(0, 0, 0, 0.03)",
};

const cardHeaderStyle = {
  display: "flex",
  alignItems: "center",
  gap: "12px",
  borderBottom: "1px solid #f1f5f9",
  paddingBottom: "16px",
  marginBottom: "20px",
};

const badgeStyle = (bg, color) => ({
  width: "36px",
  height: "36px",
  borderRadius: "10px",
  background: bg,
  color: color,
  fontWeight: "800",
  fontSize: "14px",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  flexShrink: 0,
});

const cardTitleStyle = {
  fontSize: "17px",
  fontWeight: "800",
  margin: "0 0 2px",
  color: "#0f172a",
  letterSpacing: "-0.3px",
};

const cardSubStyle = {
  fontSize: "13px",
  color: "#64748b",
  margin: 0,
};

const inputStyle = {
  width: "100%",
  padding: "10px 14px",
  border: "1px solid #cbd5e1",
  borderRadius: "8px",
  fontSize: "14px",
  boxSizing: "border-box",
  color: "#0f172a",
  outline: "none",
  background: "#ffffff",
};
