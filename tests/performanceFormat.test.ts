/**
 * Regression tests for the shared performance formatters
 * (src/utils/performanceAlerts.ts): formatTime/formatMemory are the single
 * source of truth consumed by PerformancePanel. Locks the display contract
 * so the consolidation never drifts.
 *
 * Run with: npx tsx tests/performanceFormat.test.ts
 */
import { check, finish } from './_harness';
import { formatTime, formatMemory } from '../src/utils/performanceAlerts';

check('formatTime: sub-second shows ms', formatTime(500) === '500ms');
check('formatTime: boundary 999ms', formatTime(999) === '999ms');
check('formatTime: seconds with 2 decimals', formatTime(1500) === '1.50s');
check('formatTime: minutes with 2 decimals', formatTime(90000) === '1.50m');
check('formatMemory: MB with 1 decimal', formatMemory(512) === '512.0MB');
check('formatMemory: GB boundary', formatMemory(2048) === '2.00GB');
check('formatMemory: just under 1GB stays MB', formatMemory(1023.9) === '1023.9MB');

finish('performanceFormat');
