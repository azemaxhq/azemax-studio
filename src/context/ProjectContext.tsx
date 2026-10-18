/* eslint-disable react-refresh/only-export-components */
import React, { createContext, useContext, useState, useEffect, useCallback, useRef, useMemo, memo, type ReactNode } from 'react';
import { initialFileTree, type FileNode } from '../utils/mockFileSystem';
import { ROOT_NODE_ID } from '../utils/mockFileSystem';
import { debouncedLocalStorageSet } from '../utils/localStorageDebounce';
import { nsGetItem, nsSetItem, nsRemoveItem, namespacedKey, getStorageGeneration } from '../utils/userStorage';
import { getSettings, useSettingsStore } from '../settings/settingsStore';
import { useAuthOptional } from './AuthContext';
import { useAccountWorkspaceSync, type WorkspaceCloudSync } from '../hooks/useAccountWorkspaceSync';
import {
    FILE_TREE_KEY as STORAGE_KEY,
    LEGACY_FILE_TREE_KEY as LEGACY_STORAGE_KEY,
    loadWorkspaceRecord,
    saveWorkspaceRecord,
    type WorkspaceRecord,
} from '../core/workspace/workspaceStorage';
import {
    createFile as opCreateFile,
    createFolder as opCreateFolder,
    ensureFolderPath,
    renameNode as opRenameNode,
    moveNode as opMoveNode,
    copyNode as opCopyNode,
    duplicateNode as opDuplicateNode,
    deleteNode as opDeleteNode,
    updateFileContent as opUpdateFileContent,
    collectFolderIds,
    repairFileTree,
    validateFileTree,
    emitFileChange,
} from '../core/filesystem';
import type { RepairResult, TreeOperationResult } from '../core/filesystem';
import {
    deriveWorkspaceStatus,
    createWorkspaceMetadata,
    generateWorkspaceId,
    type WorkspaceMetadata,
    type WorkspaceOrigin,
    type WorkspaceStatus,
} from '../core/workspace/workspaceModel';
import { noopResult } from '../core/filesystem';
import { findNodeById, resolvePath, isDescendantOf, findChildByName, pathOf } from '../utils/safeTree';
import { setActiveEditor as syncActiveEditor, getActiveEditor as getSyncedEditor, getActiveMonaco as getSyncedMonaco, updateActiveFileMeta } from '../core/editor/activeEditorStore';

const ACTIVE_FILE_KEY = 'azemax-active-file-id';
const LEGACY_ACTIVE_FILE_KEY = 'deepcontext-active-file-id';
const EXPANDED_KEY = 'azemax-expanded-folders';
const LEGACY_EXPANDED_KEY = 'deepcontext-expanded-folders';
const OPEN_FILES_KEY = 'azemax-open-files';

// AI error sentinels must never be persisted as file content — if a previous
// bug wrote an error string into a file, treat it as corruption and reset.
const CORRUPT_CONTENT_RE = /^\s*AI is temporarily unavailable\. Please try again.*$/;
const EMPTY_RESPONSE_RE = /^\s*The AI returned an empty response\. Please try again\.?\s*$/;

function isCorruptFileContent(content: unknown): boolean {
    return typeof content === 'string' && (CORRUPT_CONTENT_RE.test(content) || EMPTY_RESPONSE_RE.test(content));
}

function sanitizeCorruptTree(tree: FileNode[]): { tree: FileNode[]; hadCorruption: boolean } {
    let hadCorruption = false;
    const clean = (nodes: FileNode[]): FileNode[] =>
        nodes.map(n => {
            if (n.type === 'file' && isCorruptFileContent(n.content)) {
                hadCorruption = true;
                return { ...n, content: '' };
            }
            if (n.children) return { ...n, children: clean(n.children) };
            return n;
        });
    return { tree: clean(tree), hadCorruption };
}

// Load file tree from localStorage. The saved data is untrusted (it may be
// hand-edited, stale, or corrupt), so it goes through a strict pipeline:
//   raw stored data → repair → validate → sanitize error sentinels → runtime tree
// Corruption is repaired deterministically ONCE at this boundary; a repaired
// tree is immediately persisted so the bad copy never re-enters the runtime.
//
// Absent storage is NOT a fallback project: it yields the explicit
// no-workspace state (empty tree) and persists nothing. A workspace comes
// into existence only through an explicit create/import action or through
// restoring previously persisted user content.
const loadFileTree = (): RepairResult => {
    try {
        const saved = nsGetItem(STORAGE_KEY, [LEGACY_STORAGE_KEY]);
        if (saved) {
            const repaired = repairFileTree(JSON.parse(saved));
            const sanitized = sanitizeCorruptTree(repaired.tree);
            const finalTree = sanitized.hadCorruption || repaired.repaired ? sanitized.tree : repaired.tree;
            if (sanitized.hadCorruption || repaired.repaired) {
                saveFileTree(finalTree, true);
            }
            return { tree: finalTree, repaired: repaired.repaired || sanitized.hadCorruption, expansion: repaired.expansion } as RepairResult;
        }
    } catch (e) {
        console.warn('Failed to load file tree from localStorage:', e);
    }
    return { tree: [...initialFileTree], expansion: new Set<string>(), repaired: false };
};

// Save file tree to localStorage (coalesced writes to avoid main-thread
// blocking). `immediate` forces a synchronous write — used exactly once when a
// corrupted tree has been repaired at the load boundary.
const saveFileTree = (tree: FileNode[], immediate = false) => {
    try {
        const serialized = JSON.stringify(tree);
        if (immediate) {
            nsSetItem(STORAGE_KEY, serialized);
        } else {
            debouncedLocalStorageSet(namespacedKey(STORAGE_KEY), serialized, 0);
        }
    } catch (e) {
        console.warn('Failed to save file tree to localStorage:', e);
    }
};

// File templates for different languages and frameworks
const FILE_TEMPLATES: Record<string, { content: string; description: string }> = {
    'javascript': {
        content: `// JavaScript File\n\nconsole.log('Hello, World!');\n`,
        description: 'Basic JavaScript file'
    },
    'typescript': {
        content: `// TypeScript File\n\nconsole.log('Hello, TypeScript!');\n`,
        description: 'Basic TypeScript file'
    },
    'react-component': {
        content: `import React from 'react';\n\ninterface Props {\n  // Define your props here\n}\n\nexport const ComponentName: React.FC<Props> = (props) => {\n  return (\n    <div>\n      <h1>Hello, React!</h1>\n    </div>\n  );\n};\n\nexport default ComponentName;\n`,
        description: 'React functional component'
    },
    'react-hook': {
        content: `import { useState, useEffect } from 'react';\n\nexport const useCustomHook = () => {\n  const [state, setState] = useState<any>(null);\n\n  useEffect(() => {\n    // Hook logic here\n  }, []);\n\n  return { state, setState };\n};\n`,
        description: 'React custom hook'
    },
    'node-module': {
        content: `// Node.js Module\n\nconst express = require('express');\nconst router = express.Router();\n\n// GET /api/endpoint\nrouter.get('/', (req, res) => {\n  res.json({ message: 'Hello, World!' });\n});\n\nmodule.exports = router;\n`,
        description: 'Node.js Express module'
    },
    'python': {
        content: `#!/usr/bin/env python3\n\ndef main():\n    print("Hello, Python!")\n\nif __name__ == "__main__":\n    main()\n`,
        description: 'Basic Python script'
    },
    'python-class': {
        content: `#!/usr/bin/env python3\n\nclass ClassName:\n    def __init__(self, param1, param2):\n        self.param1 = param1\n        self.param2 = param2\n\n    def method(self):\n        return f"Hello from {self.param1}"\n\nif __name__ == "__main__":\n    obj = ClassName("value1", "value2")\n    print(obj.method())\n`,
        description: 'Python class'
    },
    'html': {
        content: `<!DOCTYPE html>\n<html lang="en">\n<head>\n    <meta charset="UTF-8">\n    <meta name="viewport" content="width=device-width, initial-scale=1.0">\n    <title>Document</title>\n    <link rel="stylesheet" href="styles.css">\n</head>\n<body>\n    <h1>Hello, World!</h1>\n    <script src="script.js"></script>\n</body>\n</html>\n`,
        description: 'HTML5 document'
    },
    'css': {
        content: `/* CSS Styles */\n\n* {\n    margin: 0;\n    padding: 0;\n    box-sizing: border-box;\n}\n\nbody {\n    font-family: Arial, sans-serif;\n    line-height: 1.6;\n}\n\n.container {\n    max-width: 1200px;\n    margin: 0 auto;\n    padding: 20px;\n}\n`,
        description: 'CSS stylesheet'
    },
    'package.json': {
        content: `{\n  "name": "my-project",\n  "version": "1.0.0",\n  "description": "A new project",\n  "main": "index.js",\n  "scripts": {\n    "start": "node index.js",\n    "dev": "nodemon index.js",\n    "test": "jest"\n  },\n  "keywords": [],\n  "author": "",\n  "license": "ISC",\n  "dependencies": {},\n  "devDependencies": {}\n}\n`,
        description: 'Node.js package.json'
    },
    'tsconfig.json': {
        content: `{\n  "compilerOptions": {\n    "target": "ES2020",\n    "module": "commonjs",\n    "lib": ["ES2020"],\n    "outDir": "./dist",\n    "rootDir": "./src",\n    "strict": true,\n    "esModuleInterop": true,\n    "skipLibCheck": true,\n    "forceConsistentCasingInFileNames": true\n  },\n  "include": ["src/**/*"],\n  "exclude": ["node_modules", "dist"]\n}\n`,
        description: 'TypeScript configuration'
    },
    'markdown': {
        content: `# Project Title\n\n## Description\n\nA brief description of the project.\n\n## Installation\n\n\`\`\`bash\nnpm install\n\`\`\`\n\n## Usage\n\n\`\`\`bash\nnpm start\n\`\`\`\n\n## License\n\nMIT\n`,
        description: 'Markdown documentation'
    },
    'gitignore': {
        content: `# Dependencies\nnode_modules/\n\n# Build outputs\ndist/\nbuild/\n*.log\n\n# Environment variables\n.env\n.env.local\n.env.production\n\n# IDE files\n.vscode/\n.idea/\n\n# OS files\n.DS_Store\nThumbs.db\n`,
        description: 'Git ignore file'
    }
};

// Get template based on file name and context
const getFileTemplate = (fileName: string, parentPath?: string): { content: string; description: string } => {
    const ext = fileName.split('.').pop()?.toLowerCase();
    const name = fileName.toLowerCase();

    if (name === 'package.json') return FILE_TEMPLATES['package.json'];
    if (name === 'tsconfig.json') return FILE_TEMPLATES['tsconfig.json'];
    if (name === '.gitignore') return FILE_TEMPLATES['gitignore'];

    if (name.endsWith('.tsx') || name.endsWith('.jsx')) {
        if (name.includes('hook') || name.includes('use')) {
            return FILE_TEMPLATES['react-hook'];
        }
        return FILE_TEMPLATES['react-component'];
    }

    if (ext === 'ts') return FILE_TEMPLATES['typescript'];
    if (ext === 'js') return FILE_TEMPLATES['javascript'];

    if (ext === 'html') return FILE_TEMPLATES['html'];
    if (ext === 'css') return FILE_TEMPLATES['css'];

    if (ext === 'py') {
        if (name.includes('class') || parentPath?.includes('classes')) {
            return FILE_TEMPLATES['python-class'];
        }
        return FILE_TEMPLATES['python'];
    }

    if (ext === 'md') return FILE_TEMPLATES['markdown'];

    return { content: '', description: 'Empty file' };
};

// Project templates for scaffolding
const PROJECT_TEMPLATES: Record<string, { files: { name: string; content: string }[]; description: string }> = {
    'react-app': {
        description: 'React application with TypeScript',
        files: [
            { name: 'package.json', content: `\n{\n  "name": "react-app",\n  "version": "1.0.0",\n  "private": true,\n  "dependencies": {\n    "react": "^18.2.0",\n    "react-dom": "^18.2.0",\n    "react-scripts": "5.0.1",\n    "typescript": "^4.9.5"\n  },\n  "scripts": {\n    "start": "react-scripts start",\n    "build": "react-scripts build",\n    "test": "react-scripts test",\n    "eject": "react-scripts eject"\n  },\n  "devDependencies": {\n    "@types/react": "^18.2.0",\n    "@types/react-dom": "^18.2.0"\n  }\n}\n` },
            { name: 'tsconfig.json', content: `\n{\n  "compilerOptions": {\n    "target": "es5",\n    "lib": ["dom", "dom.iterable", "es6"],\n    "allowJs": true,\n    "skipLibCheck": true,\n    "esModuleInterop": true,\n    "allowSyntheticDefaultImports": true,\n    "strict": true,\n    "forceConsistentCasingInFileNames": true,\n    "noFallthroughCasesInSwitch": true,\n    "module": "esnext",\n    "moduleResolution": "node",\n    "resolveJsonModule": true,\n    "isolatedModules": true,\n    "noEmit": true,\n    "jsx": "react-jsx"\n  },\n  "include": ["src"]\n}\n` },
            { name: 'src/App.tsx', content: `\nimport React from 'react';\nimport './App.css';\n\nfunction App() {\n  return (\n    <div className="App">\n      <header className="App-header">\n        <h1>Welcome to React App</h1>\n      </header>\n    </div>\n  );\n}\n\nexport default App;\n` },
            { name: 'src/App.css', content: `\n.App {\n  text-align: center;\n}\n\n.App-header {\n  background-color: #282c34;\n  padding: 20px;\n  color: white;\n}\n` },
            { name: 'src/index.tsx', content: `\nimport React from 'react';\nimport ReactDOM from 'react-dom/client';\nimport './index.css';\nimport App from './App';\n\nconst root = ReactDOM.createRoot(\n  document.getElementById('root') as HTMLElement\n);\nroot.render(\n  <React.StrictMode>\n    <App />\n  </React.StrictMode>\n);\n` },
            { name: 'src/index.css', content: `\nbody {\n  margin: 0;\n  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen',\n    'Ubuntu', 'Cantarell', 'Fira Sans', 'Droid Sans', 'Helvetica Neue',\n    sans-serif;\n  -webkit-font-smoothing: antialiased;\n  -moz-osx-font-smoothing: grayscale;\n}\n\ncode {\n  font-family: source-code-pro, Menlo, Monaco, Consolas, 'Courier New',\n    monospace;\n}\n` },
            { name: 'public/index.html', content: `\n<!DOCTYPE html>\n<html lang="en">\n  <head>\n    <meta charset="utf-8" />\n    <meta name="viewport" content="width=device-width, initial-scale=1" />\n    <title>React App</title>\n  </head>\n  <body>\n    <div id="root"></div>\n  </body>\n</html>\n` }
        ]
    },
    'node-api': {
        description: 'Node.js REST API with Express',
        files: [
            { name: 'package.json', content: `\n{\n  "name": "node-api",\n  "version": "1.0.0",\n  "description": "Node.js REST API",\n  "main": "server.js",\n  "scripts": {\n    "start": "node server.js",\n    "dev": "nodemon server.js",\n    "test": "jest"\n  },\n  "dependencies": {\n    "express": "^4.18.2",\n    "cors": "^2.8.5",\n    "helmet": "^7.0.0",\n    "morgan": "^1.10.0"\n  },\n  "devDependencies": {\n    "nodemon": "^3.0.1",\n    "jest": "^29.6.0"\n  }\n}\n` },
            { name: 'server.js', content: `\nconst express = require('express');\nconst cors = require('cors');\nconst helmet = require('helmet');\nconst morgan = require('morgan');\n\nconst app = express();\nconst PORT = process.env.PORT || 3000;\n\n// Middleware\napp.use(helmet());\napp.use(cors());\napp.use(morgan('combined'));\napp.use(express.json());\napp.use(express.urlencoded({ extended: true }));\n\n// Routes\napp.get('/api/health', (req, res) => {\n  res.json({ status: 'OK', message: 'API is running' });\n});\n\napp.use('/api', require('./routes/api'));\n\n// Error handling\napp.use((err, req, res, next) => {\n  console.error(err.stack);\n  res.status(500).json({ error: 'Something went wrong!' });\n});\n\napp.listen(PORT, () => {\n  console.log(\`Server is running on port \${PORT}\`);\n});\n` },
            { name: 'routes/api.js', content: `\nconst express = require('express');\nconst router = express.Router();\n\n// GET /api/users\nrouter.get('/users', (req, res) => {\n  res.json([\n    { id: 1, name: 'John Doe', email: 'john@example.com' },\n    { id: 2, name: 'Jane Smith', email: 'jane@example.com' }\n  ]);\n});\n\n// POST /api/users\nrouter.post('/users', (req, res) => {\n  const { name, email } = req.body;\n  // Create user logic here\n  res.status(201).json({ id: 3, name, email });\n});\n\nmodule.exports = router;\n` },
            { name: '.env.example', content: `\nPORT=3000\nNODE_ENV=development\n` },
            { name: '.gitignore', content: `\nnode_modules/\n.env\n.env.local\n.env.production\nlogs/\n*.log\n` }
        ]
    },
    'python-app': {
        description: 'Python application with structure',
        files: [
            { name: 'main.py', content: `\n#!/usr/bin/env python3\n\nfrom src.app import App\nfrom src.config import Config\n\ndef main():\n    config = Config()\n    app = App(config)\n    app.run()\n\nif __name__ == "__main__":\n    main()\n` },
            { name: 'src/app.py', content: `\nclass App:\n    def __init__(self, config):\n        self.config = config\n        self.name = "Python App"\n    \n    def run(self):\n        print(f"Running {self.name}...")\n        # Your application logic here\n\nif __name__ == "__main__":\n    App(None).run()\n` },
            { name: 'src/config.py', content: `\nclass Config:\n    def __init__(self):\n        self.debug = True\n        self.host = "localhost"\n        self.port = 8000\n    \n    @property\n    def database_url(self):\n        return "sqlite:///app.db"\n` },
            { name: 'requirements.txt', content: `\nflask==2.3.0\nrequests==2.31.0\npython-dotenv==1.0.0\n` },
            { name: '.gitignore', content: `\n__pycache__/\n*.pyc\n.env\n.venv/\nvenv/\n*.egg-info/\n` }
        ]
    }
};

interface ProjectFileState {
    fileTree: FileNode[];
    activeFile: FileNode | null;
    modifiedFiles: Set<string>;
    openFiles: FileNode[];
}

interface ProjectUIState {
    selectedFolder: string | null;
    selectedNodeId: string | null;
    creationState: { type: 'file' | 'folder' | null; parentId: string | null; isActive: boolean };
    selectedNodes: Set<string>;
    clipboard: { nodeIds: string[]; mode: 'cut' | 'copy' } | null;
    activeFileMeta: { id: string; name: string } | null;
    expandedFolderIds: Set<string>;
}

interface ProjectActions {
    setActiveFile: (file: FileNode) => void;
    closeFile: (fileId: string) => void;
    setSelectedFolder: (folderId: string | null) => void;
    setSelectedNode: (nodeId: string | null) => void;
    toggleFolder: (folderId: string) => void;
    createFile: (path: string, content?: string) => TreeOperationResult;
    createFolder: (path: string) => TreeOperationResult;
    createNestedFolders: (path: string) => TreeOperationResult;
    createFileInFolder: (parentId: string, name: string, content?: string) => TreeOperationResult;
    createFolderInFolder: (parentId: string, name: string) => TreeOperationResult;
    ensureFolderUnder: (parentId: string, path: string) => TreeOperationResult;
    createProjectTemplate: (template: string, name: string) => void;
    deleteNode: (id: string) => void;
    updateFileContent: (fileId: string, content: string) => TreeOperationResult;
    startCreating: (type: 'file' | 'folder', parentId?: string) => void;
    cancelCreation: () => void;
    commitCreation: (name: string) => void;
    renameNode: (id: string, newName: string) => TreeOperationResult;
    collapseAll: () => void;
    expandAll: () => void;
    moveNode: (sourceId: string, targetFolderId: string) => TreeOperationResult;
    toggleSelection: (id: string, multi: boolean) => void;
    selectRange: (startId: string, endId: string, allVisibleNodes: string[]) => void;
    selectAll: (allVisibleNodes: string[]) => void;
    deleteMultipleNodes: (ids: string[]) => void;
    clearSelection: () => void;
    cutNodes: (ids: string[]) => void;
    copyNodes: (ids: string[]) => void;
    pasteNodes: (targetFolderId: string) => void;
    duplicateNode: (id: string) => TreeOperationResult;
    expandRecursively: (folderId: string) => void;
    getFileTree: () => FileNode[];
    getActiveFile: () => FileNode | null;
    /** Record how the workspace came into existence (provenance tracking). */
    noteWorkspaceOrigin: (origin: WorkspaceOrigin) => void;
    /** Mark creation/import work in progress (drives lifecycle status). */
    setWorkspaceBusy: (busy: 'creating' | 'importing' | null) => void;
}

const ProjectFileContext = createContext<ProjectFileState | undefined>(undefined);
const ProjectUIContext = createContext<ProjectUIState | undefined>(undefined);
const ProjectActionsContext = createContext<ProjectActions | undefined>(undefined);

// Workspace state context — tracks the current workspace lifecycle phase plus
// stable workspace identity (see core/workspace/workspaceModel.ts). `state`
// keeps the legacy values existing consumers rely on; `status` is the full
// lifecycle vocabulary (`restoring` is distinct from `no-workspace`), and
// `metadata` carries the stable id/display name (null when no workspace).
const WorkspaceStateContext = createContext<{
    state: 'no-project' | 'project-loaded' | 'project-creating' | 'project-importing' | 'project-loading' | 'project-failed';
    status: WorkspaceStatus;
    metadata: WorkspaceMetadata | null;
    projectName: string | null;
    projectType: string | null;
    cloudSync: WorkspaceCloudSync;
} | undefined>(undefined);

// Persisted workspace record (stable identity + provenance) lives in
// core/workspace/workspaceStorage so account sync and the runtime agree on the
// schema and per-user keys.

// The initial load is computed once and shared across the (possibly twice-run)
// StrictMode initializers, so the repair + immediate-persist boundary is hit
// exactly once per app boot. The cache is invalidated whenever the signed-in
// account changes, so it can never hand one user's tree to another.
let initialLoadCache: RepairResult | null = null;
let initialLoadCacheKey = '';
const getInitialLoad = (): RepairResult => {
    const cacheKey = `${getStorageGeneration()}`;
    if (!initialLoadCache || initialLoadCacheKey !== cacheKey) {
        initialLoadCache = loadFileTree();
        initialLoadCacheKey = cacheKey;
    }
    return initialLoadCache;
};

/** Apply an operation against the latest committed tree (same-tick accurate). */
const useTreeMutation = (
    latestTreeRef: React.MutableRefObject<FileNode[]>,
    setFileTree: React.Dispatch<React.SetStateAction<FileNode[]>>,
) =>
    useCallback((op: (tree: FileNode[]) => TreeOperationResult): TreeOperationResult => {
        const result = op(latestTreeRef.current);
        if (result.changed && !result.error) {
            latestTreeRef.current = result.tree;
            setFileTree(result.tree);
        } else if (result.error && import.meta.env.DEV) {
            console.warn(
                `[FileTree] Rejected mutation (${result.error.code}): ${result.error.message}`,
            );
        }
        return result;
    }, [latestTreeRef, setFileTree]);

export const ProjectProvider: React.FC<{ children: ReactNode }> = memo(({ children }) => {
    const auth = useAuthOptional();
    const saveWorkspaceState = useSettingsStore((s) => s.privacy.saveWorkspaceState);
    const initial = getInitialLoad();
    const [fileTree, setFileTree] = useState<FileNode[]>(initial.tree);
    // Bootstrapping phase: the tree itself loads synchronously above, but
    // expansion/active-file hydration settles in effects below. Until then the
    // lifecycle reports `restoring` — never `no-workspace` — so the UI cannot
    // mistake "not loaded yet" for "empty". Idempotent under StrictMode.
    const [restoring, setRestoring] = useState(true);
    useEffect(() => {
        setRestoring(false);
    }, []);
    // Explicit creation/import operations in progress (set by Onboarding and
    // template flows via setWorkspaceBusy).
    const [busy, setBusyState] = useState<'creating' | 'importing' | null>(null);
    // Stable workspace identity, persisted per user namespace. Loaded (never
    // created) here; creation happens in the effect below, only while a real
    // project exists.
    const [metaRecord, setMetaRecord] = useState<WorkspaceRecord | null>(() => loadWorkspaceRecord());
    const originRef = useRef<WorkspaceOrigin>('unknown');
    // Whether the boot tree already held real content (restored workspace).
    const bootContentRef = useRef(initial.tree.some((n) => n.id !== ROOT_NODE_ID));
    // Wall-clock of the last committed tree mutation (effect, never render).
    // Seeded from the persisted record so a reload compares against the cloud
    // project honestly instead of always looking "newer" than it is.
    const [workspaceUpdatedAt, setWorkspaceUpdatedAt] = useState<number>(() => loadWorkspaceRecord()?.updatedAt ?? 0);
    const firstTreeSeenRef = useRef(false);
    const remoteApplyRef = useRef<{ json: string; updatedAt: number } | null>(null);
    useEffect(() => {
        if (!firstTreeSeenRef.current) {
            firstTreeSeenRef.current = true;
            return;
        }
        // A tree just restored from the cloud is not a local mutation; keep the
        // server timestamp so the next reconciliation does not think this device
        // is newer merely because it rendered the pull. Consume the marker even
        // if the content did not change, otherwise a later identical tree could
        // be misclassified as a remote application.
        const remoteApply = remoteApplyRef.current;
        if (remoteApply) {
            remoteApplyRef.current = null;
            if (JSON.stringify(fileTree) === remoteApply.json) {
                setWorkspaceUpdatedAt(remoteApply.updatedAt);
                return;
            }
        }
        const now = Date.now();
        setWorkspaceUpdatedAt(now);
        setMetaRecord((prev) => {
            if (!prev) return prev;
            const next = { ...prev, updatedAt: now };
            saveWorkspaceRecord(next);
            return next;
        });
    }, [fileTree]);
    const [expandedFolderIds, setExpandedFolderIds] = useState<Set<string>>(() => {
        try {
            const saved = nsGetItem(EXPANDED_KEY, [LEGACY_EXPANDED_KEY]);
            if (saved) {
                const parsed = JSON.parse(saved);
                if (Array.isArray(parsed)) {
                    const set = new Set<string>(parsed.filter((id: unknown) => typeof id === 'string'));
                    set.add(ROOT_NODE_ID);
                    // prune ids that no longer exist in current tree (prevents stuck collapsed)
                    const validIds = new Set(collectFolderIds(initial.tree));
                    validIds.add(ROOT_NODE_ID);
                    for (const id of Array.from(set)) if (!validIds.has(id)) set.delete(id);
                    return set;
                }
            }
        } catch { /* ignore */ }
        const set = new Set<string>(initial.expansion);
        set.add(ROOT_NODE_ID);
        return set;
    });
    const [activeFile, setActiveFileState] = useState<FileNode | null>(() => {
        const savedActiveId = nsGetItem(ACTIVE_FILE_KEY, [LEGACY_ACTIVE_FILE_KEY]);
        if (savedActiveId) {
            const node = findNodeById(initial.tree, savedActiveId);
            if (node && node.type === 'file') return node;
        }
        return null;
    });
    const [activeFileMeta, setActiveFileMeta] = useState<{ id: string; name: string } | null>(() =>
        activeFile ? { id: activeFile.id, name: activeFile.name } : null
    );
    const [selectedFolder, setSelectedFolderState] = useState<string | null>(ROOT_NODE_ID);
    const [selectedNodeId, setSelectedNodeState] = useState<string | null>(null);
    const [creationState, setCreationState] = useState<{ type: 'file' | 'folder' | null; parentId: string | null; isActive: boolean }>({
        type: null,
        parentId: null,
        isActive: false
    });
    const [selectedNodes, setSelectedNodes] = useState<Set<string>>(new Set());
    const [clipboard, setClipboard] = useState<{ nodeIds: string[]; mode: 'cut' | 'copy' } | null>(null);
    const [modifiedFiles, setModifiedFiles] = useState<Set<string>>(new Set());
    const [openFileIds, setOpenFileIds] = useState<string[]>(() => {
        try {
            const saved = nsGetItem(OPEN_FILES_KEY);
            if (saved) {
                const parsed = JSON.parse(saved);
                if (Array.isArray(parsed) && parsed.length > 0) {
                    const valid = parsed.filter(id => {
                        const node = findNodeById(initial.tree, id);
                        return node && node.type === 'file';
                    });
                    if (valid.length > 0) return valid;
                }
            }
        } catch { /* ignore */ }
        return activeFile ? [activeFile.id] : [];
    });

    // Latest-state ref so every action stays referentially stable while still
    // reading the freshest tree/active file/selection. `latestTreeRef` is the
    // ONLY authoritative mutable tree handle: it is advanced synchronously by
    // applyTreeMutation, so batched operations in one tick never collide.
    const latestTreeRef = useRef<FileNode[]>(fileTree);
    const stateRef = useRef({ fileTree, activeFile, selectedFolder, selectedNodeId, creationState, clipboard, expandedFolderIds });
    useEffect(() => {
        stateRef.current = { fileTree, activeFile, selectedFolder, selectedNodeId, creationState, clipboard, expandedFolderIds };
    });

    // Detect workspace state: "no-project" when the tree holds no real content
    // (empty tree, or only an empty synthetic root container — e.g. the legacy
    // placeholder — which repair collapses to []). The canonical model stores
    // real content as TOP-LEVEL SIBLINGS of the root node
    // (root.children is always empty at runtime), so siblings are the signal.
    // Depends on `fileTree` state (not the mutable ref) so the value
    // recomputes on every committed mutation — creating the first file or
    // folder flips the workspace into 'project-loaded' on the same render.
    const topLevelNodes = useMemo(
        () => fileTree.filter((n) => n.id !== ROOT_NODE_ID),
        [fileTree],
    );
    const hasProject = topLevelNodes.length > 0;

    // Create the stable workspace record on first sight of a real project —
    // never for the empty state. The storage re-read makes the StrictMode
    // double-effect idempotent (second run adopts the first run's id).
    useEffect(() => {
        if (!hasProject) return;
        if (metaRecord) {
            if (metaRecord.origin === 'unknown' && originRef.current !== 'unknown') {
                const updated = { ...metaRecord, origin: originRef.current };
                saveWorkspaceRecord(updated);
                setMetaRecord(updated);
            }
            return;
        }
        const existing = loadWorkspaceRecord();
        if (existing) {
            setMetaRecord(existing);
            return;
        }
        const record: WorkspaceRecord = {
            id: generateWorkspaceId(),
            createdAt: Date.now(),
            updatedAt: workspaceUpdatedAt || Date.now(),
            origin: originRef.current !== 'unknown' ? originRef.current : (bootContentRef.current ? 'restored' : 'unknown'),
        };
        saveWorkspaceRecord(record);
        setMetaRecord(record);
    }, [hasProject, metaRecord, workspaceUpdatedAt]);

    // Human-readable project name: the single top-level entry's name. With
    // several top-level roots there is no single project name — report null.
    const projectName = useMemo(() => {
        if (topLevelNodes.length !== 1) return null;
        return topLevelNodes[0].name || null;
    }, [topLevelNodes]);

    // Project-type hint from file-extension distribution across the whole tree.
    const projectType = useMemo(() => {
        if (!hasProject) return null;
        const extCounts = new Map<string, number>();
        const collectExts = (nodes: FileNode[]): void => {
            for (const n of nodes) {
                if (n.type === 'file' && n.name) {
                    const ext = n.name.split('.').pop()?.toLowerCase() ?? '';
                    if (ext) extCounts.set(ext, (extCounts.get(ext) ?? 0) + 1);
                }
                if (n.children) collectExts(n.children);
            }
        };
        collectExts(topLevelNodes);
        if (extCounts.size === 0) return null;
        const extToType: Record<string, string> = {
            'tsx': 'React + TypeScript', 'ts': 'React + TypeScript', 'jsx': 'React + TypeScript',
            'js': 'JavaScript', 'py': 'Python', 'java': 'Java', 'cpp': 'C++', 'c': 'C',
            'go': 'Go', 'rs': 'Rust', 'rb': 'Ruby', 'php': 'PHP',
        };
        const typeCounts: Record<string, number> = {};
        for (const [ext, count] of extCounts) {
            const type = extToType[ext];
            if (type) typeCounts[type] = (typeCounts[type] ?? 0) + count;
        }
        if (Object.keys(typeCounts).length === 0) return null;
        return Object.entries(typeCounts).sort((a, b) => b[1] - a[1])[0][0];
    }, [hasProject, topLevelNodes]);

    const workspaceState: 'no-project' | 'project-loaded' | 'project-creating' | 'project-importing' | 'project-loading' | 'project-failed' =
        hasProject ? 'project-loaded' : 'no-project';
    const status: WorkspaceStatus = deriveWorkspaceStatus({
        initialized: true,
        restoring,
        busy,
        hasProject,
        error: null,
    });
    const metadata: WorkspaceMetadata | null = useMemo(() => {
        if (!hasProject || !metaRecord) return null;
        return createWorkspaceMetadata(
            projectName,
            metaRecord.origin,
            {
                id: metaRecord.id,
                displayName: projectName,
                origin: metaRecord.origin,
                createdAt: metaRecord.createdAt,
                updatedAt: workspaceUpdatedAt || metaRecord.updatedAt || metaRecord.createdAt,
            },
            workspaceUpdatedAt,
        );
    }, [hasProject, metaRecord, projectName, workspaceUpdatedAt]);

    // Apply an authoritative cloud tree. The hook has already set its
    // last-synced fingerprint, so this state update will not echo back as a new
    // local mutation. Active/open file ids are re-validated against the tree.
    const applyRemoteWorkspace = useCallback((nextTree: FileNode[], updatedAt: number) => {
        // Record the applied payload unconditionally. Even when the cloud tree
        // equals the local one, rendering it must not advance the local edit
        // timestamp and make this device look newer than the server.
        remoteApplyRef.current = { json: JSON.stringify(nextTree), updatedAt };
        latestTreeRef.current = nextTree;
        setFileTree(nextTree);
        setWorkspaceUpdatedAt(updatedAt);
        setMetaRecord((prev) => {
            if (!prev) return prev;
            const next = { ...prev, updatedAt };
            saveWorkspaceRecord(next);
            return next;
        });

        const active = stateRef.current.activeFile;
        if (active && !findNodeById(nextTree, active.id)) {
            setActiveFileState(null);
            setActiveFileMeta(null);
            nsRemoveItem(ACTIVE_FILE_KEY);
        }
        setOpenFileIds((prev) => prev.filter((id) => {
            const node = findNodeById(nextTree, id);
            return Boolean(node && node.type === 'file');
        }));
    }, []);

    const cloudSync = useAccountWorkspaceSync({
        userId: auth?.user?.id ?? null,
        enabled: Boolean(auth?.user?.id) && saveWorkspaceState,
        tree: fileTree,
        record: metaRecord,
        hasProject,
        preferRemote: initial.repaired && initial.tree.length === 0,
        onRemoteWorkspace: applyRemoteWorkspace,
    });

    const workspaceValue = useMemo(
        () => ({ state: workspaceState, status, metadata, projectName, projectType, cloudSync }),
        [workspaceState, status, metadata, projectName, projectType, cloudSync],
    );

    const applyTreeMutation = useTreeMutation(latestTreeRef, setFileTree);

    // Save fileTree to localStorage whenever it changes (unless workspace
    // persistence is disabled in Privacy settings). fileTree only ever contains
    // validated, structurally sound data — expansion/selection never touch it.
    useEffect(() => {
        if (saveWorkspaceState) {
            saveFileTree(fileTree);
        }
    }, [fileTree, saveWorkspaceState]);

    // Persist expanded folders so collapse/expand survives refresh and never appears stuck
    useEffect(() => {
        try {
            nsSetItem(EXPANDED_KEY, JSON.stringify(Array.from(expandedFolderIds)));
        } catch { /* ignore */ }
    }, [expandedFolderIds]);

    // Prune stale expansion ids when tree changes (deleted folders) — prevents stuck collapsed state
    useEffect(() => {
        const valid = new Set(collectFolderIds(fileTree));
        valid.add(ROOT_NODE_ID);
        let pruned = false;
        for (const id of expandedFolderIds) if (!valid.has(id)) pruned = true;
        if (pruned) {
            setExpandedFolderIds(prev => {
                const next = new Set<string>();
                for (const id of prev) if (valid.has(id)) next.add(id);
                next.add(ROOT_NODE_ID);
                return next;
            });
        }
    }, [fileTree, expandedFolderIds]);

    // Wrapper to also save active file ID + keep activeEditorStore in sync (single source: editor store reflects authoritative active file)
    const setActiveFile = useCallback((file: FileNode) => {
        setActiveFileState(file);
        const fullPath = pathOf(latestTreeRef.current, file.id) || file.name;
        setActiveFileMeta({ id: file.id, name: file.name });
        // Sync editor store immediately so getActiveEditorContext() doesn't lag behind Explorer selection
        try {
            const ed = getSyncedEditor();
            if (ed) {
                const curMonaco = getSyncedMonaco();
                syncActiveEditor(ed, curMonaco, { id: file.id, name: file.name, path: fullPath });
            } else {
                updateActiveFileMeta({ id: file.id, name: file.name, path: fullPath });
            }
        } catch { /* best-effort */ }
        if (getSettings().privacy.saveWorkspaceState) {
            nsSetItem(ACTIVE_FILE_KEY, file.id);
        }
        setOpenFileIds(prev => {
            if (prev.includes(file.id)) return prev;
            const next = [...prev, file.id];
            try { nsSetItem(OPEN_FILES_KEY, JSON.stringify(next)); } catch { /* ignore */ }
            return next;
        });
    }, []);

    const closeFile = useCallback((fileId: string) => {
        setOpenFileIds(prev => {
            const next = prev.filter(id => id !== fileId);
            try { nsSetItem(OPEN_FILES_KEY, JSON.stringify(next)); } catch { /* ignore */ }
            if (stateRef.current.activeFile?.id === fileId) {
                const nextActiveId = next[next.length - 1];
                if (nextActiveId) {
                    const node = findNodeById(latestTreeRef.current, nextActiveId);
                    if (node && node.type === 'file') {
                        setActiveFile(node);
                    } else {
                        setActiveFileState(null);
                        setActiveFileMeta(null);
                    }
                } else {
                    setActiveFileState(null);
                    setActiveFileMeta(null);
                }
            }
            return next;
        });
    }, [setActiveFile]);

    /**
     * Refresh the active-file node + meta from the latest committed tree. Ids
     * are stable across rename/move, but the node object (and its name) can
     * change, so re-fetch by id to keep CodeEditor / panels on fresh data.
     */
    const refreshActiveFileFromTree = useCallback(() => {
        const current = stateRef.current.activeFile;
        if (!current) return;
        const node = findNodeById(latestTreeRef.current, current.id);
        if (!node) return;
        if (node !== current) setActiveFileState(node);
        setActiveFileMeta(prev =>
            prev && prev.id === node.id ? { id: node.id, name: node.name } : prev,
        );
    }, []);

    // ============================================================================
    // Expansion — pure UI state, NEVER a filesystem mutation.
    // ============================================================================

    const toggleFolder = useCallback((folderId: string) => {
        setExpandedFolderIds(prev => {
            const next = new Set(prev);
            if (next.has(folderId)) next.delete(folderId);
            else next.add(folderId);
            return next;
        });
    }, []);

    const collapseAll = useCallback(() => {
        setExpandedFolderIds(new Set([ROOT_NODE_ID]));
    }, []);

    const expandAll = useCallback(() => {
        setExpandedFolderIds(new Set(collectFolderIds(latestTreeRef.current)));
    }, []);

    const expandRecursively = useCallback((folderId: string) => {
        setExpandedFolderIds(prev => {
            const target = findNodeById(latestTreeRef.current, folderId);
            if (!target || target.type !== 'folder') return prev;
            const subtreeIds = new Set<string>([folderId]);
            const stack: FileNode[] = [];
            const kids = target.children ?? [];
            for (const k of kids) stack.push(k);
            const visited = new WeakSet<object>();
            while (stack.length > 0) {
                const n = stack.pop()!;
                if (!n || visited.has(n)) continue;
                visited.add(n);
                if (n.type === 'folder') subtreeIds.add(n.id);
                const childKids = n.children ?? [];
                for (const k of childKids) stack.push(k);
            }
            const next = new Set(prev);
            for (const id of subtreeIds) next.add(id);
            return next;
        });
    }, []);

    // ============================================================================
    // Create
    // ============================================================================

    const splitPath = (path: string): { dirs: string; name: string; parentId: string } => {
        const idx = path.lastIndexOf('/');
        if (idx === -1) return { dirs: '', name: path, parentId: ROOT_NODE_ID };
        const dirs = path.substring(0, idx);
        return { dirs, name: path.substring(idx + 1), parentId: dirs };
    };

    const createFile = useCallback((path: string, content?: string): TreeOperationResult => {
        const { dirs, name, parentId } = splitPath(path);
        const templateContent = content !== undefined ? content : getFileTemplate(name, dirs).content;
        const outcome = applyTreeMutation(tree => {
            let t = tree;
            let actualParentId = parentId;
            if (dirs) {
                const ensured = ensureFolderPath(t, dirs);
                if (ensured.error) return ensured;
                if (ensured.changed) t = ensured.tree;
                // `dirs` is a NAME path; the created/existing folders have
                // opaque ids, so re-parent by the resolved deepest folder id.
                actualParentId = ensured.node?.id ?? parentId;
            }
            const result = opCreateFile(t, { name, parentId: actualParentId, content: templateContent });
            if (result.changed && result.node) {
                setActiveFile(result.node);
            }
            return result;
        });
        if (outcome.changed && outcome.node && !outcome.error) {
            emitFileChange({ kind: 'created', id: outcome.node.id, name: outcome.node.name, parentId: outcome.node.parentId, path: pathOf(outcome.tree, outcome.node.id) || outcome.node.name });
        }
        return outcome;
    }, [applyTreeMutation, setActiveFile]);

    const createFolder = useCallback((path: string): TreeOperationResult => {
        const { dirs, name, parentId } = splitPath(path);
        const outcome = applyTreeMutation(tree => {
            let t = tree;
            let actualParentId = parentId;
            if (dirs) {
                const ensured = ensureFolderPath(t, dirs);
                if (ensured.error) return ensured;
                if (ensured.changed) t = ensured.tree;
                actualParentId = ensured.node?.id ?? parentId;
            }
            return opCreateFolder(t, { name, parentId: actualParentId });
        });
        if (outcome.changed && outcome.node && !outcome.error) {
            emitFileChange({ kind: 'created', id: outcome.node.id, name: outcome.node.name, parentId: outcome.node.parentId, path: pathOf(outcome.tree, outcome.node.id) || outcome.node.name });
        }
        return outcome;
    }, [applyTreeMutation]);

    const createNestedFolders = useCallback((path: string): TreeOperationResult => {
        const outcome = applyTreeMutation(tree => ensureFolderPath(tree, path));
        if (outcome.changed && outcome.node && !outcome.error) {
            emitFileChange({ kind: 'created', id: outcome.node.id, name: outcome.node.name, parentId: outcome.node.parentId, path: pathOf(outcome.tree, outcome.node.id) || outcome.node.name });
        }
        return outcome;
    }, [applyTreeMutation]);

    /** Create a file directly under a resolved parent id (Explorer/terminal UI). */
    const createFileInFolder = useCallback((parentId: string, name: string, content?: string): TreeOperationResult => {
        const templateContent = content !== undefined ? content : getFileTemplate(name, parentId).content;
        const outcome = applyTreeMutation(tree => {
            const result = opCreateFile(tree, { name, parentId, content: templateContent });
            if (result.changed && result.node) {
                setActiveFile(result.node);
            }
            return result;
        });
        if (outcome.changed && outcome.node && !outcome.error) {
            emitFileChange({ kind: 'created', id: outcome.node.id, name: outcome.node.name, parentId: outcome.node.parentId, path: pathOf(outcome.tree, outcome.node.id) || outcome.node.name });
        }
        return outcome;
    }, [applyTreeMutation, setActiveFile]);

    /** Create a folder directly under a resolved parent id (Explorer/terminal UI). */
    const createFolderInFolder = useCallback((parentId: string, name: string): TreeOperationResult => {
        const outcome = applyTreeMutation(tree => opCreateFolder(tree, { name, parentId }));
        if (outcome.changed && outcome.node && !outcome.error) {
            emitFileChange({ kind: 'created', id: outcome.node.id, name: outcome.node.name, parentId: outcome.node.parentId, path: pathOf(outcome.tree, outcome.node.id) || outcome.node.name });
        }
        return outcome;
    }, [applyTreeMutation]);

    /** mkdir -p under a resolved parent id, resolving segments by name. */
    const ensureFolderUnder = useCallback((parentId: string, path: string): TreeOperationResult => {
        const parts = path.split('/').filter((p) => p.trim().length > 0);
        if (parts.length === 0) return applyTreeMutation(tree => noopResult(tree));
        // Nodes created inside the updater are collected here: the updater
        // runs exactly once and synchronously, so this is populated when
        // applyTreeMutation returns.
        const created: FileNode[] = [];
        const outcome = applyTreeMutation(tree => {
            let t = tree;
            let pid = parentId;
            for (const part of parts) {
                const existing = findChildByName(t, pid, part);
                if (existing && existing.type === 'folder') {
                    pid = existing.id;
                    continue;
                }
                const res = opCreateFolder(t, { name: part, parentId: pid });
                if (!res.changed || !res.node) return { ...res, tree: t };
                t = res.tree;
                pid = res.node.id;
                created.push(res.node);
            }
            return { tree: t, changed: t !== tree };
        });
        for (const node of created) {
            emitFileChange({ kind: 'created', id: node.id, name: node.name, parentId: node.parentId, path: pathOf(outcome.tree, node.id) || node.name });
        }
        return outcome;
    }, [applyTreeMutation]);

    // ============================================================================
    // Delete
    // ============================================================================

    /** Resolve an id OR a name-path (AI `delete_file` passes action.path) to a node id. */
    const resolveNodeId = useCallback((input: string): string | null => {
        if (findNodeById(latestTreeRef.current, input)) return input;
        const node = resolvePath(latestTreeRef.current, input);
        return node && node.id !== ROOT_NODE_ID ? node.id : null;
    }, []);

    const deleteNode = useCallback((idOrPath: string) => {
        const id = resolveNodeId(idOrPath);
        if (!id) return;
        const { activeFile, selectedFolder } = stateRef.current;
        const tree = latestTreeRef.current;
        const target = findNodeById(tree, id);

        if (isDescendantOf(tree, id, selectedFolder)) setSelectedFolderState(ROOT_NODE_ID);
        if (isDescendantOf(tree, id, stateRef.current.selectedNodeId)) setSelectedNodeState(null);

        const isActiveFileDeleted = isDescendantOf(tree, id, activeFile?.id ?? null);
        if (isActiveFileDeleted) {
            setActiveFileState(null);
            setActiveFileMeta(null);
            nsRemoveItem(ACTIVE_FILE_KEY);
        }
        setModifiedFiles(prev => {
            if (prev.size === 0) return prev;
            const next = new Set<string>();
            for (const fid of prev) {
                if (!isDescendantOf(tree, id, fid)) next.add(fid);
            }
            return next.size === prev.size ? prev : next;
        });
        setExpandedFolderIds(prev => {
            let changed = false;
            const next = new Set<string>();
            for (const eid of prev) {
                if (isDescendantOf(tree, id, eid)) changed = true;
                else next.add(eid);
            }
            return changed ? next : prev;
        });

        const outcome = applyTreeMutation(tree => opDeleteNode(tree, id));
        if (outcome.changed && target) {
            emitFileChange({ kind: 'deleted', id, name: target.name, parentId: target.parentId });
        }
    }, [applyTreeMutation, resolveNodeId]);

    const deleteMultipleNodes = useCallback((ids: string[]) => {
        const { activeFile } = stateRef.current;
        const deleted: Array<{ id: string; name: string; parentId?: string }> = [];
        for (const id of ids) {
            const resolved = resolveNodeId(id);
            if (!resolved) continue;
            const tree = latestTreeRef.current;
            const isDeletingSelected = isDescendantOf(tree, resolved, stateRef.current.selectedFolder);
            if (isDeletingSelected) setSelectedFolderState(ROOT_NODE_ID);
            const isActiveFileDeleted = isDescendantOf(tree, resolved, activeFile?.id ?? null);
            if (isActiveFileDeleted) {
                setActiveFileState(null);
                setActiveFileMeta(null);
                nsRemoveItem(ACTIVE_FILE_KEY);
            }
        }
        for (const id of ids) {
            const resolved = resolveNodeId(id);
            if (!resolved) continue;
            const before = findNodeById(latestTreeRef.current, resolved);
            const outcome = applyTreeMutation(tree => opDeleteNode(tree, resolved));
            if (outcome.changed && before) {
                deleted.push({ id: resolved, name: before.name, parentId: before.parentId });
            }
        }
        for (const d of deleted) {
            emitFileChange({ kind: 'deleted', id: d.id, name: d.name, parentId: d.parentId });
        }
        setSelectedNodes(new Set());
        setSelectedNodeState(null);
    }, [applyTreeMutation, resolveNodeId]);

    const clearSelection = useCallback(() => {
        setSelectedNodes(new Set());
    }, []);

    // ============================================================================
    // Clipboard
    // ============================================================================

    const cutNodes = useCallback((ids: string[]) => {
        setClipboard({ nodeIds: ids, mode: 'cut' });
    }, []);

    const copyNodes = useCallback((ids: string[]) => {
        setClipboard({ nodeIds: ids, mode: 'copy' });
    }, []);

    const pasteNodes = useCallback((targetFolderId: string) => {
        const { clipboard } = stateRef.current;
        if (!clipboard || clipboard.nodeIds.length === 0) return;

        if (clipboard.mode === 'cut') {
            for (const id of clipboard.nodeIds) {
                const before = findNodeById(latestTreeRef.current, id);
                const outcome = applyTreeMutation(tree => opMoveNode(tree, id, targetFolderId));
                if (outcome.changed && before) {
                    emitFileChange({ kind: 'moved', id, name: before.name, parentId: targetFolderId, prevParentId: before.parentId, path: pathOf(outcome.tree, id) || before.name });
                }
            }
        } else {
            for (const id of clipboard.nodeIds) {
                const outcome = applyTreeMutation(tree => opCopyNode(tree, id, targetFolderId));
                if (outcome.changed && outcome.node && !outcome.error) {
                    emitFileChange({ kind: 'created', id: outcome.node.id, name: outcome.node.name, parentId: outcome.node.parentId, path: pathOf(outcome.tree, outcome.node.id) || outcome.node.name });
                }
            }
        }

        setClipboard(null);
        setSelectedNodes(new Set());
    }, [applyTreeMutation]);

    // ============================================================================
    // Creation UI flow
    // ============================================================================

    const startCreating = useCallback((type: 'file' | 'folder', parentId: string = ROOT_NODE_ID) => {
        let actualParentId = parentId;
        if (parentId !== ROOT_NODE_ID) {
            const parentNode = findNodeById(latestTreeRef.current, parentId);
            if (!parentNode) actualParentId = ROOT_NODE_ID;
        }
        setExpandedFolderIds(prev => {
            const next = new Set(prev);
            next.add(actualParentId);
            return next;
        });
        setCreationState({ type, parentId: actualParentId, isActive: true });
    }, []);

    const cancelCreation = useCallback(() => {
        setCreationState({ type: null, parentId: null, isActive: false });
    }, []);

    const commitCreation = useCallback((name: string) => {
        const { creationState } = stateRef.current;
        if (!creationState.isActive || !creationState.type) return;

        const parentId = creationState.parentId || ROOT_NODE_ID;
        if (creationState.type === 'file') {
            createFileInFolder(parentId, name, '');
        } else {
            createFolderInFolder(parentId, name);
        }
        cancelCreation();
    }, [createFileInFolder, createFolderInFolder, cancelCreation]);

    // ============================================================================
    // Update / rename / move / duplicate
    // ============================================================================

    const updateFileContent = useCallback((fileId: string, content: string): TreeOperationResult => {
        if (isCorruptFileContent(content)) {
            console.warn('[FileTree] Rejected corrupt AI error sentinel as file content');
            return { tree: latestTreeRef.current, changed: false, error: { code: 'invalid-content' as any, message: 'Rejected AI error sentinel' } } as TreeOperationResult;
        }
        const result = applyTreeMutation(tree => opUpdateFileContent(tree, fileId, content));

        if (result.changed) {
            const node = findNodeById(result.tree, fileId);
            emitFileChange({ kind: 'updated', id: fileId, name: node?.name ?? fileId, parentId: node?.parentId, path: pathOf(result.tree, fileId) || undefined });
            setModifiedFiles(prev => {
                const next = new Set(prev);
                next.add(fileId);
                return next;
            });
            setActiveFileState(prev => {
                if (prev?.id !== fileId || prev.content === content) return prev;
                return { ...prev, content };
            });
        }
        return result;
    }, [applyTreeMutation]);

    const renameNode = useCallback((id: string, newName: string): TreeOperationResult => {
        const before = findNodeById(latestTreeRef.current, id);
        const result = applyTreeMutation(tree => opRenameNode(tree, id, newName));
        if (result.changed) {
            refreshActiveFileFromTree();
            const node = result.node ?? findNodeById(result.tree, id);
            emitFileChange({ kind: 'renamed', id, name: node?.name ?? newName, parentId: node?.parentId, prevName: before?.name, path: pathOf(result.tree, id) || undefined });
        }
        return result;
    }, [applyTreeMutation, refreshActiveFileFromTree]);

    const setSelectedFolder = useCallback((folderId: string | null) => {
        setSelectedFolderState(folderId);
    }, []);

    const setSelectedNode = useCallback((nodeId: string | null) => {
        setSelectedNodeState(nodeId);
    }, []);

    const noteWorkspaceOrigin = useCallback((origin: WorkspaceOrigin) => {
        originRef.current = origin;
    }, []);

    const setWorkspaceBusy = useCallback((next: 'creating' | 'importing' | null) => {
        setBusyState(next);
    }, []);

    const moveNode = useCallback((sourceId: string, targetFolderId: string): TreeOperationResult => {
        const before = findNodeById(latestTreeRef.current, sourceId);
        const result = applyTreeMutation(tree => opMoveNode(tree, sourceId, targetFolderId));
        if (result.changed) {
            refreshActiveFileFromTree();
            emitFileChange({ kind: 'moved', id: sourceId, name: before?.name ?? sourceId, parentId: targetFolderId, prevParentId: before?.parentId, path: pathOf(result.tree, sourceId) || undefined });
        }
        return result;
    }, [applyTreeMutation, refreshActiveFileFromTree]);

    const duplicateNode = useCallback((id: string): TreeOperationResult => {
        const outcome = applyTreeMutation(tree => opDuplicateNode(tree, id));
        if (outcome.changed && outcome.node && !outcome.error) {
            emitFileChange({ kind: 'created', id: outcome.node.id, name: outcome.node.name, parentId: outcome.node.parentId, path: pathOf(outcome.tree, outcome.node.id) || outcome.node.name });
        }
        return outcome;
    }, [applyTreeMutation]);

    // ============================================================================
    // Project templates
    // ============================================================================

    const createProjectTemplate = useCallback((template: string, name: string) => {
        const projectTemplate = PROJECT_TEMPLATES[template];
        if (!projectTemplate) {
            console.error('Template not found:', template);
            return;
        }

        const created = createFolder(name);
        const uniqueName = created.node?.name ?? name;
        const folderId = created.node?.id ?? uniqueName;

        projectTemplate.files.forEach(file => {
            const filePath = file.name.includes('/')
                ? `${uniqueName}/${file.name}`
                : `${uniqueName}/${file.name}`;

            if (file.name.includes('/')) {
                const folderPath = file.name.substring(0, file.name.lastIndexOf('/'));
                createNestedFolders(`${uniqueName}/${folderPath}`);
            }

            createFile(filePath, file.content);
        });

        // Expand the project folder
        setExpandedFolderIds(prev => {
            const next = new Set(prev);
            next.add(folderId);
            return next;
        });
        setSelectedFolder(folderId);
    }, [createFolder, createFile, createNestedFolders, setSelectedFolder]);

    const toggleSelection = useCallback((id: string, multi: boolean) => {
        setSelectedNodes(prev => {
            const next = new Set(multi ? prev : []);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
        if (!multi) setSelectedFolderState(id);
    }, []);

    const selectRange = useCallback((startId: string, endId: string, allVisibleNodes: string[]) => {
        const startIndex = allVisibleNodes.indexOf(startId);
        const endIndex = allVisibleNodes.indexOf(endId);
        if (startIndex === -1 || endIndex === -1) return;

        const min = Math.min(startIndex, endIndex);
        const max = Math.max(startIndex, endIndex);
        const range = allVisibleNodes.slice(min, max + 1);

        setSelectedNodes(new Set(range));
    }, []);

    const selectAll = useCallback((allVisibleNodes: string[]) => {
        setSelectedNodes(new Set(allVisibleNodes));
    }, []);

    const getFileTree = useCallback(() => latestTreeRef.current, []);
    const getActiveFile = useCallback(() => stateRef.current.activeFile, []);

    const actionsValue = React.useMemo<ProjectActions>(() => ({
        setActiveFile,
        setSelectedFolder,
        setSelectedNode,
        toggleFolder,
        createFile,
        createFolder,
        createNestedFolders,
        createFileInFolder,
        createFolderInFolder,
        ensureFolderUnder,
        createProjectTemplate,
        deleteNode,
        updateFileContent,
        startCreating,
        cancelCreation,
        commitCreation,
        renameNode,
        collapseAll,
        expandAll,
        moveNode,
        toggleSelection,
        selectRange,
        selectAll,
        deleteMultipleNodes,
        clearSelection,
        cutNodes,
        copyNodes,
        pasteNodes,
        duplicateNode,
        expandRecursively,
        getFileTree,
        getActiveFile,
        closeFile,
        noteWorkspaceOrigin,
        setWorkspaceBusy,
    }), [
        setActiveFile, setSelectedFolder, setSelectedNode, toggleFolder, createFile, createFolder, createNestedFolders,
        createFileInFolder, createFolderInFolder, ensureFolderUnder,
        createProjectTemplate, deleteNode, updateFileContent, startCreating, cancelCreation, commitCreation,
        renameNode, collapseAll, expandAll, moveNode, toggleSelection, selectRange, selectAll,
        deleteMultipleNodes, clearSelection, cutNodes, copyNodes, pasteNodes, duplicateNode,
        expandRecursively, getFileTree, getActiveFile, closeFile, noteWorkspaceOrigin, setWorkspaceBusy,
    ]);

    const openFiles = React.useMemo(() => {
        const list: FileNode[] = [];
        for (const id of openFileIds) {
            const node = findNodeById(fileTree, id);
            if (node && node.type === 'file') {
                list.push(node);
            }
        }
        if (activeFile && !list.some(f => f.id === activeFile.id)) {
            list.push(activeFile);
        }
        return list;
    }, [openFileIds, fileTree, activeFile]);

    const fileValue = React.useMemo<ProjectFileState>(() => ({
        fileTree,
        activeFile,
        modifiedFiles,
        openFiles,
    }), [fileTree, activeFile, modifiedFiles, openFiles]);

    const uiValue = React.useMemo<ProjectUIState>(() => ({
        selectedFolder,
        selectedNodeId,
        creationState,
        selectedNodes,
        clipboard,
        activeFileMeta,
        expandedFolderIds,
    }), [selectedFolder, selectedNodeId, creationState, selectedNodes, clipboard, activeFileMeta, expandedFolderIds]);

    return (
        <ProjectActionsContext.Provider value={actionsValue}>
            <ProjectUIContext.Provider value={uiValue}>
                <ProjectFileContext.Provider value={fileValue}>
                    <WorkspaceStateContext.Provider value={workspaceValue}>
                        {children}
                    </WorkspaceStateContext.Provider>
                </ProjectFileContext.Provider>
            </ProjectUIContext.Provider>
        </ProjectActionsContext.Provider>
    );
});

export const useProject = () => {
    const actions = useContext(ProjectActionsContext);
    const ui = useContext(ProjectUIContext);
    const file = useContext(ProjectFileContext);
    if (actions === undefined || ui === undefined || file === undefined) {
        throw new Error('useProject must be used within a ProjectProvider');
    }
    return { ...file, ...ui, ...actions };
};

export const useProjectFile = () => {
    const context = useContext(ProjectFileContext);
    if (context === undefined) {
        throw new Error('useProjectFile must be used within a ProjectProvider');
    }
    return context;
};

export const useProjectUI = () => {
    const context = useContext(ProjectUIContext);
    if (context === undefined) {
        throw new Error('useProjectUI must be used within a ProjectProvider');
    }
    return context;
};

export const useProjectActions = () => {
    const context = useContext(ProjectActionsContext);
    if (context === undefined) {
        throw new Error('useProjectActions must be used within a ProjectProvider');
    }
    return context;
};

// Export for diagnostics / dev tools.
export const getProjectTreeValidation = (tree: FileNode[]) => validateFileTree(tree);

// Hook to access workspace state.
export const useWorkspaceState = () => {
    const ctx = useContext(WorkspaceStateContext);
    if (ctx === undefined) {
        throw new Error('useWorkspaceState must be used within a ProjectProvider');
    }
    return ctx;
};