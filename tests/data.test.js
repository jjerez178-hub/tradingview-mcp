/**
 * Tests for the verified/as_of freshness contract on the data readers in
 * src/core/data.js. Covers the readiness gate (happy path → verified:true,
 * timeout → verified:false + reason) and the direct-read stamps.
 * Uses the same dependency-injection mock pattern as tests/replay.test.js
 * and tests/wait.test.js.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  getOhlcv, getStudyValues, getQuote,
  getPineLines, getPineLabels, getPineTables, getPineBoxes,
  getStrategyResults, getTrades, getEquity, getIndicator,
} from '../src/core/data.js';

// ── Mock helpers ─────────────────────────────────────────────────────────

function ready() {
  return { ready: true, reason: 'confirmed via internal chart API', waited_ms: 5, symbol_matched: true, bar_count: 100 };
}
function notReady() {
  return { ready: false, reason: 'timeout: chart did not stabilize', waited_ms: 120, symbol_matched: false, bar_count: 0 };
}

function deps({ readiness = ready(), evaluate } = {}) {
  return { _deps: { evaluate, waitForChartReady: async () => readiness } };
}

const OHLCV_DATA = {
  bars: [
    { time: 1, open: 10, high: 12, low: 9, close: 11, volume: 100 },
    { time: 2, open: 11, high: 13, low: 10, close: 12, volume: 200 },
  ],
  total_bars: 2,
  source: 'direct_bars',
};

// ── getOhlcv() — readiness gate ────────────────────────────────────────────

describe('getOhlcv() — verified/as_of freshness gate', () => {
  it('verified:true with as_of when chart ready and read succeeds', async () => {
    const evaluate = async () => OHLCV_DATA;
    const result = await getOhlcv({ ...deps({ evaluate }) });
    assert.equal(result.success, true);
    assert.equal(result.verified, true, 'verified when chart ready');
    assert.ok(result.as_of, 'as_of timestamp present');
    assert.match(result.as_of, /^\d{4}-\d{2}-\d{2}T/, 'as_of is ISO string');
    assert.equal(result.reason, undefined, 'no reason when ready');
  });

  it('verified:false + reason when readiness times out but data still returned', async () => {
    const evaluate = async () => OHLCV_DATA;
    const result = await getOhlcv({ ...deps({ readiness: notReady(), evaluate }) });
    assert.equal(result.success, true, 'data still returned best-effort');
    assert.equal(result.bar_count, 2, 'bars present despite not-ready');
    assert.equal(result.verified, false, 'flagged not verified on timeout');
    assert.match(result.reason, /timeout/, 'readiness reason surfaced');
    assert.ok(result.as_of, 'as_of present even when stale');
  });

  it('summary mode also carries the freshness stamp', async () => {
    const evaluate = async () => OHLCV_DATA;
    const result = await getOhlcv({ summary: true, ...deps({ evaluate }) });
    assert.equal(result.verified, true);
    assert.ok(result.as_of);
    assert.equal(result.bar_count, 2);
  });

  it('throws only when no data at all (not merely not-ready)', async () => {
    const evaluate = async () => null;
    await assert.rejects(
      () => getOhlcv({ ...deps({ readiness: notReady(), evaluate }) }),
      /Could not extract OHLCV/,
    );
  });
});

// ── getQuote() — readiness gate ────────────────────────────────────────────

describe('getQuote() — verified/as_of freshness gate', () => {
  it('verified:true when ready', async () => {
    const evaluate = async () => ({ symbol: 'AAPL', last: 150, close: 150 });
    const result = await getQuote({ ...deps({ evaluate }) });
    assert.equal(result.verified, true);
    assert.ok(result.as_of);
  });

  it('verified:false + reason when not ready', async () => {
    const evaluate = async () => ({ symbol: 'AAPL', last: 150, close: 150 });
    const result = await getQuote({ ...deps({ readiness: notReady(), evaluate }) });
    assert.equal(result.verified, false);
    assert.match(result.reason, /timeout/);
    assert.ok(result.as_of);
  });
});

// ── getStudyValues() + pine graphics — readiness gate ──────────────────────

describe('getStudyValues() and pine readers — freshness gate', () => {
  it('getStudyValues stamps verified:true when ready', async () => {
    const evaluate = async () => [{ name: 'RSI', values: { RSI: 55 } }];
    const result = await getStudyValues({ ...deps({ evaluate }) });
    assert.equal(result.verified, true);
    assert.ok(result.as_of);
    assert.equal(result.study_count, 1);
  });

  it('getStudyValues flags verified:false on timeout', async () => {
    const evaluate = async () => [];
    const result = await getStudyValues({ ...deps({ readiness: notReady(), evaluate }) });
    assert.equal(result.verified, false);
    assert.match(result.reason, /timeout/);
  });

  for (const [name, fn] of [['getPineLines', getPineLines], ['getPineLabels', getPineLabels], ['getPineTables', getPineTables], ['getPineBoxes', getPineBoxes]]) {
    it(`${name} stamps freshness even on empty result`, async () => {
      const evaluate = async () => [];
      const result = await fn({ ...deps({ evaluate }) });
      assert.equal(result.verified, true, `${name} verified when ready`);
      assert.ok(result.as_of, `${name} as_of present`);
    });

    it(`${name} flags verified:false on timeout`, async () => {
      const evaluate = async () => [];
      const result = await fn({ ...deps({ readiness: notReady(), evaluate }) });
      assert.equal(result.verified, false);
      assert.match(result.reason, /timeout/);
    });
  }
});

// ── Direct readers — verified:true stamp ───────────────────────────────────

describe('direct readers — verified/as_of stamp', () => {
  it('getIndicator stamps verified:true on success', async () => {
    const evaluate = async () => ({ visible: true, inputs: [{ id: 'length', value: 14 }] });
    const result = await getIndicator({ entity_id: 'x', _deps: { evaluate } });
    assert.equal(result.verified, true);
    assert.ok(result.as_of);
  });

  it('getStrategyResults verified:false when read reports error', async () => {
    const evaluate = async () => ({ metrics: {}, source: 'internal_api', error: 'No strategy found' });
    const result = await getStrategyResults({ _deps: { evaluate } });
    assert.equal(result.verified, false, 'verified:false when strategy read errored');
    assert.ok(result.as_of);
  });

  it('getStrategyResults verified:true when metrics returned', async () => {
    const evaluate = async () => ({ metrics: { net_profit: 100 }, source: 'internal_api' });
    const result = await getStrategyResults({ _deps: { evaluate } });
    assert.equal(result.verified, true);
  });

  it('getTrades and getEquity stamp as_of', async () => {
    const evalTrades = async () => ({ trades: [{ price: 1 }], source: 'internal_api' });
    const t = await getTrades({ _deps: { evaluate: evalTrades } });
    assert.equal(t.verified, true);
    assert.ok(t.as_of);

    const evalEquity = async () => ({ data: [{ time: 1, equity: 100 }], source: 'internal_api' });
    const e = await getEquity({ _deps: { evaluate: evalEquity } });
    assert.equal(e.verified, true);
    assert.ok(e.as_of);
  });
});
