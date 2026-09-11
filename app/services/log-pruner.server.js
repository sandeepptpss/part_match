import prisma from "../db.server.js";

// In-memory timestamp to throttle automatic periodic pruning to once every 24 hours per process/shop
const lastAutoPrune = new Map();

/**
 * Prunes SearchLog entries older than `daysToKeep` (default: 180 days).
 * Keeps the database lean, fast, and optimized for high-traffic stores.
 *
 * @param {string} shop - Shop domain
 * @param {number} daysToKeep - Number of days of search logs to retain (default 180)
 * @returns {Promise<{ deletedCount: number, cutoffDate: Date }>}
 */
export async function pruneOldSearchLogs(shop, daysToKeep = 180) {
  if (!shop) return { deletedCount: 0, cutoffDate: new Date() };

  const cutoffDate = new Date(Date.now() - daysToKeep * 24 * 60 * 60 * 1000);

  try {
    const result = await prisma.searchLog.deleteMany({
      where: {
        shop,
        createdAt: { lt: cutoffDate },
      },
    });

    lastAutoPrune.set(shop, Date.now());
    return {
      deletedCount: result.count,
      cutoffDate,
    };
  } catch (err) {
    console.error(`[log-pruner] Error pruning search logs for ${shop}:`, err);
    return { deletedCount: 0, cutoffDate, error: err.message };
  }
}

/**
 * Throttled periodic auto-pruning (runs at most once every 24 hours per shop).
 */
export async function maybeAutoPruneSearchLogs(shop, daysToKeep = 180) {
  if (!shop) return;
  const lastTime = lastAutoPrune.get(shop) || 0;
  const ONE_DAY_MS = 24 * 60 * 60 * 1000;

  if (Date.now() - lastTime > ONE_DAY_MS) {
    // Run in background without blocking caller
    pruneOldSearchLogs(shop, daysToKeep).catch((err) => {
      console.warn(`[log-pruner] Auto prune background task failed for ${shop}:`, err);
    });
  }
}
