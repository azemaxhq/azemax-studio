/**
 * Tests for the workspace model (src/core/workspace/workspaceModel.ts):
 * lifecycle status derivation, stable identity, and metadata merging.
 *
 * Run with: npx tsx tests/workspaceModel.test.ts
 */
import { check, finish } from './_harness';
import {
    deriveWorkspaceStatus,
    createWorkspaceMetadata,
    generateWorkspaceId,
    isWorkspaceActive,
    INITIAL_WORKSPACE_STATE,
} from '../src/core/workspace/workspaceModel';

// Status derivation: restoring is never confused with no-workspace.
check('restoring beats empty (loading is not missing)', deriveWorkspaceStatus({ initialized: true, restoring: true, busy: null, hasProject: false, error: null }) === 'restoring');
check('uninitialized boots to restoring, not no-workspace', deriveWorkspaceStatus({ initialized: false, restoring: false, busy: null, hasProject: false, error: null }) === 'restoring');
check('empty after restore is no-workspace', deriveWorkspaceStatus({ initialized: true, restoring: false, busy: null, hasProject: false, error: null }) === 'no-workspace');
check('content after restore is ready', deriveWorkspaceStatus({ initialized: true, restoring: false, busy: null, hasProject: true, error: null }) === 'ready');
check('creating beats ready signal', deriveWorkspaceStatus({ initialized: true, restoring: false, busy: 'creating', hasProject: false, error: null }) === 'creating');
check('importing beats ready signal', deriveWorkspaceStatus({ initialized: true, restoring: false, busy: 'importing', hasProject: true, error: null }) === 'importing');
check('error beats everything', deriveWorkspaceStatus({ initialized: true, restoring: true, busy: 'creating', hasProject: true, error: 'disk gone' }) === 'error');

// Active-workspace predicate.
check('ready/creating/importing/loading are active', isWorkspaceActive('ready') && isWorkspaceActive('creating') && isWorkspaceActive('importing') && isWorkspaceActive('loading'));
check('no-workspace/restoring/error/uninitialized are inactive', !isWorkspaceActive('no-workspace') && !isWorkspaceActive('restoring') && !isWorkspaceActive('error') && !isWorkspaceActive('uninitialized'));

// Stable identity: ids are unique; metadata merges preserve id/createdAt.
const a = generateWorkspaceId();
const b = generateWorkspaceId();
check('generated ids are unique non-empty strings', typeof a === 'string' && a.length > 0 && a !== b);
const m1 = createWorkspaceMetadata('my-app', 'blank', null, 1000);
check('fresh metadata carries id + origin + timestamps', !!m1.id && m1.origin === 'blank' && m1.createdAt === 1000 && m1.updatedAt === 1000 && m1.displayName === 'my-app');
const m2 = createWorkspaceMetadata('renamed', 'template', m1, 2000);
check('metadata merge preserves id/createdAt, refreshes name/time', m2.id === m1.id && m2.createdAt === 1000 && m2.displayName === 'renamed' && m2.updatedAt === 2000);
const m3 = createWorkspaceMetadata('x', 'import', { ...m1, origin: 'restored' }, 3000);
check('known origin is never overwritten by a later note', m3.origin === 'restored');
check('initial state is uninitialized with no metadata', INITIAL_WORKSPACE_STATE.status === 'uninitialized' && INITIAL_WORKSPACE_STATE.metadata === null);

finish('workspaceModel');
