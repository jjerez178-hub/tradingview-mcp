import { evaluate as _evaluate, KNOWN_PATHS } from './connection.js';

const DEFAULT_TIMEOUT = 10000;
const POLL_INTERVAL = 200;

// Internal chart-data handle (same family of window handles used elsewhere, e.g.
// the replay API in src/core/replay.js). Used to confirm readiness via real data
// (a present last-bar timestamp) rather than relying solely on obfuscated CSS class
// substrings, which TradingView rotates and which produce false positives.
const BARS_PATH = KNOWN_PATHS.mainSeriesBars;

/**
 * Wait for the chart to stabilize after a symbol/timeframe change.
 *
 * Returns a structured result so callers can react to a not-ready chart instead
 * of silently proceeding to read stale data:
 *   { ready, reason, waited_ms, symbol_matched, bar_count }
 *
 * Readiness is confirmed two ways. The primary signal is the internal chart API:
 * if the main series exposes a last-bar timestamp and a stable bar count, the
 * chart has real data loaded. If that internal handle is not reachable, we fall
 * back to a DOM heuristic (no visible loader + a stable count of bar elements).
 * The DOM heuristic is brittle against obfuscated class names and is documented
 * as a fallback only.
 *
 * @param {string|null} expectedSymbol — if set, require the legend symbol to match
 * @param {string|null} expectedTf — accepted for signature compatibility (not polled)
 * @param {number} timeout — max wait in ms
 * @param {object} [_deps] — dependency injection for tests ({ evaluate })
 * @returns {Promise<{ready:boolean, reason:string, waited_ms:number, symbol_matched:boolean, bar_count:number}>}
 */
export async function waitForChartReady(expectedSymbol = null, expectedTf = null, timeout = DEFAULT_TIMEOUT, _deps = {}) {
  const evaluate = _deps.evaluate || _evaluate;
  const start = Date.now();
  let lastBarCount = -1;
  let stableCount = 0;
  let symbolMatched = !expectedSymbol;

  const domScript = `
    (function() {
      // Loading spinner heuristic (class names are obfuscated/rotating — fallback only)
      var spinner = document.querySelector('[class*="loader"]')
        || document.querySelector('[class*="loading"]')
        || document.querySelector('[data-name="loading"]');
      var isLoading = spinner && spinner.offsetParent !== null;

      var barCount = -1;
      try {
        var bars = document.querySelectorAll('[class*="bar"]');
        barCount = bars.length;
      } catch {}

      var symbolEl = document.querySelector('[data-name="legend-source-title"]')
        || document.querySelector('[class*="title"] [class*="apply-common-tooltip"]');
      var currentSymbol = symbolEl ? symbolEl.textContent.trim() : '';

      return { isLoading: !!isLoading, barCount: barCount, currentSymbol: currentSymbol };
    })()
  `;

  // Confirms readiness via real chart data: a present last-bar timestamp means the
  // series is loaded. Returns null if the internal handle is not reachable.
  const internalScript = `
    (function() {
      try {
        var bars = ${BARS_PATH};
        if (!bars) return null;
        var last = bars.lastIndex();
        var first = bars.firstIndex();
        var v = bars.valueAt(last);
        return { barCount: (last - first + 1), lastBarTime: (v && v[0]) || null };
      } catch (e) { return null; }
    })()
  `;

  async function safeEval(expr) {
    try { return await evaluate(expr); }
    catch { return null; }
  }

  while (Date.now() - start < timeout) {
    const dom = await safeEval(domScript);
    const internal = await safeEval(internalScript);

    const isLoading = dom ? !!dom.isLoading : false;
    const currentSymbol = dom ? dom.currentSymbol : '';
    const hasInternal = !!(internal && typeof internal.barCount === 'number');
    const hasLastBar = !!(internal && internal.lastBarTime);
    // Prefer the internal bar count (real data) over the DOM element count.
    const barCount = hasInternal && internal.barCount > 0
      ? internal.barCount
      : (dom ? dom.barCount : -1);

    if (isLoading) {
      stableCount = 0;
      await new Promise(r => setTimeout(r, POLL_INTERVAL));
      continue;
    }

    if (expectedSymbol && currentSymbol) {
      if (currentSymbol.toUpperCase().includes(expectedSymbol.toUpperCase())) {
        symbolMatched = true;
      } else {
        stableCount = 0;
        await new Promise(r => setTimeout(r, POLL_INTERVAL));
        continue;
      }
    }

    if (barCount === lastBarCount && barCount > 0) stableCount++;
    else stableCount = 0;
    lastBarCount = barCount;

    // When the internal handle is reachable, also require a real last-bar
    // timestamp before declaring ready. Otherwise trust the DOM heuristic alone.
    const dataConfirmed = hasInternal ? hasLastBar : true;

    if (stableCount >= 2 && dataConfirmed) {
      return {
        ready: true,
        reason: hasInternal
          ? 'confirmed via internal chart API (last bar present, bar count stable)'
          : 'confirmed via DOM heuristic (bar count stable, no loader)',
        waited_ms: Date.now() - start,
        symbol_matched: symbolMatched,
        bar_count: barCount,
      };
    }

    await new Promise(r => setTimeout(r, POLL_INTERVAL));
  }

  return {
    ready: false,
    reason: 'timeout: chart did not stabilize',
    waited_ms: Date.now() - start,
    symbol_matched: symbolMatched,
    bar_count: lastBarCount > 0 ? lastBarCount : 0,
  };
}
