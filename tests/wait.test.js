/**
 * Tests for waitForChartReady in src/wait.js.
 * Covers the structured result contract: ready:true when bars stabilize,
 * ready:false with a reason on timeout, and the internal-API confirmation path.
 * Uses the same dependency-injection mock pattern as tests/replay.test.js.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { waitForChartReady } from '../src/wait.js';

// ── Mock helpers ─────────────────────────────────────────────────────────

// The DOM heuristic script contains 'legend-source-title'; the internal-API
// script contains 'valueAt'. Route mock responses by matching those substrings.
function isInternal(expr) { return expr.includes('valueAt'); }
function isDom(expr) { return expr.includes('legend-source-title'); }

function mockEvaluate(handler) {
  const calls = [];
  const fn = async (expr) => { calls.push(expr); return handler(expr); };
  fn.calls = calls;
  return fn;
}

// ── ready:true ─────────────────────────────────────────────────────────────

describe('waitForChartReady — ready:true when bars stabilize', () => {
  it('confirms via DOM heuristic when internal API is unreachable', async () => {
    const evaluate = mockEvaluate((expr) => {
      if (isInternal(expr)) return null; // internal handle not reachable
      if (isDom(expr)) return { isLoading: false, barCount: 42, currentSymbol: 'AAPL' };
      return null;
    });
    const res = await waitForChartReady('AAPL', null, 5000, { evaluate });
    assert.equal(res.ready, true);
    assert.equal(res.bar_count, 42);
    assert.equal(res.symbol_matched, true);
    assert.match(res.reason, /DOM heuristic/);
    assert.ok(typeof res.waited_ms === 'number');
  });

  it('confirms via internal chart API when last-bar timestamp is present', async () => {
    const evaluate = mockEvaluate((expr) => {
      if (isInternal(expr)) return { barCount: 500, lastBarTime: 1700000000 };
      if (isDom(expr)) return { isLoading: false, barCount: 0, currentSymbol: '' };
      return null;
    });
    const res = await waitForChartReady(null, null, 5000, { evaluate });
    assert.equal(res.ready, true);
    assert.equal(res.bar_count, 500);
    assert.match(res.reason, /internal chart API/);
  });
});

// ── ready:false ──────────────────────────────────────────────────────────

describe('waitForChartReady — ready:false on timeout', () => {
  it('returns a reason when the chart never stabilizes', async () => {
    let n = 0;
    const evaluate = mockEvaluate((expr) => {
      if (isInternal(expr)) return null;
      // bar count keeps changing → stableCount never reaches threshold
      if (isDom(expr)) return { isLoading: false, barCount: ++n, currentSymbol: 'AAPL' };
      return null;
    });
    const res = await waitForChartReady('AAPL', null, 120, { evaluate });
    assert.equal(res.ready, false);
    assert.equal(res.reason, 'timeout: chart did not stabilize');
    assert.ok(res.waited_ms >= 0);
  });

  it('does not declare ready while a loader is visible', async () => {
    const evaluate = mockEvaluate((expr) => {
      if (isInternal(expr)) return null;
      if (isDom(expr)) return { isLoading: true, barCount: 42, currentSymbol: 'AAPL' };
      return null;
    });
    const res = await waitForChartReady('AAPL', null, 120, { evaluate });
    assert.equal(res.ready, false);
    assert.equal(res.reason, 'timeout: chart did not stabilize');
  });

  it('reports symbol_matched:false when the legend never matches', async () => {
    const evaluate = mockEvaluate((expr) => {
      if (isInternal(expr)) return null;
      if (isDom(expr)) return { isLoading: false, barCount: 42, currentSymbol: 'TSLA' };
      return null;
    });
    const res = await waitForChartReady('AAPL', null, 120, { evaluate });
    assert.equal(res.ready, false);
    assert.equal(res.symbol_matched, false);
  });
});
