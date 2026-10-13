/**
 * Tests for the file change service (src/core/filesystem/fileChangeService.ts):
 * typed fan-out, disposal, listener isolation, and refresh requests.
 *
 * Run with: npx tsx tests/fileChangeService.test.ts
 */
import { check, finish } from './_harness';
import {
    subscribeFileChanges,
    emitFileChange,
    requestExplorerRefresh,
    subscribeExplorerRefresh,
    fileChangeListenerCount,
} from '../src/core/filesystem/fileChangeService';

const disposers: Array<() => void> = [];
const after = () => {
    while (disposers.length > 0) disposers.pop()!();
};
const counts = () => fileChangeListenerCount();

// Publish/subscribe with disposal.
const seen: string[] = [];
disposers.push(subscribeFileChanges((e) => {
    seen.push(`${e.kind}:${e.id}`);
}));
emitFileChange({ kind: 'created', id: 'n1', name: 'a.ts' });
emitFileChange({ kind: 'renamed', id: 'n1', name: 'b.ts', prevName: 'a.ts' });
check('subscribers receive change events in order', seen.join(',') === 'created:n1,renamed:n1');
check('listener registered', counts().changes === 1);
after();
check('dispose removes the listener', counts().changes === 0);
emitFileChange({ kind: 'deleted', id: 'n1', name: 'b.ts' });
check('disposed listener receives nothing further', seen.length === 2);

// One failing listener must not break the others.
const good: string[] = [];
disposers.push(subscribeFileChanges(() => {
    throw new Error('boom');
}));
disposers.push(subscribeFileChanges((e) => {
    good.push(e.id);
}));
emitFileChange({ kind: 'updated', id: 'n2', name: 'c.ts' });
check('failing listener is isolated; healthy listener still fires', good.join(',') === 'n2');
after();

// Refresh requests are typed and scoped separately from change events.
const reasons: string[] = [];
disposers.push(subscribeExplorerRefresh((r) => {
    reasons.push(r);
}));
requestExplorerRefresh('manual');
requestExplorerRefresh();
check('refresh subscribers receive reasons (default manual)', reasons.join(',') === 'manual,manual');
check('change listeners unaffected by refresh traffic', counts().changes === 0 && counts().refresh === 1);
after();
check('refresh dispose works', counts().refresh === 0);

finish('fileChangeService');
