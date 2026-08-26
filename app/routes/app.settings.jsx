const json = (data, init) => Response.json(data, init);
import { useState, useEffect } from "react";
import { useLoaderData, Form, useNavigation, useActionData } from "react-router";
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

  let settings = null;
  try {
    settings = await prisma.appSettings.findFirst({
      where: { shop },
    });
    if (!settings) {
      settings = await prisma.appSettings.findFirst();
    }
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

  return json({ settings: settings || DEFAULT_SETTINGS, planAllowsFitmentChecker: limits.fitmentChecker, planLabel: limits.label });
};

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();

  const { plan } = await getShopPlan(shop);
  const limits = planLimits(plan);

  const data = {
    requireYear: formData.get("require_year") === "true",
    requireAllFields: formData.get("require_all_fields") === "true",
    logNoResults: formData.get("log_no_results") === "true",
    includeUniversal: formData.get("include_universal") === "true",
    redirectOnSearch: formData.get("redirect_on_search") === "true",
    resultsUrl: formData.get("results_url")?.toString() || "/pages/find-your-part",
    persistSelection: formData.get("persist_selection") === "true",
    enableGarage: formData.get("enable_garage") === "true",
    // Force off regardless of submitted value when the plan doesn't include it —
    // defense in depth alongside the disabled checkbox in the UI.
    showFitmentChecker: formData.get("show_fitment_checker") === "true" && limits.fitmentChecker,
  };

  let savedSettings = null;
  try {
    let existing = await prisma.appSettings.findFirst({
      where: { shop },
    });
    if (!existing) {
      existing = await prisma.appSettings.findFirst();
    }

    if (existing) {
      savedSettings = await prisma.appSettings.update({
        where: { id: existing.id },
        data: { shop, ...data },
      });
    } else {
      savedSettings = await prisma.appSettings.create({
        data: { shop, ...data },
      });
    }
  } catch (err) {
    console.error("[settings action error]", err);
  }

  return json({ saved: true, settings: savedSettings });
};

export default function Settings() {
  const { settings, planAllowsFitmentChecker, planLabel } = useLoaderData();
  const actionData = useActionData();
  const navigation = useNavigation();

  const initial = actionData?.settings || settings || DEFAULT_SETTINGS;

  // Fully controlled state for instant dynamic feedback
  const [formState, setFormState] = useState(() => ({
    requireYear: initial.requireYear ?? true,
    requireAllFields: initial.requireAllFields ?? true,
    logNoResults: initial.logNoResults ?? true,
    includeUniversal: initial.includeUniversal ?? true,
    redirectOnSearch: initial.redirectOnSearch ?? false,
    resultsUrl: initial.resultsUrl ?? "/pages/find-your-part",
    persistSelection: initial.persistSelection ?? true,
    enableGarage: initial.enableGarage ?? true,
    showFitmentChecker: initial.showFitmentChecker ?? true,
  }));

  // Sync state whenever loader or action data returns new settings
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
    <div style={{ padding: "20px", maxWidth: "800px", margin: "0 auto" }}>
      <h1 style={{ fontSize: "22px", fontWeight: "700", margin: "0 0 4px" }}>Settings</h1>
      <p style={{ color: "#6d7175", margin: "0 0 24px" }}>Configure app behavior for your store.</p>

      {actionData?.saved && (
        <div style={{ background: "#d4edda", color: "#155724", padding: "12px 16px", borderRadius: "6px", marginBottom: "20px" }}>
          Settings saved successfully!
        </div>
      )}

      <Form method="post">
        {/* Search Behavior */}
        <div style={sectionCard}>
          <h3 style={secHead}>Search Behavior</h3>
          <label style={checkRow}>
            <input type="hidden" name="require_year" value={formState.requireYear ? "true" : "false"} />
            <input
              type="checkbox"
              checked={formState.requireYear}
              onChange={(e) => handleChange("requireYear", e.target.checked)}
            />
            <div>
              <div style={checkLabel}>Require Year selection before Make</div>
              <div style={checkDesc}>Year dropdown is always enabled first</div>
            </div>
          </label>
          <label style={checkRow}>
            <input type="hidden" name="require_all_fields" value={formState.requireAllFields ? "true" : "false"} />
            <input
              type="checkbox"
              checked={formState.requireAllFields}
              onChange={(e) => handleChange("requireAllFields", e.target.checked)}
            />
            <div>
              <div style={checkLabel}>Require all fields (Year + Make + Model)</div>
              <div style={checkDesc}>Search button activates only when all dropdowns are selected</div>
            </div>
          </label>
          <label style={checkRow}>
            <input type="hidden" name="log_no_results" value={formState.logNoResults ? "true" : "false"} />
            <input
              type="checkbox"
              checked={formState.logNoResults}
              onChange={(e) => handleChange("logNoResults", e.target.checked)}
            />
            <div>
              <div style={checkLabel}>Log no-result searches for analytics</div>
              <div style={checkDesc}>Track which vehicles have no products mapped</div>
            </div>
          </label>
        </div>

        {/* Product Display */}
        <div style={sectionCard}>
          <h3 style={secHead}>Product Display</h3>
          <label style={checkRow}>
            <input type="hidden" name="include_universal" value={formState.includeUniversal ? "true" : "false"} />
            <input
              type="checkbox"
              checked={formState.includeUniversal}
              onChange={(e) => handleChange("includeUniversal", e.target.checked)}
            />
            <div>
              <div style={checkLabel}>Include Universal Products in results</div>
              <div style={checkDesc}>Universal products always appear alongside fitment results</div>
            </div>
          </label>
          <label style={checkRow}>
            <input type="hidden" name="redirect_on_search" value={formState.redirectOnSearch ? "true" : "false"} />
            <input
              type="checkbox"
              checked={formState.redirectOnSearch}
              onChange={(e) => handleChange("redirectOnSearch", e.target.checked)}
            />
            <div>
              <div style={checkLabel}>Redirect to results page on search</div>
              <div style={checkDesc}>Instead of showing inline results, redirect to a dedicated results page</div>
            </div>
          </label>
          <div style={{ marginTop: "16px" }}>
            <label style={{ fontSize: "14px", fontWeight: "500", display: "block", marginBottom: "6px" }}>
              Results page URL
            </label>
            <input
              name="results_url"
              value={formState.resultsUrl}
              onChange={(e) => handleChange("resultsUrl", e.target.value)}
              style={inp}
              placeholder="/pages/find-your-part"
            />
          </div>
        </div>

        {/* Customer Selection */}
        <div style={sectionCard}>
          <h3 style={secHead}>Customer Selection</h3>
          <label style={checkRow}>
            <input type="hidden" name="persist_selection" value={formState.persistSelection ? "true" : "false"} />
            <input
              type="checkbox"
              checked={formState.persistSelection}
              onChange={(e) => handleChange("persistSelection", e.target.checked)}
            />
            <div>
              <div style={checkLabel}>Persist vehicle selection across pages</div>
              <div style={checkDesc}>Vehicle saved in browser localStorage while browsing</div>
            </div>
          </label>
          <label style={checkRow}>
            <input type="hidden" name="enable_garage" value={formState.enableGarage ? "true" : "false"} />
            <input
              type="checkbox"
              checked={formState.enableGarage}
              onChange={(e) => handleChange("enableGarage", e.target.checked)}
            />
            <div>
              <div style={checkLabel}>Enable My Garage</div>
              <div style={checkDesc}>Allow customers to save up to 5 vehicles</div>
            </div>
          </label>
          <label style={{ ...checkRow, opacity: planAllowsFitmentChecker ? 1 : 0.6 }}>
            <input type="hidden" name="show_fitment_checker" value={formState.showFitmentChecker && planAllowsFitmentChecker ? "true" : "false"} />
            <input
              type="checkbox"
              checked={formState.showFitmentChecker && planAllowsFitmentChecker}
              disabled={!planAllowsFitmentChecker}
              onChange={(e) => handleChange("showFitmentChecker", e.target.checked)}
            />
            <div>
              <div style={checkLabel}>Show product page fitment checker</div>
              <div style={checkDesc}>Display compatibility indicator on product pages</div>
              {!planAllowsFitmentChecker && (
                <div style={{ fontSize: "12px", color: "#7a4a00", marginTop: "4px" }}>
                  Requires Growth Professional plan or above — your current plan is {planLabel}. <a href="/app/plans" style={{ color: "#2c6ecb" }}>Upgrade →</a>
                </div>
              )}
            </div>
          </label>
        </div>

        {/* App URL Config */}
        <div style={sectionCard}>
          <h3 style={secHead}>Integration</h3>
          <div style={{ background: "#f0f7ff", border: "1px solid #b3d4f5", borderRadius: "6px", padding: "16px" }}>
            <p style={{ margin: "0 0 8px", fontSize: "14px", fontWeight: "500" }}>Theme App Extension Setup</p>
            <p style={{ margin: 0, fontSize: "13px", color: "#333" }}>
              1. Go to <strong>Online Store → Themes → Customize</strong><br />
              2. Add <strong>PartMatch Search</strong> block to your homepage and collection pages<br />
              3. Add <strong>PartMatch Fitment Check</strong> block to your product template<br />
              4. Add <strong>PartMatch Vehicle Bar</strong> to your header or footer<br />
              5. Save and publish
            </p>
          </div>
        </div>

        <button
          type="submit"
          disabled={navigation.state !== "idle"}
          style={{ background: "#008060", color: "#fff", border: "none", padding: "10px 24px", borderRadius: "6px", fontSize: "14px", fontWeight: "500", cursor: "pointer" }}
        >
          {navigation.state !== "idle" ? "Saving…" : "Save Settings"}
        </button>
      </Form>
    </div>
  );
}

const sectionCard = { background: "#fff", border: "1px solid #e1e3e5", borderRadius: "8px", padding: "20px", marginBottom: "16px" };
const secHead = { fontSize: "15px", fontWeight: "600", margin: "0 0 16px" };
const checkRow = { display: "flex", alignItems: "flex-start", gap: "12px", marginBottom: "16px", cursor: "pointer" };
const checkLabel = { fontSize: "14px", fontWeight: "500" };
const checkDesc = { fontSize: "13px", color: "#6d7175", marginTop: "2px" };
const inp = { width: "100%", padding: "8px 12px", border: "1px solid #c9cccf", borderRadius: "6px", fontSize: "14px", boxSizing: "border-box" };
