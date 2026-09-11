import { useState, useEffect } from "react";
import { redirect, useLoaderData, Form, useActionData, useNavigation, Link } from "react-router";
const json = (data, init) => Response.json(data, init);
import { authenticate } from "../shopify.server.js";
import prisma from "../db.server.js";
import { getShopPlan, planLimits } from "../plans.server.js";
import { extractFitmentFromDocument } from "../services/catalog-extractor.server.js";
import {
  createImportJob,
  stageRecords,
  commitStagedItems,
  rollbackImportJob,
  getImportJobHistory,
} from "../services/import-engine.server.js";
import { normalizeVehicleRecord } from "../services/vehicle-normalizer.server.js";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const { plan } = await getShopPlan(shop);
  const limits = planLimits(plan);

  // Fetch pending staged items for review
  const [stagedItems, pendingCount, conflictCount, recentJobs] = await Promise.all([
    prisma.stagedFitment.findMany({
      where: { shop, status: { in: ["PENDING", "CONFLICT"] } },
      orderBy: { id: "desc" },
      take: 100,
    }),
    prisma.stagedFitment.count({
      where: { shop, status: "PENDING" },
    }),
    prisma.stagedFitment.count({
      where: { shop, status: "CONFLICT" },
    }),
    getImportJobHistory(shop, 15),
  ]);

  return json({
    planAllowsImport: limits.csvImportExport,
    planAllowsAces: limits.acesPiesSupport,
    planAllowsAiDocument: limits.aiDocumentImport,
    planAllowsAudit: limits.importAuditHistory,
    planAllowsConflict: limits.conflictDetectionReview,
    planLabel: limits.label,
    activePlan: plan,
    stagedItems,
    stagedStats: {
      total: stagedItems.length,
      pending: pendingCount,
      conflicts: conflictCount,
    },
    recentJobs,
  });
};

export const action = async ({ request }) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = session.shop;

  const { plan } = await getShopPlan(shop);
  const limits = planLimits(plan);

  const formData = await request.formData();
  const intent = formData.get("intent")?.toString() || "directImport";

  // Cache for Shopify Product GraphQL lookups
  const handleCache = new Map();
  async function resolveHandle(handle) {
    if (!handle) return null;
    if (handleCache.has(handle)) return handleCache.get(handle);
    try {
      const res = await admin.graphql(
        `query($handle: String!) { productByHandle(handle: $handle) { id title handle } }`,
        { variables: { handle } },
      );
      const data = await res.json();
      const product = data.data?.productByHandle ?? null;
      handleCache.set(handle, product);
      return product;
    } catch (err) {
      console.warn("[app.fitment.import] GraphQL resolveHandle error:", err);
      return null;
    }
  }

  // ─── ACTION INTENT 1: AI Document & PDF Extraction ──────────────────────────
  if (intent === "aiDocumentExtract") {
    if (!limits.aiDocumentImport) {
      return json({
        error: "AI PDF & Catalog Document Extraction is an Enterprise feature. Upgrade your plan to extract vehicle fitments directly from supplier line cards and catalogs.",
        activeTab: "aiDocument",
      });
    }

    const documentText = formData.get("documentText")?.toString() || "";
    const fileName = formData.get("fileName")?.toString() || "supplier_catalog.pdf";

    if (!documentText.trim()) {
      return json({
        error: "Please upload a document or paste catalog/spec sheet text to extract fitments.",
        activeTab: "aiDocument",
      });
    }

    try {
      const extraction = await extractFitmentFromDocument(documentText);
      if (!extraction.records || extraction.records.length === 0) {
        return json({
          error: "No vehicle fitment specifications could be extracted from the provided document. Please check the text or format.",
          activeTab: "aiDocument",
        });
      }

      // Create an ImportJob and stage extracted records
      const job = await createImportJob({
        shop,
        fileName,
        fileType: "PDF_CATALOG",
        totalRows: extraction.records.length,
      });

      const { staged, conflicts } = await stageRecords({
        jobId: job.id,
        shop,
        records: extraction.records,
        source: "PDF_AI",
        resolveProductHandle: resolveHandle,
      });

      return json({
        successMessage: `Successfully extracted ${staged} fitment specifications into the Review Queue (${conflicts} flagged for verification)!`,
        activeTab: "staging",
      });
    } catch (err) {
      console.error("[app.fitment.import] AI Document Extraction error:", err);
      return json({
        error: `AI extraction failed: ${err.message}`,
        activeTab: "aiDocument",
      });
    }
  }

  // ─── ACTION INTENT 2: Stage CSV into Review Queue ───────────────────────────
  if (intent === "stageCsv") {
    if (!limits.csvImportExport) {
      return json({
        error: "Bulk CSV Import is available on paid plans (Starter Pro and above). Upgrade your plan to import records.",
        activeTab: "standard",
      });
    }

    const rawInput = formData.get("csv")?.toString() || "";
    const fileName = formData.get("fileName")?.toString() || "fitment_import.csv";

    if (!rawInput.trim()) {
      return json({ error: "No CSV content provided to stage", activeTab: "standard" });
    }

    const lines = rawInput.trim().split(/\r?\n/).filter((l) => l.trim());
    if (lines.length < 2) {
      return json({ error: "CSV file must contain a header row and at least one data row.", activeTab: "standard" });
    }

    let delimiter = ",";
    if (!lines[0].includes(",") && lines[0].includes(";")) delimiter = ";";
    else if (!lines[0].includes(",") && lines[0].includes("\t")) delimiter = "\t";

    const headers = lines[0].split(delimiter).map((h) => h.trim().toLowerCase().replace(/["']/g, ""));
    const yearIdx = headers.findIndex((h) => ["year", "yearid", "modelyear", "model_year", "yyyy"].includes(h));
    const makeIdx = headers.findIndex((h) => ["make", "makename", "make_name", "manufacturer", "brand"].includes(h));
    const modelIdx = headers.findIndex((h) => ["model", "modelname", "model_name", "vehicle_model"].includes(h));
    const trimIdx = headers.findIndex((h) => ["trim", "submodel", "submodelname", "enginebase", "sub_model", "engine", "trim_level"].includes(h));
    const handleIdx = headers.findIndex((h) => ["product_handle", "handle", "product handle", "partnumber", "partno", "part_number", "itemnumber", "product_sku", "shopify_handle"].includes(h));

    if (yearIdx === -1 || makeIdx === -1 || modelIdx === -1) {
      return json({
        error: `Missing required columns. Found: ${headers.join(", ")}. Required: Year, Make, Model`,
        activeTab: "standard",
      });
    }

    const records = [];
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(delimiter).map((c) => c.trim().replace(/^["']|["']$/g, ""));
      const year = cols[yearIdx];
      const make = cols[makeIdx];
      const model = cols[modelIdx];
      const trim = trimIdx >= 0 ? cols[trimIdx] || "" : "";
      const handle = handleIdx >= 0 ? cols[handleIdx] : "";
      if (year && make && model) {
        records.push({ year, make, model, trim, handle, partNumber: handle });
      }
    }

    const job = await createImportJob({
      shop,
      fileName,
      fileType: "CSV",
      totalRows: records.length,
    });

    const { staged, conflicts } = await stageRecords({
      jobId: job.id,
      shop,
      records,
      source: "CSV",
      resolveProductHandle: resolveHandle,
    });

    return json({
      successMessage: `CSV staged successfully! ${staged} records loaded into the Review Queue (${conflicts} flagged for conflict verification).`,
      activeTab: "staging",
    });
  }

  // ─── ACTION INTENT 3: Approve & Commit Staged Items ──────────────────────────
  if (intent === "approveStaged") {
    const itemIdsRaw = formData.get("itemIds")?.toString();
    let itemIds = null;
    if (itemIdsRaw && itemIdsRaw !== "all") {
      try {
        itemIds = JSON.parse(itemIdsRaw);
      } catch (_) {}
    }

    const stagedRecords = await prisma.stagedFitment.findMany({
      where: {
        shop,
        ...(itemIds && itemIds.length > 0 ? { id: { in: itemIds } } : { status: { in: ["PENDING", "CONFLICT"] } }),
      },
      select: { importJobId: true },
      distinct: ["importJobId"],
    });

    const jobIds = stagedRecords.map((r) => r.importJobId);
    let totalCommitted = 0;

    for (const jId of jobIds) {
      const result = await commitStagedItems({
        shop,
        jobId: jId,
        itemIds,
        resolveProduct: resolveHandle,
      });
      totalCommitted += result.committedCount;
    }

    return json({
      successMessage: `Successfully approved and committed ${totalCommitted} vehicle fitment records to your catalog!`,
      activeTab: "staging",
    });
  }

  // ─── ACTION INTENT 4: Reject Staged Items ───────────────────────────────────
  if (intent === "rejectStaged") {
    const itemIdsRaw = formData.get("itemIds")?.toString();
    let itemIds = null;
    if (itemIdsRaw && itemIdsRaw !== "all") {
      try {
        itemIds = JSON.parse(itemIdsRaw);
      } catch (_) {}
    }

    if (itemIds && itemIds.length > 0) {
      await prisma.stagedFitment.deleteMany({
        where: { shop, id: { in: itemIds } },
      });
    } else {
      await prisma.stagedFitment.deleteMany({
        where: { shop, status: { in: ["PENDING", "CONFLICT"] } },
      });
    }

    return json({
      successMessage: "Rejected and removed selected items from the staging queue.",
      activeTab: "staging",
    });
  }

  // ─── ACTION INTENT 5: Rollback Import Job ───────────────────────────────────
  if (intent === "rollbackJob") {
    if (!limits.importAuditHistory) {
      return json({
        error: "Import Rollback is available on Growth Pro and Enterprise plans. Upgrade to rollback historical imports.",
        activeTab: "audit",
      });
    }

    const jobId = parseInt(formData.get("jobId")?.toString() || "0", 10);
    if (!jobId) {
      return json({ error: "Invalid Job ID for rollback", activeTab: "audit" });
    }

    try {
      const res = await rollbackImportJob({ shop, jobId });
      return json({
        successMessage: `Successfully rolled back Job #${jobId}. Deleted ${res.deletedProducts} mapped parts and ${res.deletedRecords} vehicle records created by this job.`,
        activeTab: "audit",
      });
    } catch (err) {
      return json({
        error: `Rollback failed: ${err.message}`,
        activeTab: "audit",
      });
    }
  }

  // ─── ACTION INTENT 6: Standard Direct Import (Existing Workflow Preserved) ──
  if (!limits.csvImportExport) {
    return json({
      error: `Bulk CSV Import is available on paid plans (Starter Pro and above). Upgrade your plan to import records.`,
      results: null,
      activeTab: "standard",
    });
  }

  let rawInput = formData.get("csv")?.toString() || "";
  if (!rawInput.trim()) {
    return json({ error: "No CSV or ACES/PIES XML data provided", results: null, activeTab: "standard" });
  }

  let cleanInput = rawInput.trim();
  if (cleanInput.startsWith("{") && cleanInput.includes('"csv"')) {
    try {
      const parsedJson = JSON.parse(cleanInput);
      if (parsedJson.csv) {
        cleanInput = parsedJson.csv.trim();
      }
    } catch (_) {}
  }
  rawInput = cleanInput;

  const results = { created: 0, skipped: 0, errors: [] };
  let recordCount = Number.isFinite(limits.fitmentLimit)
    ? await prisma.fitmentRecord.count({ where: { shop } })
    : 0;
  let limitReached = false;

  // Create audit log for this direct import
  const directJob = await createImportJob({
    shop,
    fileName: rawInput.trim().startsWith("<") ? "aces_catalog.xml" : "direct_import.csv",
    fileType: rawInput.trim().startsWith("<") ? "ACES_XML" : "CSV",
  });

  // ACES XML format import
  if (rawInput.trim().startsWith("<")) {
    if (!limits.acesPiesSupport) {
      return json({
        error: `ACES / PIES XML format import is an advanced feature available on Growth Pro and Enterprise plans. Please upgrade your plan to import ACES XML files, or upload standard PartMatch CSV.`,
        results: null,
        activeTab: "standard",
      });
    }

    const appRegex = /<(?:[a-zA-Z0-9_]+:)?(?:App|Vehicle|Item)[\s\S]*?<\/(?:[a-zA-Z0-9_]+:)?(?:App|Vehicle|Item)>/gi;
    const matches = rawInput.match(appRegex) || [];

    if (matches.length === 0) {
      return json({
        error: "Invalid ACES/PIES XML format. No <App>, <Vehicle>, or <Item> fitment records found.",
        results: null,
        activeTab: "standard",
      });
    }

    for (let i = 0; i < matches.length; i++) {
      const appBlock = matches[i];
      const getXmlTag = (...tags) => {
        for (const tag of tags) {
          const match = appBlock.match(new RegExp(`<(?:[a-zA-Z0-9_]+:)?${tag}[^>]*>([^<]+)<\\/(?:[a-zA-Z0-9_]+:)?${tag}>`, "i"));
          if (match && match[1]?.trim()) return match[1].trim();
        }
        return "";
      };

      const year = getXmlTag("Year", "BaseVehicleYear", "ModelYear", "FromYear", "YearID");
      const make = getXmlTag("Make", "MakeName", "Brand", "Manufacturer");
      const model = getXmlTag("Model", "ModelName", "VehicleModel");
      const trim = getXmlTag("SubModel", "SubModelName", "EngineBase", "Trim", "Sub_Model", "DriveType");
      const partNumber = getXmlTag("Part", "PartNumber", "ItemNumber", "SKU", "PartTerminologyName");

      if (!year || !make || !model) {
        results.errors.push(`XML Record ${i + 1}: Missing Year, Make, or Model`);
        results.skipped++;
        continue;
      }

      if (limitReached) {
        results.errors.push(`XML Record ${i + 1}: skipped — ${limits.fitmentLimit.toLocaleString()} fitment record limit reached`);
        results.skipped++;
        continue;
      }

      try {
        const normalizedList = normalizeVehicleRecord({ year, make, model, trim });
        for (const norm of normalizedList) {
          const existingRecord = Number.isFinite(limits.fitmentLimit)
            ? await prisma.fitmentRecord.findUnique({
                where: { shop_year_make_model_trim: { shop, year: norm.year, make: norm.make, model: norm.model, trim: norm.trim } },
              })
            : null;

          if (!existingRecord && Number.isFinite(limits.fitmentLimit) && recordCount >= limits.fitmentLimit) {
            limitReached = true;
            results.errors.push(`XML Record ${i + 1}: skipped — ${limits.fitmentLimit.toLocaleString()} fitment limit reached`);
            results.skipped++;
            continue;
          }

          const fitment = await prisma.fitmentRecord.upsert({
            where: { shop_year_make_model_trim: { shop, year: norm.year, make: norm.make, model: norm.model, trim: norm.trim } },
            create: { shop, year: norm.year, make: norm.make, model: norm.model, trim: norm.trim, source: "ACES_XML", importJobId: directJob.id },
            update: { importJobId: directJob.id },
          });
          if (!existingRecord) recordCount++;

          if (partNumber) {
            const product = await resolveHandle(partNumber.toLowerCase());
            if (product) {
              await prisma.fitmentProduct.upsert({
                where: { fitmentId_shopifyProductId: { fitmentId: fitment.id, shopifyProductId: product.id } },
                create: { fitmentId: fitment.id, shopifyProductId: product.id, shopifyHandle: product.handle, productTitle: product.title, source: "ACES_XML", importJobId: directJob.id },
                update: { shopifyHandle: product.handle, productTitle: product.title, importJobId: directJob.id },
              });
            } else {
              await prisma.fitmentSku.upsert({
                where: { fitmentId_sku: { fitmentId: fitment.id, sku: partNumber } },
                create: { fitmentId: fitment.id, sku: partNumber },
                update: {},
              });
            }
          }
          results.created++;
        }
      } catch (err) {
        results.errors.push(`XML Record ${i + 1}: ${err.message}`);
        results.skipped++;
      }
    }

    await prisma.importJob.update({
      where: { id: directJob.id },
      data: {
        status: "COMPLETED",
        totalRows: matches.length,
        processedRows: results.created + results.skipped,
        approvedCount: results.created,
        summaryJson: JSON.stringify(results),
      },
    });

    return json({ error: null, results, activeTab: "standard" });
  }

  // Parse standard CSV format
  const lines = rawInput.trim().split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) {
    return json({
      error: "The uploaded CSV file contains only a header row without any fitment data rows.",
      results: null,
      activeTab: "standard",
    });
  }

  let delimiter = ",";
  if (!lines[0].includes(",") && lines[0].includes(";")) delimiter = ";";
  else if (!lines[0].includes(",") && lines[0].includes("\t")) delimiter = "\t";

  const headers = lines[0].split(delimiter).map((h) => h.trim().toLowerCase().replace(/["']/g, ""));
  const yearIdx = headers.findIndex((h) => ["year", "yearid", "modelyear", "model_year", "yyyy"].includes(h));
  const makeIdx = headers.findIndex((h) => ["make", "makename", "make_name", "manufacturer", "brand"].includes(h));
  const modelIdx = headers.findIndex((h) => ["model", "modelname", "model_name", "vehicle_model"].includes(h));
  const trimIdx = headers.findIndex((h) => ["trim", "submodel", "submodelname", "enginebase", "sub_model", "engine", "trim_level"].includes(h));
  const handleIdx = headers.findIndex((h) => ["product_handle", "handle", "product handle", "partnumber", "partno", "part_number", "itemnumber", "product_sku", "shopify_handle"].includes(h));
  const collectionIdx = headers.findIndex((h) => ["collection_handle", "collection", "collection_slug"].includes(h));
  const tagIdx = headers.findIndex((h) => ["tag", "tags", "fitment_tag"].includes(h));
  const skuIdx = headers.findIndex((h) => ["sku", "variant_sku", "part_sku", "variant sku"].includes(h));

  if (yearIdx === -1 || makeIdx === -1 || modelIdx === -1) {
    return json({
      error: `Missing required columns. Found: ${headers.join(", ")}. Supported headers: Year, Make, Model, PartNumber/Handle/SKU`,
      results: null,
      activeTab: "standard",
    });
  }

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(delimiter).map((c) => c.trim().replace(/^["']|["']$/g, ""));
    const year = cols[yearIdx];
    const make = cols[makeIdx];
    const model = cols[modelIdx];
    const trimVal = trimIdx >= 0 ? cols[trimIdx] || "" : "";
    const handle = handleIdx >= 0 ? cols[handleIdx] : null;
    const collectionHandle = collectionIdx >= 0 ? cols[collectionIdx] : null;
    const tagVal = tagIdx >= 0 ? cols[tagIdx]?.replace(/^#/, "") : null;
    const skuVal = skuIdx >= 0 ? cols[skuIdx] : null;

    if (!year || !make || !model) {
      results.errors.push(`Row ${i + 1}: missing year, make, or model`);
      results.skipped++;
      continue;
    }

    if (limitReached) {
      results.errors.push(`Row ${i + 1}: skipped — ${limits.fitmentLimit.toLocaleString()} fitment record limit reached`);
      results.skipped++;
      continue;
    }

    try {
      const normalizedList = normalizeVehicleRecord({ year, make, model, trim: trimVal });
      for (const norm of normalizedList) {
        const existingRecord = Number.isFinite(limits.fitmentLimit)
          ? await prisma.fitmentRecord.findUnique({
              where: { shop_year_make_model_trim: { shop, year: norm.year, make: norm.make, model: norm.model, trim: norm.trim } },
            })
          : null;

        if (!existingRecord && Number.isFinite(limits.fitmentLimit) && recordCount >= limits.fitmentLimit) {
          limitReached = true;
          results.errors.push(`Row ${i + 1}: skipped — fitment record limit reached`);
          results.skipped++;
          continue;
        }

        const fitment = await prisma.fitmentRecord.upsert({
          where: { shop_year_make_model_trim: { shop, year: norm.year, make: norm.make, model: norm.model, trim: norm.trim } },
          create: { shop, year: norm.year, make: norm.make, model: norm.model, trim: norm.trim, source: "CSV", importJobId: directJob.id },
          update: { importJobId: directJob.id },
        });
        if (!existingRecord) recordCount++;

        if (handle) {
          const product = await resolveHandle(handle);
          if (!product) {
            await prisma.fitmentSku.upsert({
              where: { fitmentId_sku: { fitmentId: fitment.id, sku: handle } },
              create: { fitmentId: fitment.id, sku: handle },
              update: {},
            });
          } else {
            await prisma.fitmentProduct.upsert({
              where: { fitmentId_shopifyProductId: { fitmentId: fitment.id, shopifyProductId: product.id } },
              create: { fitmentId: fitment.id, shopifyProductId: product.id, shopifyHandle: product.handle, productTitle: product.title, source: "CSV", importJobId: directJob.id },
              update: { shopifyHandle: product.handle, productTitle: product.title, importJobId: directJob.id },
            });
          }
        }

        if (collectionHandle) {
          const keyId = `custom-${collectionHandle}`;
          await prisma.fitmentCollection.upsert({
            where: { fitmentId_shopifyCollectionId: { fitmentId: fitment.id, shopifyCollectionId: keyId } },
            create: { fitmentId: fitment.id, shopifyCollectionId: keyId, shopifyHandle: collectionHandle, collectionTitle: collectionHandle },
            update: { shopifyHandle: collectionHandle },
          });
        }

        if (tagVal) {
          await prisma.fitmentTag.upsert({
            where: { fitmentId_tag: { fitmentId: fitment.id, tag: tagVal } },
            create: { fitmentId: fitment.id, tag: tagVal },
            update: {},
          });
        }

        if (skuVal) {
          await prisma.fitmentSku.upsert({
            where: { fitmentId_sku: { fitmentId: fitment.id, sku: skuVal } },
            create: { fitmentId: fitment.id, sku: skuVal },
            update: {},
          });
        }

        results.created++;
      }
    } catch (err) {
      results.errors.push(`Row ${i + 1}: ${err.message}`);
      results.skipped++;
    }
  }

  await prisma.importJob.update({
    where: { id: directJob.id },
    data: {
      status: "COMPLETED",
      totalRows: lines.length - 1,
      processedRows: results.created + results.skipped,
      approvedCount: results.created,
      summaryJson: JSON.stringify(results),
    },
  });

  return json({ error: null, results, activeTab: "standard" });
};

export default function FitmentImport() {
  const {
    planAllowsImport,
    planAllowsAces,
    planAllowsAiDocument,
    planAllowsAudit,
    planAllowsConflict,
    planLabel,
    activePlan,
    stagedItems,
    stagedStats,
    recentJobs,
  } = useLoaderData();

  const actionData = useActionData();
  const navigation = useNavigation();
  const isSubmitting = navigation.state !== "idle";

  // Tab State
  const [activeTab, setActiveTab] = useState(() => actionData?.activeTab || "standard");

  useEffect(() => {
    if (actionData?.activeTab) {
      setActiveTab(actionData.activeTab);
    }
  }, [actionData?.activeTab]);

  // Standard CSV / ACES state
  const [csvContent, setCsvContent] = useState("");
  const [fileName, setFileName] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const [showAcesConverter, setShowAcesConverter] = useState(false);
  const [acesInput, setAcesInput] = useState("");
  const [convertedCsv, setConvertedCsv] = useState("");
  const [conversionStatus, setConversionStatus] = useState(null);
  const [dismissActionError, setDismissActionError] = useState(false);

  // AI Document Import state
  const [documentText, setDocumentText] = useState("");
  const [docFileName, setDocFileName] = useState("");
  const [isDocDragging, setIsDocDragging] = useState(false);

  // Staging Review Queue State
  const [selectedStagedIds, setSelectedStagedIds] = useState(() => new Set(stagedItems.map((i) => i.id)));
  const [stagingFilter, setStagingFilter] = useState("all"); // "all" | "high" | "review" | "conflicts"

  useEffect(() => {
    setSelectedStagedIds(new Set(stagedItems.map((i) => i.id)));
  }, [stagedItems]);

  const toggleStagedSelect = (id) => {
    const next = new Set(selectedStagedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedStagedIds(next);
  };

  const selectAllStaged = () => {
    setSelectedStagedIds(new Set(stagedItems.map((i) => i.id)));
  };

  const selectHighOnly = () => {
    setSelectedStagedIds(new Set(stagedItems.filter((i) => i.confidence >= 90 && !i.hasConflict).map((i) => i.id)));
  };

  const deselectAllStaged = () => {
    setSelectedStagedIds(new Set());
  };

  const filteredStagedItems = stagedItems.filter((item) => {
    if (stagingFilter === "high") return item.confidence >= 90 && !item.hasConflict;
    if (stagingFilter === "review") return item.confidence < 90 || item.hasConflict;
    if (stagingFilter === "conflicts") return item.hasConflict;
    return true;
  });

  const convertAcesToCsv = () => {
    if (!acesInput.trim()) {
      setConversionStatus({ type: "error", message: "Please paste ACES/PIES XML or CSV data to convert." });
      return;
    }

    try {
      let rows = [["year", "make", "model", "trim", "product_handle", "product_title", "collection_handle", "tag", "sku"]];
      let input = acesInput.trim();

      if (input.startsWith("<") || input.includes("<ACES") || input.includes("<App") || input.includes("<Vehicle") || input.includes("<Item")) {
        const appBlocks = input.match(/<(?:[a-zA-Z0-9_]+:)?(?:App|Vehicle|Item)[\s\S]*?<\/(?:[a-zA-Z0-9_]+:)?(?:App|Vehicle|Item)>/gi) || [];
        if (appBlocks.length === 0) {
          setConversionStatus({ type: "error", message: "No <App>, <Vehicle>, or <Item> XML elements found in ACES/PIES content." });
          return;
        }

        appBlocks.forEach((appBlock) => {
          const getTag = (...tags) => {
            for (const tag of tags) {
              const match = appBlock.match(new RegExp(`<(?:[a-zA-Z0-9_]+:)?${tag}[^>]*>([^<]+)<\\/(?:[a-zA-Z0-9_]+:)?${tag}>`, "i"));
              if (match && match[1]?.trim()) return match[1].trim();
            }
            return "";
          };
          const year = getTag("Year", "BaseVehicleYear", "ModelYear", "FromYear", "YearID");
          const make = getTag("Make", "MakeName", "Brand", "Manufacturer");
          const model = getTag("Model", "ModelName", "VehicleModel");
          const trim = getTag("SubModel", "SubModelName", "EngineBase", "Trim", "Sub_Model", "DriveType");
          const part = getTag("Part", "PartNumber", "ItemNumber", "SKU", "PartTerminologyName");

          if (year && make && model) {
            rows.push([year, make, model, trim, part, "", "", "", part]);
          }
        });
      } else {
        const lines = input.split(/\r?\n/).filter((l) => l.trim());
        if (lines.length > 1) {
          const firstLine = lines[0];
          let delimiter = ",";
          if (!firstLine.includes(",") && firstLine.includes(";")) delimiter = ";";
          else if (!firstLine.includes(",") && firstLine.includes("\t")) delimiter = "\t";

          const headers = lines[0].split(delimiter).map((h) => h.trim().toLowerCase().replace(/["']/g, ""));
          const yearIdx = headers.findIndex((h) => ["year", "yearid", "modelyear", "basevehicleyear", "model_year", "yyyy"].includes(h));
          const makeIdx = headers.findIndex((h) => ["make", "makename", "make_name", "brand", "manufacturer"].includes(h));
          const modelIdx = headers.findIndex((h) => ["model", "modelname", "model_name", "vehicle_model"].includes(h));
          const trimIdx = headers.findIndex((h) => ["trim", "submodel", "submodelname", "sub_model", "enginebase", "engine"].includes(h));
          const partIdx = headers.findIndex((h) => ["partnumber", "part_number", "part", "partno", "sku", "itemnumber", "product_sku", "handle"].includes(h));

          for (let i = 1; i < lines.length; i++) {
            const cols = lines[i].split(delimiter).map((c) => c.trim().replace(/^["']|["']$/g, ""));
            const year = yearIdx >= 0 ? cols[yearIdx] : "";
            const make = makeIdx >= 0 ? cols[makeIdx] : "";
            const model = modelIdx >= 0 ? cols[modelIdx] : "";
            const trim = trimIdx >= 0 ? cols[trimIdx] || "" : "";
            const part = partIdx >= 0 ? cols[partIdx] || "" : "";

            if (year && make && model) {
              rows.push([year, make, model, trim, part, "", "", "", part]);
            }
          }
        }
      }

      if (rows.length <= 1) {
        setConversionStatus({ type: "error", message: "Could not extract valid ACES records. Please check your XML or CSV format." });
        return;
      }

      const generatedCsv = rows.map((r) => r.map((cell) => `"${(cell || "").replace(/"/g, '""')}"`).join(",")).join("\n");
      setConvertedCsv(generatedCsv);
      setCsvContent(generatedCsv);
      setFileName("converted_aces_partmatch.csv");
      setConversionStatus({ type: "success", count: rows.length - 1 });
    } catch (err) {
      setConversionStatus({ type: "error", message: `Conversion error: ${err.message}` });
    }
  };

  const sampleCSV = `year,make,model,trim,product_handle,product_title,collection_handle,tag,sku
2025,Arctic Cat,Norseman 400,Base,brake-pad-arctic-cat,Brake Pad Arctic Cat,,,
2025,Arctic Cat,Norseman 400,LX,,,arctic-cat-parts,,
2024,Polaris,Sportsman 850,SP,,,,polaris-sportsman-2024,
2026,BMW,M3,Base,,,,SKU-BMW-M3-2026`;

  const sampleACES = `YearID,MakeName,ModelName,SubModelName,PartNumber,BrandID
2025,Ford,F-150,XL,BP-FORD-F150-2025,MOTORCRAFT
2024,Chevrolet,Silverado 1500,LT,BRK-CHEVY-2024,ACDELCO
2026,Toyota,Camry,SE,OIL-TOY-CAMRY-2026,DENSO`;

  const sampleACESXML = `<?xml version="1.0" encoding="utf-8"?>
<ACES version="3.2">
  <Header>
    <Company>AutoParts Enterprise</Company>
    <SenderName>PartMatch Export</SenderName>
  </Header>
  <App action="A" id="1">
    <BaseVehicleYear>2025</BaseVehicleYear>
    <MakeName>Ford</MakeName>
    <ModelName>F-150</ModelName>
    <SubModelName>XL 3.5L V6</SubModelName>
    <PartNumber>BP-FORD-F150-2025</PartNumber>
  </App>
  <App action="A" id="2">
    <BaseVehicleYear>2024</BaseVehicleYear>
    <MakeName>BMW</MakeName>
    <ModelName>M3</ModelName>
    <SubModelName>Competition 3.0L</SubModelName>
    <PartNumber>bmw-m3-brake-rotors</PartNumber>
  </App>
</ACES>`;

  const handleFileUpload = (file) => {
    if (!file) return;
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (e) => {
      let content = (e.target?.result || "").toString().replace(/^\uFEFF/, "");
      let trimmed = content.trim();
      if (trimmed.startsWith("{") && trimmed.includes('"csv"')) {
        try {
          const parsed = JSON.parse(trimmed);
          if (parsed.csv) content = parsed.csv;
        } catch (_) {}
      }
      setCsvContent(content);
    };
    reader.readAsText(file);
  };

  const handleDocUpload = (file) => {
    if (!file) return;
    setDocFileName(file.name);
    const reader = new FileReader();
    reader.onload = (e) => {
      const content = (e.target?.result || "").toString();
      setDocumentText(content);
    };
    reader.readAsText(file);
  };

  const downloadFile = (content, filename, type) => {
    const isCsv = type.includes("csv") || filename.endsWith(".csv");
    const finalContent = isCsv && !content.startsWith("\uFEFF") ? "\uFEFF" + content : content;
    const blob = new Blob([finalContent], { type: `${type};charset=utf-8;` });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const getConfidenceBadge = (confidence, hasConflict) => {
    if (hasConflict) {
      return (
        <span style={{ background: "#fef2f2", border: "1px solid #fecaca", color: "#991b1b", padding: "4px 10px", borderRadius: "12px", fontSize: "11px", fontWeight: "800" }}>
          Conflict: Review Required
        </span>
      );
    }
    if (confidence >= 90) {
      return (
        <span style={{ background: "#ecfdf5", border: "1px solid #a7f3d0", color: "#047857", padding: "4px 10px", borderRadius: "12px", fontSize: "11px", fontWeight: "800" }}>
          {confidence}% High Match
        </span>
      );
    }
    return (
      <span style={{ background: "#fffbeb", border: "1px solid #fde68a", color: "#b45309", padding: "4px 10px", borderRadius: "12px", fontSize: "11px", fontWeight: "800" }}>
        {confidence}% Verify Specs
      </span>
    );
  };

  return (
    <div style={{ padding: "28px 24px 60px", width: "100%", maxWidth: "100%", boxSizing: "border-box", margin: "0 auto", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif", color: "#0f172a" }}>
      {/* Top Breadcrumb Navigation */}
      <div style={{ marginBottom: "20px" }}>
        <Link to="/app/fitment" style={{ color: "#475569", fontSize: "14px", fontWeight: "600", textDecoration: "none", display: "inline-flex", alignItems: "center", gap: "6px" }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="19" y1="12" x2="5" y2="12"></line>
            <polyline points="12 19 5 12 12 5"></polyline>
          </svg>
          Back to Fitment Catalog
        </Link>
      </div>

      {/* Executive Hero Banner */}
      <div style={{
        background: "linear-gradient(135deg, #0f172a 0%, #1e293b 100%)",
        borderRadius: "16px",
        padding: "28px 32px",
        color: "#ffffff",
        marginBottom: "24px",
        boxShadow: "0 10px 25px -5px rgba(15, 23, 42, 0.15)",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        flexWrap: "wrap",
        gap: "16px"
      }}>
        <div style={{ maxWidth: "650px" }}>
          <div style={{ display: "inline-flex", alignItems: "center", gap: "6px", background: "rgba(255, 255, 255, 0.1)", padding: "4px 10px", borderRadius: "6px", fontSize: "12px", fontWeight: "700", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "10px", color: "#cbd5e1" }}>
            AI Automotive Fitment Ingestion Engine
          </div>
          <h1 style={{ fontSize: "26px", fontWeight: "800", margin: "0 0 6px", color: "#ffffff", letterSpacing: "-0.5px" }}>
            Vehicle Fitment Import & Intelligence System
          </h1>
          <p style={{ color: "#94a3b8", margin: 0, fontSize: "14px", lineHeight: "1.5" }}>
            Import from standard CSV, ACES/PIES XML, or leverage <strong>Gemini AI</strong> to extract vehicle fitments from supplier PDFs, line cards, and spec sheets with automated normalization and conflict detection.
          </p>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "8px", alignItems: "flex-end" }}>
          <div style={{ background: "rgba(16, 185, 129, 0.15)", border: "1px solid rgba(16, 185, 129, 0.3)", borderRadius: "12px", padding: "10px 16px", textAlign: "right" }}>
            <div style={{ color: "#34d399", fontSize: "11px", fontWeight: "800", textTransform: "uppercase", letterSpacing: "0.5px" }}>Normalization & Conflict Guard</div>
            <div style={{ color: "#ffffff", fontSize: "13px", fontWeight: "700", marginTop: "2px" }}>Active ({planLabel})</div>
          </div>
        </div>
      </div>

      {/* Main Container */}
      <div style={{ background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: "16px", padding: "28px", boxShadow: "0 4px 20px -2px rgba(0, 0, 0, 0.03)" }}>

        {/* Global Notifications */}
        {actionData?.error && !dismissActionError && (
          <div style={{ background: "#fef2f2", border: "1px solid #fecaca", color: "#991b1b", padding: "16px 20px", borderRadius: "12px", marginBottom: "24px", fontSize: "14px", fontWeight: "500", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px" }}>
            <div>
              <span style={{ fontWeight: "700" }}>Error:</span> {actionData.error}
            </div>
            <button
              type="button"
              onClick={() => setDismissActionError(true)}
              style={{ background: "none", border: "none", color: "#991b1b", fontSize: "14px", fontWeight: "800", cursor: "pointer", padding: "2px 6px" }}
              title="Dismiss error"
            >
              Dismiss
            </button>
          </div>
        )}

        {actionData?.successMessage && (
          <div style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", color: "#166534", padding: "16px 20px", borderRadius: "12px", marginBottom: "24px", fontSize: "14px", fontWeight: "600", display: "flex", alignItems: "center", gap: "10px" }}>
            <span style={{ fontWeight: "700" }}>Success:</span> {actionData.successMessage}
          </div>
        )}

        {actionData?.results && (
          <div style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", color: "#166534", padding: "20px 24px", borderRadius: "14px", marginBottom: "28px" }}>
            <div style={{ fontSize: "16px", fontWeight: "800", color: "#15803d", marginBottom: "8px" }}>
              Import Operation Complete
            </div>
            <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", margin: "10px 0 0" }}>
              <span style={{ background: "#ffffff", color: "#15803d", padding: "6px 14px", borderRadius: "8px", fontWeight: "700", border: "1px solid #86efac", fontSize: "13px" }}>
                Created / Updated: {actionData.results.created}
              </span>
              <span style={{ background: "#ffffff", color: "#b45309", padding: "6px 14px", borderRadius: "8px", fontWeight: "700", border: "1px solid #fde68a", fontSize: "13px" }}>
                Skipped: {actionData.results.skipped}
              </span>
            </div>
            {actionData.results.errors?.length > 0 && (
              <details style={{ marginTop: "14px" }}>
                <summary style={{ cursor: "pointer", fontWeight: "700", fontSize: "13px", color: "#92400e" }}>
                  View {actionData.results.errors.length} warning / error details
                </summary>
                <ul style={{ marginTop: "10px", color: "#b45309", fontSize: "13px", paddingLeft: "20px" }}>
                  {actionData.results.errors.map((e, i) => <li key={i} style={{ marginBottom: "4px" }}>{e}</li>)}
                </ul>
              </details>
            )}
          </div>
        )}

        {/* Tab Navigation */}
        <div style={{ display: "flex", gap: "8px", borderBottom: "2px solid #e2e8f0", marginBottom: "28px", paddingBottom: "2px", flexWrap: "wrap" }}>
          {[
            { id: "standard", label: "Standard CSV & ACES XML" },
            { id: "aiDocument", label: "AI Document & PDF Import", badge: "AI" },
            { id: "staging", label: "Staging & Conflict Review", count: stagedStats.total },
            { id: "audit", label: "Import History & Rollback", count: recentJobs.length },
          ].map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setActiveTab(t.id)}
              style={{
                background: activeTab === t.id ? "#0f172a" : "transparent",
                color: activeTab === t.id ? "#ffffff" : "#475569",
                border: "none",
                padding: "10px 18px",
                borderRadius: "10px",
                fontSize: "14px",
                fontWeight: "700",
                cursor: "pointer",
                display: "inline-flex",
                alignItems: "center",
                gap: "8px",
                transition: "all 0.15s ease",
              }}
            >
              <span>{t.label}</span>
              {t.badge && (
                <span style={{ background: "#2563eb", color: "#ffffff", padding: "2px 6px", borderRadius: "6px", fontSize: "10px", fontWeight: "800" }}>
                  {t.badge}
                </span>
              )}
              {t.count != null && t.count > 0 && (
                <span style={{ background: activeTab === t.id ? "rgba(255,255,255,0.2)" : "#e2e8f0", color: activeTab === t.id ? "#ffffff" : "#0f172a", padding: "2px 8px", borderRadius: "10px", fontSize: "11px", fontWeight: "800" }}>
                  {t.count}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* ═══════════════════════════════════════════════════════════════════════ */}
        {/* TAB 1: Standard CSV & ACES XML Import (Existing Workflow Preserved)   */}
        {/* ═══════════════════════════════════════════════════════════════════════ */}
        {activeTab === "standard" && (
          <div>
            {/* Step 1: Download Templates */}
            <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "14px", padding: "20px 22px", marginBottom: "24px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "10px", marginBottom: "16px" }}>
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
                    <span style={{ background: "#0f172a", color: "#ffffff", fontSize: "11px", fontWeight: "800", padding: "2px 8px", borderRadius: "4px", letterSpacing: "0.5px" }}>STEP 1</span>
                    <h2 style={{ fontSize: "15px", fontWeight: "700", color: "#0f172a", margin: 0 }}>Starter Catalog Templates</h2>
                  </div>
                  <p style={{ margin: 0, fontSize: "13px", color: "#64748b" }}>
                    Download pre-formatted sample spreadsheets to format your catalog with vehicle specifications.
                  </p>
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: "12px" }}>
                {/* Template 1 */}
                <div style={{ background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: "10px", padding: "14px 16px", display: "flex", flexDirection: "column", justifyContent: "space-between", boxShadow: "0 1px 3px rgba(0,0,0,0.03)" }}>
                  <div style={{ marginBottom: "12px" }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "4px" }}>
                      <span style={{ fontSize: "13px", fontWeight: "700", color: "#0f172a" }}>Standard PartMatch CSV</span>
                      <span style={{ background: "#eff6ff", color: "#2563eb", fontSize: "10px", fontWeight: "700", padding: "2px 6px", borderRadius: "4px" }}>Recommended</span>
                    </div>
                    <p style={{ margin: 0, fontSize: "12px", color: "#64748b", lineHeight: "1.4" }}>
                      Default 9-column fitment catalog format (Universal & SKU compatible).
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => downloadFile(sampleCSV, "partmatch_sample.csv", "text/csv")}
                    style={{
                      background: "#f8fafc",
                      color: "#0f172a",
                      border: "1px solid #cbd5e1",
                      padding: "7px 12px",
                      borderRadius: "6px",
                      fontSize: "12px",
                      fontWeight: "700",
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: "6px",
                      transition: "all 0.15s ease",
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = "#e2e8f0"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = "#f8fafc"; }}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                    Download CSV Template
                  </button>
                </div>

                {/* Template 2 */}
                <div style={{ background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: "10px", padding: "14px 16px", display: "flex", flexDirection: "column", justifyContent: "space-between", boxShadow: "0 1px 3px rgba(0,0,0,0.03)" }}>
                  <div style={{ marginBottom: "12px" }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "4px" }}>
                      <span style={{ fontSize: "13px", fontWeight: "700", color: "#0f172a" }}>ACES Standard CSV</span>
                      <span style={{ background: "#ecfdf5", color: "#047857", fontSize: "10px", fontWeight: "700", padding: "2px 6px", borderRadius: "4px" }}>Auto Standard</span>
                    </div>
                    <p style={{ margin: 0, fontSize: "12px", color: "#64748b", lineHeight: "1.4" }}>
                      North American ACES vehicle & part mappings for aftermarket parts.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => downloadFile(sampleACES, "aces_fitment_sample.csv", "text/csv")}
                    style={{
                      background: "#f8fafc",
                      color: "#0f172a",
                      border: "1px solid #cbd5e1",
                      padding: "7px 12px",
                      borderRadius: "6px",
                      fontSize: "12px",
                      fontWeight: "700",
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: "6px",
                      transition: "all 0.15s ease",
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = "#e2e8f0"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = "#f8fafc"; }}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                    Download ACES CSV
                  </button>
                </div>

                {/* Template 3 */}
                <div style={{ background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: "10px", padding: "14px 16px", display: "flex", flexDirection: "column", justifyContent: "space-between", boxShadow: "0 1px 3px rgba(0,0,0,0.03)" }}>
                  <div style={{ marginBottom: "12px" }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "4px" }}>
                      <span style={{ fontSize: "13px", fontWeight: "700", color: "#0f172a" }}>ACES Enterprise XML</span>
                      <span style={{ background: "#f1f5f9", color: "#475569", fontSize: "10px", fontWeight: "700", padding: "2px 6px", borderRadius: "4px" }}>ACES 3.2</span>
                    </div>
                    <p style={{ margin: 0, fontSize: "12px", color: "#64748b", lineHeight: "1.4" }}>
                      Industry ACES 3.2 XML catalog specification for direct supplier feeds.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => downloadFile(sampleACESXML, "aces_catalog_sample.xml", "application/xml")}
                    style={{
                      background: "#f8fafc",
                      color: "#0f172a",
                      border: "1px solid #cbd5e1",
                      padding: "7px 12px",
                      borderRadius: "6px",
                      fontSize: "12px",
                      fontWeight: "700",
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: "6px",
                      transition: "all 0.15s ease",
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = "#e2e8f0"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = "#f8fafc"; }}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                    Download ACES XML
                  </button>
                </div>
              </div>
            </div>

            {/* ACES / PIES Converter Tool (Collapsible) */}
            <div style={{ background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: "12px", marginBottom: "28px", overflow: "hidden", boxShadow: "0 1px 3px rgba(0,0,0,0.03)" }}>
              <button
                type="button"
                onClick={() => setShowAcesConverter((prev) => !prev)}
                style={{
                  width: "100%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "14px 18px",
                  background: showAcesConverter ? "#f8fafc" : "#ffffff",
                  border: "none",
                  cursor: "pointer",
                  textAlign: "left",
                  transition: "background 0.15s ease",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                  <div style={{ background: "#eff6ff", color: "#2563eb", width: "28px", height: "28px", borderRadius: "8px", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
                  </div>
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                      <span style={{ fontSize: "14px", fontWeight: "700", color: "#0f172a" }}>ACES / PIES 1-Click XML Converter</span>
                      <span style={{ background: "#f1f5f9", color: "#64748b", fontSize: "10px", fontWeight: "700", padding: "2px 6px", borderRadius: "4px" }}>Optional Tool</span>
                    </div>
                    <p style={{ margin: 0, fontSize: "12px", color: "#64748b" }}>Convert raw ACES/PIES XML into PartMatch CSV format</p>
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "12px", color: "#2563eb", fontWeight: "700" }}>
                  <span>{showAcesConverter ? "Close Tool" : "Open Converter Tool"}</span>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ transform: showAcesConverter ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 0.2s ease" }}><polyline points="6 9 12 15 18 9"/></svg>
                </div>
              </button>

              {showAcesConverter && (
                <div style={{ padding: "18px", borderTop: "1px solid #e2e8f0", background: "#f8fafc" }}>
                  <p style={{ margin: "0 0 10px", fontSize: "12px", color: "#64748b" }}>
                    Paste raw ACES XML (<code style={{ background: "#ffffff", border: "1px solid #cbd5e1", padding: "1px 4px", borderRadius: "3px" }}>&lt;App&gt;...&lt;/App&gt;</code>) or ACES CSV to instantly generate standard catalog rows:
                  </p>
                  <textarea
                    rows={4}
                    value={acesInput}
                    onChange={(e) => setAcesInput(e.target.value)}
                    placeholder="Paste raw ACES XML (<App>...</App>) or ACES CSV content here..."
                    style={{ width: "100%", padding: "10px 12px", border: "1px solid #cbd5e1", borderRadius: "8px", fontSize: "12px", fontFamily: "monospace", boxSizing: "border-box", marginBottom: "12px", background: "#ffffff" }}
                  />
                  <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", alignItems: "center" }}>
                    <button
                      type="button"
                      onClick={convertAcesToCsv}
                      style={{ background: "#0f172a", color: "#ffffff", border: "none", padding: "8px 16px", borderRadius: "8px", fontSize: "12px", fontWeight: "700", cursor: "pointer" }}
                    >
                      Convert ACES / PIES →
                    </button>
                    {convertedCsv && (
                      <button
                        type="button"
                        onClick={() => { setCsvContent(convertedCsv); setFileName("converted_aces_partmatch.csv"); }}
                        style={{ background: "#166534", color: "#ffffff", border: "none", padding: "8px 16px", borderRadius: "8px", fontSize: "12px", fontWeight: "700", cursor: "pointer" }}
                      >
                        Load into Import Form Below
                      </button>
                    )}
                  </div>
                  {conversionStatus && (
                    <div style={{ marginTop: "10px", fontSize: "12px", fontWeight: "600", color: conversionStatus.type === "success" ? "#166534" : "#991b1b" }}>
                      {conversionStatus.type === "success" ? `Converted ${conversionStatus.count} records successfully!` : conversionStatus.message}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Step 2: Upload File & Paste Area */}
            <div style={{ marginBottom: "28px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "14px" }}>
                <span style={{ background: "#0f172a", color: "#ffffff", fontSize: "11px", fontWeight: "800", padding: "2px 8px", borderRadius: "4px", letterSpacing: "0.5px" }}>STEP 2</span>
                <h2 style={{ fontSize: "15px", fontWeight: "700", color: "#0f172a", margin: 0 }}>Upload & Import Catalog</h2>
              </div>

              {/* Upload Dropzone */}
              <div
                onClick={() => { if (planAllowsImport) document.getElementById("csvFileInput")?.click(); }}
                onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setIsDragging(false);
                  if (e.dataTransfer.files?.[0]) handleFileUpload(e.dataTransfer.files[0]);
                }}
                style={{
                  border: isDragging ? "2px dashed #2563eb" : "2px dashed #cbd5e1",
                  background: isDragging ? "#eff6ff" : "#f8fafc",
                  borderRadius: "14px",
                  padding: "32px 24px",
                  textAlign: "center",
                  cursor: planAllowsImport ? "pointer" : "not-allowed",
                  marginBottom: "20px",
                  transition: "all 0.15s ease",
                }}
              >
                <input
                  type="file"
                  accept=".csv,.xml"
                  disabled={!planAllowsImport}
                  id="csvFileInput"
                  onChange={(e) => handleFileUpload(e.target.files?.[0])}
                  style={{ display: "none" }}
                />
                <div style={{ width: "44px", height: "44px", borderRadius: "12px", background: "#eff6ff", color: "#2563eb", display: "inline-flex", alignItems: "center", justifyContent: "center", marginBottom: "10px" }}>
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                </div>
                <div style={{ fontSize: "15px", fontWeight: "700", color: "#0f172a", marginBottom: "4px" }}>
                  {fileName ? `Selected File: ${fileName}` : "Drag & drop your CSV or XML file here, or browse files"}
                </div>
                <div style={{ fontSize: "12px", color: "#64748b" }}>
                  {fileName ? "Click to choose a different file" : "Supports PartMatch CSV, ACES CSV, and ACES 3.2 XML formats"}
                </div>
              </div>

              {/* Form and Editor */}
              <Form method="post">
                <input type="hidden" name="fileName" value={fileName || "manual_catalog.csv"} />
                <div style={{ marginBottom: "20px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                    <label style={{ fontWeight: "700", color: "#1e293b", fontSize: "13px" }}>
                      Data Content Editor / Spreadsheet Preview
                    </label>
                    {csvContent && (
                      <span style={{ fontSize: "12px", color: "#64748b" }}>
                        {csvContent.trim().split(/\r?\n/).length - 1} data row(s) detected
                      </span>
                    )}
                  </div>
                  <textarea
                    name="csv"
                    rows={7}
                    value={csvContent}
                    onChange={(e) => setCsvContent(e.target.value)}
                    placeholder={sampleCSV}
                    disabled={!planAllowsImport}
                    style={{
                      width: "100%",
                      padding: "12px",
                      border: "1px solid #cbd5e1",
                      borderRadius: "10px",
                      fontSize: "12px",
                      fontFamily: "monospace",
                      boxSizing: "border-box",
                      background: planAllowsImport ? "#ffffff" : "#f1f5f9",
                      lineHeight: "1.5",
                    }}
                  />
                </div>

                <div style={{ display: "flex", gap: "12px", alignItems: "center", flexWrap: "wrap" }}>
                  <button
                    type="submit"
                    name="intent"
                    value="stageCsv"
                    disabled={isSubmitting || !planAllowsImport}
                    style={{
                      background: "#0f172a",
                      color: "#ffffff",
                      border: "none",
                      padding: "12px 22px",
                      borderRadius: "10px",
                      fontSize: "14px",
                      fontWeight: "700",
                      cursor: isSubmitting || !planAllowsImport ? "not-allowed" : "pointer",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "8px",
                      boxShadow: "0 2px 4px rgba(0,0,0,0.1)",
                    }}
                  >
                    <span>Stage for Review & Conflict Check →</span>
                    <span style={{ background: "rgba(255,255,255,0.2)", fontSize: "11px", padding: "2px 6px", borderRadius: "4px" }}>Recommended</span>
                  </button>

                  <button
                    type="submit"
                    name="intent"
                    value="directImport"
                    disabled={isSubmitting || !planAllowsImport}
                    style={{
                      background: "#ffffff",
                      color: "#334155",
                      border: "1px solid #cbd5e1",
                      padding: "12px 20px",
                      borderRadius: "10px",
                      fontSize: "14px",
                      fontWeight: "700",
                      cursor: isSubmitting || !planAllowsImport ? "not-allowed" : "pointer",
                      opacity: isSubmitting || !planAllowsImport ? 0.7 : 1,
                    }}
                  >
                    {isSubmitting ? "Importing Data…" : "Direct Fast Import"}
                  </button>
                </div>
                <p style={{ margin: "8px 0 0", fontSize: "12px", color: "#64748b" }}>
                  Tip: Staging lets you preview normalized vehicle models and resolve conflicts before adding records to your live storefront.
                </p>
              </Form>
            </div>
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════════════════════ */}
        {/* TAB 2: AI Document & PDF Catalog Import (NEW AI Feature)               */}
        {/* ═══════════════════════════════════════════════════════════════════════ */}
        {activeTab === "aiDocument" && (
          <div>
            {!planAllowsAiDocument && (
              <div style={{ background: "#fffbe6", border: "1px solid #ffe58f", color: "#78350f", padding: "20px", borderRadius: "12px", marginBottom: "28px" }}>
                <strong style={{ color: "#b45309", fontSize: "16px", display: "block", marginBottom: "6px" }}>
                  Enterprise Feature: AI PDF & Unstructured Catalog Ingestion
                </strong>
                <p style={{ margin: "0 0 12px", fontSize: "14px" }}>
                  AI Document Import uses Google Gemini to read supplier PDF catalogs, spec sheets, and unstructured line cards, extracting Year, Make, Model, Trim, and SKU mappings automatically.
                </p>
                <Link to="/app/plans" style={{ color: "#2563eb", fontWeight: "700", fontSize: "14px", textDecoration: "none" }}>
                  Upgrade to Enterprise Unlimited Plan →
                </Link>
              </div>
            )}

            <div style={{ background: "linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%)", border: "1px solid #bfdbfe", borderRadius: "14px", padding: "22px", marginBottom: "24px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "8px" }}>
                <span style={{ background: "#2563eb", color: "#ffffff", padding: "3px 8px", borderRadius: "6px", fontSize: "11px", fontWeight: "800" }}>GEMINI AI POWERED</span>
                <h3 style={{ fontSize: "16px", fontWeight: "800", color: "#1e3a8a", margin: 0 }}>
                  Automated PDF & Spec Sheet Catalog Extraction
                </h3>
              </div>
              <p style={{ margin: 0, fontSize: "13px", color: "#1e40af", lineHeight: "1.5" }}>
                Upload supplier PDF catalogs, spec sheet text dumps, or line card documents. Our AI pipeline normalizes vehicle specifications, expands year ranges (e.g. 2015-2018), and stages records with confidence scores for your review.
              </p>
            </div>

            {/* Document Dropzone */}
            <div
              onClick={() => { if (planAllowsAiDocument) document.getElementById("docFileInput")?.click(); }}
              onDragOver={(e) => { e.preventDefault(); setIsDocDragging(true); }}
              onDragLeave={() => setIsDocDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setIsDocDragging(false);
                if (e.dataTransfer.files?.[0]) handleDocUpload(e.dataTransfer.files[0]);
              }}
              style={{
                border: isDocDragging ? "2px dashed #2563eb" : "2px dashed #cbd5e1",
                background: isDocDragging ? "#eff6ff" : "#f8fafc",
                borderRadius: "14px",
                padding: "26px 20px",
                textAlign: "center",
                cursor: planAllowsAiDocument ? "pointer" : "not-allowed",
                marginBottom: "20px",
              }}
            >
              <input
                type="file"
                accept=".txt,.pdf,.csv,.json,.md"
                disabled={!planAllowsAiDocument}
                id="docFileInput"
                onChange={(e) => handleDocUpload(e.target.files?.[0])}
                style={{ display: "none" }}
              />
              <div style={{ fontSize: "15px", fontWeight: "700", color: "#1e293b", marginBottom: "4px" }}>
                {docFileName ? `Selected File: ${docFileName}` : "Click to Browse or Drag & Drop Supplier Document"}
              </div>
              <div style={{ fontSize: "12px", color: "#64748b" }}>
                Supports Supplier PDF text, product spec sheets, line cards (.pdf, .txt, .md)
              </div>
            </div>

            <Form method="post">
              <input type="hidden" name="fileName" value={docFileName || "supplier_catalog_spec.txt"} />
              <input type="hidden" name="intent" value="aiDocumentExtract" />

              <div style={{ marginBottom: "20px" }}>
                <label style={{ display: "block", fontWeight: "700", color: "#1e293b", fontSize: "13px", marginBottom: "8px" }}>
                  Document / Catalog Content Preview
                </label>
                <textarea
                  name="documentText"
                  rows={9}
                  value={documentText}
                  onChange={(e) => setDocumentText(e.target.value)}
                  placeholder={`Paste supplier line card or product application table text here...\nExample:\nItem: Heavy-Duty Front Brake Pad Set (SKU: BP-F150-HD)\nApplication: Fits 2018-2022 Ford F-150 with 3.5L V6 EcoBoost\nFits 2019-2023 Chevrolet Silverado 1500 LT / High Country`}
                  disabled={!planAllowsAiDocument}
                  style={{
                    width: "100%",
                    padding: "12px",
                    border: "1px solid #cbd5e1",
                    borderRadius: "10px",
                    fontSize: "13px",
                    fontFamily: "monospace",
                    boxSizing: "border-box",
                    background: planAllowsAiDocument ? "#ffffff" : "#f1f5f9",
                  }}
                />
              </div>

              <button
                type="submit"
                disabled={isSubmitting || !planAllowsAiDocument}
                style={{
                  background: "linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)",
                  color: "#ffffff",
                  border: "none",
                  padding: "12px 28px",
                  borderRadius: "10px",
                  fontSize: "14px",
                  fontWeight: "800",
                  cursor: isSubmitting || !planAllowsAiDocument ? "not-allowed" : "pointer",
                  opacity: isSubmitting || !planAllowsAiDocument ? 0.7 : 1,
                  boxShadow: "0 4px 12px rgba(37, 99, 235, 0.25)",
                }}
              >
                {isSubmitting ? "Analyzing & Extracting with AI…" : "Extract Fitments with Gemini AI →"}
              </button>
            </Form>
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════════════════════ */}
        {/* TAB 3: Staging & Conflict Review Queue (NEW Feature)                  */}
        {/* ═══════════════════════════════════════════════════════════════════════ */}
        {activeTab === "staging" && (
          <div>
            {/* Staging Summary Bar */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "12px", marginBottom: "20px" }}>
              <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "12px", padding: "14px" }}>
                <div style={{ fontSize: "11px", color: "#64748b", fontWeight: "700", textTransform: "uppercase" }}>Pending Staged</div>
                <div style={{ fontSize: "22px", fontWeight: "800", color: "#0f172a" }}>{stagedStats.total}</div>
              </div>

              <div style={{ background: "#ecfdf5", border: "1px solid #a7f3d0", borderRadius: "12px", padding: "14px" }}>
                <div style={{ fontSize: "11px", color: "#047857", fontWeight: "700", textTransform: "uppercase" }}>High Match (90%+)</div>
                <div style={{ fontSize: "22px", fontWeight: "800", color: "#047857" }}>
                  {stagedItems.filter((i) => i.confidence >= 90 && !i.hasConflict).length}
                </div>
              </div>

              <div style={{ background: "#fffbeb", border: "1px solid #fde68a", borderRadius: "12px", padding: "14px" }}>
                <div style={{ fontSize: "11px", color: "#b45309", fontWeight: "700", textTransform: "uppercase" }}>Needs Review</div>
                <div style={{ fontSize: "22px", fontWeight: "800", color: "#b45309" }}>
                  {stagedItems.filter((i) => i.confidence < 90 && !i.hasConflict).length}
                </div>
              </div>

              <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: "12px", padding: "14px" }}>
                <div style={{ fontSize: "11px", color: "#991b1b", fontWeight: "700", textTransform: "uppercase" }}>Conflicts Detected</div>
                <div style={{ fontSize: "22px", fontWeight: "800", color: "#991b1b" }}>{stagedStats.conflicts}</div>
              </div>
            </div>

            {/* Filter and Selection Toolbar */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "12px", marginBottom: "16px", paddingBottom: "14px", borderBottom: "1px solid #f1f5f9" }}>
              <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                {[
                  { id: "all", label: `All (${stagedItems.length})` },
                  { id: "high", label: "High Confidence" },
                  { id: "review", label: "Needs Review" },
                  { id: "conflicts", label: `Conflicts (${stagedStats.conflicts})` },
                ].map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => setStagingFilter(f.id)}
                    style={{
                      background: stagingFilter === f.id ? "#0f172a" : "#f1f5f9",
                      color: stagingFilter === f.id ? "#ffffff" : "#475569",
                      border: "none",
                      padding: "6px 12px",
                      borderRadius: "8px",
                      fontSize: "12px",
                      fontWeight: "700",
                      cursor: "pointer",
                    }}
                  >
                    {f.label}
                  </button>
                ))}
              </div>

              <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center" }}>
                <button
                  type="button"
                  onClick={selectHighOnly}
                  style={{ background: "#ecfdf5", border: "1px solid #a7f3d0", color: "#047857", padding: "6px 12px", borderRadius: "8px", fontSize: "12px", fontWeight: "700", cursor: "pointer" }}
                >
                  Select High Confidence Only
                </button>
                <button
                  type="button"
                  onClick={selectAllStaged}
                  style={{ background: "#f8fafc", border: "1px solid #cbd5e1", color: "#334155", padding: "6px 12px", borderRadius: "8px", fontSize: "12px", fontWeight: "700", cursor: "pointer" }}
                >
                  Select All
                </button>
                <button
                  type="button"
                  onClick={deselectAllStaged}
                  style={{ background: "#f8fafc", border: "1px solid #cbd5e1", color: "#64748b", padding: "6px 12px", borderRadius: "8px", fontSize: "12px", fontWeight: "700", cursor: "pointer" }}
                >
                  Deselect
                </button>
              </div>
            </div>

            {/* Commit Form */}
            <Form method="post">
              <input
                type="hidden"
                name="itemIds"
                value={JSON.stringify(Array.from(selectedStagedIds))}
              />

              {filteredStagedItems.length === 0 ? (
                <div style={{ padding: "40px 20px", textAlign: "center", color: "#64748b" }}>
                  <div style={{ fontSize: "16px", fontWeight: "700", marginBottom: "6px" }}>No items in the staging queue</div>
                  <p style={{ margin: 0, fontSize: "13px" }}>
                    Upload a CSV or use AI Document Import to stage records for conflict review.
                  </p>
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "10px", marginBottom: "24px" }}>
                  {filteredStagedItems.map((item) => {
                    const isChecked = selectedStagedIds.has(item.id);
                    return (
                      <div
                        key={item.id}
                        onClick={() => toggleStagedSelect(item.id)}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "14px",
                          padding: "14px 18px",
                          background: isChecked ? "#f0f9ff" : item.hasConflict ? "#fef2f2" : "#ffffff",
                          border: isChecked ? "2px solid #0284c7" : item.hasConflict ? "1px solid #fecaca" : "1px solid #e2e8f0",
                          borderRadius: "12px",
                          cursor: "pointer",
                          transition: "all 0.15s ease",
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => {}}
                          style={{ transform: "scale(1.2)", accentColor: "#0284c7", cursor: "pointer" }}
                        />

                        <div style={{ flex: 1 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "4px", flexWrap: "wrap" }}>
                            <strong style={{ fontSize: "15px", color: "#0f172a" }}>
                              {item.year} {item.make} {item.model} {item.trim ? `(${item.trim})` : ""}
                            </strong>
                            {item.canonicalVehicleId && (
                              <span style={{ fontSize: "10px", background: "#f1f5f9", color: "#475569", padding: "2px 6px", borderRadius: "4px", fontFamily: "monospace" }}>
                                {item.canonicalVehicleId}
                              </span>
                            )}
                          </div>
                          <div style={{ fontSize: "13px", color: "#64748b" }}>
                            Part SKU: <strong style={{ color: "#1e293b" }}>{item.partNumber || item.shopifyHandle || "Universal"}</strong>
                            {item.extractionReason && <span> — <em>"{item.extractionReason}"</em></span>}
                          </div>
                          {item.conflictReason && (
                            <div style={{ fontSize: "12px", color: "#b91c1c", fontWeight: "700", marginTop: "4px" }}>
                              <span style={{ textTransform: "uppercase", fontSize: "10px", background: "#fee2e2", padding: "1px 6px", borderRadius: "4px", marginRight: "6px" }}>Conflict</span>
                              {item.conflictReason}
                            </div>
                          )}
                        </div>

                        <div>
                          {getConfidenceBadge(item.confidence, item.hasConflict)}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {filteredStagedItems.length > 0 && (
                <div style={{ display: "flex", gap: "12px", alignItems: "center", paddingTop: "16px", borderTop: "1px solid #f1f5f9" }}>
                  <button
                    type="submit"
                    name="intent"
                    value="approveStaged"
                    disabled={isSubmitting || selectedStagedIds.size === 0}
                    style={{
                      background: selectedStagedIds.size > 0 ? "linear-gradient(135deg, #008060 0%, #005e46 100%)" : "#94a3b8",
                      color: "#ffffff",
                      border: "none",
                      padding: "12px 24px",
                      borderRadius: "10px",
                      fontSize: "14px",
                      fontWeight: "800",
                      cursor: selectedStagedIds.size > 0 ? "pointer" : "not-allowed",
                    }}
                  >
                    {isSubmitting ? "Committing Records…" : `Approve & Commit ${selectedStagedIds.size} Records to Catalog →`}
                  </button>

                  <button
                    type="submit"
                    name="intent"
                    value="rejectStaged"
                    disabled={isSubmitting || selectedStagedIds.size === 0}
                    style={{
                      background: "#ffffff",
                      color: "#ef4444",
                      border: "1px solid #fca5a5",
                      padding: "11px 20px",
                      borderRadius: "10px",
                      fontSize: "14px",
                      fontWeight: "700",
                      cursor: selectedStagedIds.size > 0 ? "pointer" : "not-allowed",
                    }}
                  >
                    Reject Selected
                  </button>
                </div>
              )}
            </Form>
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════════════════════ */}
        {/* TAB 4: Import History & 1-Click Rollback (NEW Audit Feature)          */}
        {/* ═══════════════════════════════════════════════════════════════════════ */}
        {activeTab === "audit" && (
          <div>
            {!planAllowsAudit && (
              <div style={{ background: "#fffbe6", border: "1px solid #ffe58f", color: "#78350f", padding: "18px", borderRadius: "12px", marginBottom: "20px" }}>
                <strong>Growth Pro & Enterprise Feature</strong>
                <p style={{ margin: "4px 0 10px", fontSize: "13px" }}>
                  Audit History and 1-Click Rollback enable you to review who imported fitments, when, and undo any mistakes with zero downtime.
                </p>
                <Link to="/app/plans" style={{ color: "#2563eb", fontWeight: "700", textDecoration: "none" }}>Upgrade Plan →</Link>
              </div>
            )}

            <div style={{ marginBottom: "20px" }}>
              <h3 style={{ fontSize: "16px", fontWeight: "800", color: "#0f172a", margin: "0 0 6px" }}>
                Import Audit Trail & Rollback Engine
              </h3>
              <p style={{ margin: 0, fontSize: "13px", color: "#64748b" }}>
                View previous import jobs, total processed rows, and rollback imported fitments with a single click.
              </p>
            </div>

            {recentJobs.length === 0 ? (
              <div style={{ padding: "40px 20px", textAlign: "center", color: "#64748b" }}>
                <p style={{ margin: 0, fontSize: "14px" }}>No previous import jobs recorded yet.</p>
              </div>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px", textAlign: "left" }}>
                  <thead>
                    <tr style={{ borderBottom: "2px solid #e2e8f0", color: "#64748b" }}>
                      <th style={{ padding: "10px 12px" }}>Job ID</th>
                      <th style={{ padding: "10px 12px" }}>File Name</th>
                      <th style={{ padding: "10px 12px" }}>Format</th>
                      <th style={{ padding: "10px 12px" }}>Status</th>
                      <th style={{ padding: "10px 12px" }}>Approved</th>
                      <th style={{ padding: "10px 12px" }}>Created At</th>
                      <th style={{ padding: "10px 12px", textAlign: "right" }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentJobs.map((job) => (
                      <tr key={job.id} style={{ borderBottom: "1px solid #f1f5f9" }}>
                        <td style={{ padding: "12px", fontWeight: "700", color: "#0f172a" }}>#{job.id}</td>
                        <td style={{ padding: "12px" }}>{job.fileName}</td>
                        <td style={{ padding: "12px" }}>
                          <span style={{ background: "#f1f5f9", padding: "3px 8px", borderRadius: "6px", fontSize: "11px", fontWeight: "700" }}>
                            {job.fileType}
                          </span>
                        </td>
                        <td style={{ padding: "12px" }}>
                          <span style={{
                            background: job.status === "COMPLETED" ? "#ecfdf5" : job.status === "ROLLED_BACK" ? "#f1f5f9" : "#eff6ff",
                            color: job.status === "COMPLETED" ? "#047857" : job.status === "ROLLED_BACK" ? "#64748b" : "#1d4ed8",
                            padding: "3px 8px",
                            borderRadius: "6px",
                            fontSize: "11px",
                            fontWeight: "800",
                          }}>
                            {job.status}
                          </span>
                        </td>
                        <td style={{ padding: "12px", fontWeight: "700" }}>{job.approvedCount}</td>
                        <td style={{ padding: "12px", color: "#64748b" }}>
                          {new Date(job.createdAt).toLocaleDateString()} {new Date(job.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                        </td>
                        <td style={{ padding: "12px", textAlign: "right" }}>
                          {job.status === "COMPLETED" && planAllowsAudit && (
                            <Form method="post" onSubmit={(e) => {
                              if (!confirm(`Are you sure you want to rollback Job #${job.id}? This will remove records created during this import.`)) {
                                e.preventDefault();
                              }
                            }}>
                              <input type="hidden" name="intent" value="rollbackJob" />
                              <input type="hidden" name="jobId" value={job.id} />
                              <button
                                type="submit"
                                disabled={isSubmitting}
                                style={{
                                  background: "#ffffff",
                                  color: "#ef4444",
                                  border: "1px solid #fecaca",
                                  padding: "6px 12px",
                                  borderRadius: "6px",
                                  fontSize: "12px",
                                  fontWeight: "700",
                                  cursor: "pointer",
                                }}
                              >
                                Rollback
                              </button>
                            </Form>
                          )}
                          {job.status === "ROLLED_BACK" && (
                            <span style={{ color: "#94a3b8", fontSize: "12px", fontStyle: "italic" }}>Rolled Back</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

      </div>
    </div>
  );
}
