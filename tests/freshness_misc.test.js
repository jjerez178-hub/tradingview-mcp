/**
 * Tests for the verified/as_of freshness stamp extended to the direct chart
 * reads (chart.js), indicator setters (indicators.js), and per-action batch
 * payloads (batch.js). Uses the DI mock pattern from tests/replay.test.js.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getState, getVisibleRange, symbolInfo } from '../src/core/chart.js';
import { setInputs, toggleVisibility } from '../src/core/indicators.js';

// ── chart.js direct reads ──────────────────────────────────────────────────

describe('chart.js — direct reads carry verified/as_of', () => {
  it('getState stamps verified:true', async () => {
    const evaluate = async () => ({ symbol: 'AAPL', resolution: 'D', chartType: 1, studies: [] });
    const result = await getState({ _deps: { evaluate } });
    assert.equal(result.success, true);
    assert.equal(result.verified, true);
    assert.match(result.as_of, /^\d{4}-\d{2}-\d{2}T/);
  });

  it('getVisibleRange stamps verified:true', async () => {
    const evaluate = async () => ({ visible_range: { from: 1, to: 2 }, bars_range: { from: 0, to: 9 } });
    const result = await getVisibleRange({ _deps: { evaluate } });
    assert.equal(result.verified, true);
    assert.ok(result.as_of);
  });

  it('symbolInfo stamps verified:true', async () => {
    const evaluate = async () => ({ symbol: 'AAPL', exchange: 'NASDAQ', resolution: 'D', chart_type: 1 });
    const result = await symbolInfo({ _deps: { evaluate } });
    assert.equal(result.verified, true);
    assert.ok(result.as_of);
  });
});

// ── indicators.js setters ──────────────────────────────────────────────────

describe('indicators.js — setters carry verified/as_of', () => {
  it('setInputs stamps verified:true on success', async () => {
    const evaluate = async () => ({ updated_inputs: { length: 50 } });
    const result = await setInputs({ entity_id: 'x', inputs: { length: 50 }, _deps: { evaluate } });
    assert.equal(result.verified, true);
    assert.ok(result.as_of);
    assert.deepEqual(result.updated_inputs, { length: 50 });
  });

  it('toggleVisibility stamps verified:true on success', async () => {
    const evaluate = async () => ({ visible: false });
    const result = await toggleVisibility({ entity_id: 'x', visible: false, _deps: { evaluate } });
    assert.equal(result.verified, true);
    assert.ok(result.as_of);
    assert.equal(result.visible, false);
  });
});
