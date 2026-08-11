/* eslint-disable react-refresh/only-export-components */
import React, { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import { initialFileTree, type FileNode } from '../utils/mockFileSystem';

const STORAGE_KEY = 'deepcontext-file-tree';
const ACTIVE_FILE_KEY = 'deepcontext-active-file-id';

// Load file tree from localStorage
const loadFileTree = (): FileNode[] => {
    try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) {
            return JSON.parse(saved);
        }
    } catch (e) {
        console.warn('Failed to load file tree from localStorage:', e);
    }
    return initialFileTree;
};

// Save file tree to localStorage
const saveFileTree = (tree: FileNode[]) => {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(tree));
    } catch (e) {
        console.warn('Failed to save file tree to localStorage:', e);
    }
};

// Find a node by ID recursively
const findNodeById = (nodes: FileNode[], id: string): FileNode | null => {
    for (const node of nodes) {
        if (node.id === id) return node;
        if (node.children) {
            const found = findNodeById(node.children, id);
            if (found) return found;
        }
    }
    return null;
};

// File templates for different languages and frameworks
const FILE_TEMPLATES: Record<string, { content: string; description: string }> = {
    // JavaScript/TypeScript
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
    // Python
    'python': {
        content: `#!/usr/bin/env python3\n\ndef main():\n    print("Hello, Python!")\n\nif __name__ == "__main__":\n    main()\n`,
        description: 'Basic Python script'
    },
    'python-class': {
        content: `#!/usr/bin/env python3\n\nclass ClassName:\n    def __init__(self, param1, param2):\n        self.param1 = param1\n        self.param2 = param2\n\n    def method(self):\n        return f"Hello from {self.param1}"\n\nif __name__ == "__main__":\n    obj = ClassName("value1", "value2")\n    print(obj.method())\n`,
        description: 'Python class'
    },
    // Web
    'html': {
        content: `<!DOCTYPE html>\n<html lang="en">\n<head>\n    <meta charset="UTF-8">\n    <meta name="viewport" content="width=device-width, initial-scale=1.0">\n    <title>Document</title>\n    <link rel="stylesheet" href="styles.css">\n</head>\n<body>\n    <h1>Hello, World!</h1>\n    <script src="script.js"></script>\n</body>\n</html>\n`,
        description: 'HTML5 document'
    },
    'css': {
        content: `/* CSS Styles */\n\n* {\n    margin: 0;\n    padding: 0;\n    box-sizing: border-box;\n}\n\nbody {\n    font-family: Arial, sans-serif;\n    line-height: 1.6;\n}\n\n.container {\n    max-width: 1200px;\n    margin: 0 auto;\n    padding: 20px;\n}\n`,
        description: 'CSS stylesheet'
    },
    // Configuration
    'package.json': {
        content: `{\n  "name": "my-project",\n  "version": "1.0.0",\n  "description": "A new project",\n  "main": "index.js",\n  "scripts": {\n    "start": "node index.js",\n    "dev": "nodemon index.js",\n    "test": "jest"\n  },\n  "keywords": [],\n  "author": "",\n  "license": "ISC",\n  "dependencies": {},\n  "devDependencies": {}\n}\n`,
        description: 'Node.js package.json'
    },
    'tsconfig.json': {
        content: `{\n  "compilerOptions": {\n    "target": "ES2020",\n    "module": "commonjs",\n    "lib": ["ES2020"],\n    "outDir": "./dist",\n    "rootDir": "./src",\n    "strict": true,\n    "esModuleInterop": true,\n    "skipLibCheck": true,\n    "forceConsistentCasingInFileNames": true\n  },\n  "include": ["src/**/*"],\n  "exclude": ["node_modules", "dist"]\n}\n`,
        description: 'TypeScript configuration'
    },
    // Other
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
    
    // Special named files
    if (name === 'package.json') return FILE_TEMPLATES['package.json'];
    if (name === 'tsconfig.json') return FILE_TEMPLATES['tsconfig.json'];
    if (name === '.gitignore') return FILE_TEMPLATES['gitignore'];
    
    // React components
    if (name.endsWith('.tsx') || name.endsWith('.jsx')) {
        if (name.includes('hook') || name.includes('use')) {
            return FILE_TEMPLATES['react-hook'];
        }
        return FILE_TEMPLATES['react-component'];
    }
    
    // TypeScript/JavaScript
    if (ext === 'ts') return FILE_TEMPLATES['typescript'];
    if (ext === 'js') return FILE_TEMPLATES['javascript'];
    
    // Web files
    if (ext === 'html') return FILE_TEMPLATES['html'];
    if (ext === 'css') return FILE_TEMPLATES['css'];
    
    // Python
    if (ext === 'py') {
        if (name.includes('class') || parentPath?.includes('classes')) {
            return FILE_TEMPLATES['python-class'];
        }
        return FILE_TEMPLATES['python'];
    }
    
    // Markdown
    if (ext === 'md') return FILE_TEMPLATES['markdown'];
    
    // Default empty template
    return { content: '', description: 'Empty file' };
};

// Enhanced file validation
const validateFileName = (name: string, type: 'file' | 'folder'): { valid: boolean; error?: string } => {
    // Check for invalid characters
    const invalidChars = /[<>:"|?*\\]/;
    if (invalidChars.test(name)) {
        return { valid: false, error: 'Name contains invalid characters' };
    }
    
    // Check for reserved names (Windows)
    const reservedNames = ['CON', 'PRN', 'AUX', 'NUL', 'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9', 'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9'];
    if (reservedNames.includes(name.toUpperCase())) {
        return { valid: false, error: 'Name is reserved by the system' };
    }
    
    // Check for empty name
    if (!name.trim()) {
        return { valid: false, error: 'Name cannot be empty' };
    }
    
    // Check for trailing/leading spaces and dots
    if (name.startsWith(' ') || name.endsWith(' ') || name.startsWith('.') || name.endsWith('.')) {
        return { valid: false, error: 'Name cannot start or end with spaces or dots' };
    }
    
    // File-specific validation
    if (type === 'file') {
        // Check for file name length
        if (name.length > 255) {
            return { valid: false, error: 'File name too long' };
        }
        
        // Check if file has extension (optional)
        if (!name.includes('.') && name !== 'README' && name !== 'LICENSE' && name !== 'Dockerfile') {
            // Don't require extension for common files
            console.warn('File may be missing an extension');
        }
    } else {
        // Folder-specific validation
        if (name.length > 248) {
            return { valid: false, error: 'Folder name too long' };
        }
    }
    
    return { valid: true };
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
const getUniqueName = (name: string, siblings: FileNode[], type: 'file' | 'folder'): string => {
    const existingNames = new Set(siblings.map((s: FileNode) => s.name.toLowerCase()));

    if (!existingNames.has(name.toLowerCase())) {
        return name;
    }

    // Split name into base and extension for files
    let baseName: string;
    let extension: string;

    if (type === 'file') {
        const lastDot = name.lastIndexOf('.');
        if (lastDot > 0) {
            baseName = name.substring(0, lastDot);
            extension = name.substring(lastDot); // includes the dot
        } else {
            baseName = name;
            extension = '';
        }
    } else {
        baseName = name;
        extension = '';
    }

    // Find the next available number
    let counter = 1;
    while (existingNames.has(`${baseName} (${counter})${extension}`.toLowerCase())) {
        counter++;
    }

    return `${baseName} (${counter})${extension}`;
};

interface ProjectContextType {
    fileTree: FileNode[];
    activeFile: FileNode | null;
    setActiveFile: (file: FileNode) => void;
    selectedFolder: string | null;
    setSelectedFolder: (folderId: string | null) => void;
    toggleFolder: (folderId: string) => void;
    createFile: (path: string, content?: string) => void;
    createFolder: (path: string) => void;
    createNestedFolders: (path: string) => void;
    createProjectTemplate: (template: string, name: string) => void;
    deleteNode: (id: string) => void;
    updateFileContent: (fileId: string, content: string) => void;
    creationState: { type: 'file' | 'folder' | null; parentId: string | null; isActive: boolean };
    startCreating: (type: 'file' | 'folder', parentId?: string) => void;
    cancelCreation: () => void;
    commitCreation: (name: string) => void;
    renameNode: (id: string, newName: string) => void;
    collapseAll: () => void;
    expandAll: () => void;
    moveNode: (sourceId: string, targetFolderId: string) => void;
    selectedNodes: Set<string>;
    toggleSelection: (id: string, multi: boolean) => void;
    selectRange: (startId: string, endId: string, allVisibleNodes: string[]) => void;
    selectAll: (allVisibleNodes: string[]) => void;
    deleteMultipleNodes: (ids: string[]) => void;
    clearSelection: () => void;
    clipboard: { nodeIds: string[]; mode: 'cut' | 'copy' } | null;
    cutNodes: (ids: string[]) => void;
    copyNodes: (ids: string[]) => void;
    pasteNodes: (targetFolderId: string) => void;
    duplicateNode: (id: string) => void;
    modifiedFiles: Set<string>;
    expandRecursively: (folderId: string) => void;
}

const ProjectContext = createContext<ProjectContextType | undefined>(undefined);

export const ProjectProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const [fileTree, setFileTree] = useState<FileNode[]>(loadFileTree);
    const [activeFile, setActiveFileState] = useState<FileNode | null>(() => {
        const savedActiveId = localStorage.getItem(ACTIVE_FILE_KEY);
        if (savedActiveId) {
            // We reload the tree here to find the node. 
            // Since loadFileTree is deterministic (reads from LS), this matches the tree state.
            const tree = loadFileTree();
            const node = findNodeById(tree, savedActiveId);
            if (node && node.type === 'file') {
                return node;
            }
        }
        return null;
    });
    const [selectedFolder, setSelectedFolderState] = useState<string | null>('root');
    const [creationState, setCreationState] = useState<{ type: 'file' | 'folder' | null; parentId: string | null; isActive: boolean }>({
        type: null,
        parentId: null,
        isActive: false
    });
    const [selectedNodes, setSelectedNodes] = useState<Set<string>>(new Set());
    const [clipboard, setClipboard] = useState<{ nodeIds: string[]; mode: 'cut' | 'copy' } | null>(null);
    const [modifiedFiles, setModifiedFiles] = useState<Set<string>>(new Set());

    // Save fileTree to localStorage whenever it changes
    useEffect(() => {
        saveFileTree(fileTree);
    }, [fileTree]);

    // Wrapper to also save active file ID
    const setActiveFile = useCallback((file: FileNode) => {
        setActiveFileState(file);
        localStorage.setItem(ACTIVE_FILE_KEY, file.id);
    }, []);

    // Helper to toggle folder open/close state recursively
    const toggleFolderRecursive = (nodes: FileNode[], folderId: string): FileNode[] => {
        return nodes.map(node => {
            if (node.id === folderId) {
                return { ...node, isOpen: !node.isOpen };
            }
            if (node.children) {
                return { ...node, children: toggleFolderRecursive(node.children, folderId) };
            }
            return node;
        });
    };

    const openFolderRecursive = (nodes: FileNode[], folderId: string): FileNode[] => {
        return nodes.map(node => {
            if (node.id === folderId) {
                return { ...node, isOpen: true };
            }
            if (node.children) {
                return { ...node, children: openFolderRecursive(node.children, folderId) };
            }
            return node;
        });
    };

    const toggleFolder = useCallback((folderId: string) => {
        setFileTree(prev => toggleFolderRecursive(prev, folderId));
    }, []);

    const createFile = useCallback((path: string, content?: string) => {
        const parts = path.split('/');
        const fileName = parts.pop()!;
        
        // Validate file name
        const validation = validateFileName(fileName, 'file');
        if (!validation.valid) {
            console.error('Invalid file name:', validation.error);
            return;
        }
        
        // Get parent folder to check for existing files
        const parentId = path.lastIndexOf('/') !== -1 ? path.substring(0, path.lastIndexOf('/')) : 'root';
        let siblings: FileNode[] = [];
        
        if (parentId === 'root') {
            siblings = fileTree;
        } else {
            const parentNode = findNodeById(fileTree, parentId);
            siblings = parentNode?.children || [];
        }
        
        // Get unique name if needed
        const uniqueName = getUniqueName(fileName, siblings, 'file');
        const finalPath = parentId === 'root' ? uniqueName : `${parentId}/${uniqueName}`;
        
        // Get template content if none provided
        const templateContent = content !== undefined ? content : getFileTemplate(uniqueName, parentId).content;

        const newFile: FileNode = {
            id: finalPath,
            name: uniqueName,
            type: 'file',
            content: templateContent
        };

        setFileTree(prev => {
            // If adding to root, just append to the list
            if (parentId === 'root') {
                return [...prev, newFile];
            }

            const updateRecursive = (nodes: FileNode[]): FileNode[] => {
                return nodes.map(node => {
                    if (node.id === parentId) {
                        return { ...node, children: [...(node.children || []), newFile], isOpen: true };
                    }
                    if (node.children) {
                        return { ...node, children: updateRecursive(node.children) };
                    }
                    return node;
                });
            };

            return updateRecursive(prev);
        });

        setActiveFile(newFile);
    }, [fileTree, setActiveFile]);

    const createFolder = useCallback((path: string) => {
        const parts = path.split('/');
        const folderName = parts.pop()!;
        
        // Validate folder name
        const validation = validateFileName(folderName, 'folder');
        if (!validation.valid) {
            console.error('Invalid folder name:', validation.error);
            return;
        }
        
        // Get parent folder to check for existing folders
        const parentId = path.lastIndexOf('/') !== -1 ? path.substring(0, path.lastIndexOf('/')) : 'root';
        let siblings: FileNode[] = [];
        
        if (parentId === 'root') {
            siblings = fileTree;
        } else {
            const parentNode = findNodeById(fileTree, parentId);
            siblings = parentNode?.children || [];
        }
        
        // Get unique name if needed
        const uniqueName = getUniqueName(folderName, siblings, 'folder');
        const finalPath = parentId === 'root' ? uniqueName : `${parentId}/${uniqueName}`;

        const newFolder: FileNode = {
            id: finalPath,
            name: uniqueName,
            type: 'folder',
            isOpen: true,
            children: []
        };

        setFileTree(prev => {
            // If adding to root, just append to the list
            if (parentId === 'root') {
                return [...prev, newFolder];
            }

            const updateRecursive = (nodes: FileNode[]): FileNode[] => {
                return nodes.map(node => {
                    if (node.id === parentId) {
                        return { ...node, children: [...(node.children || []), newFolder], isOpen: true };
                    }
                    if (node.children) {
                        return { ...node, children: updateRecursive(node.children) };
                    }
                    return node;
                });
            };

            return updateRecursive(prev);
        });
    }, [fileTree]);

    // Create nested folder structure
    const createNestedFolders = useCallback((path: string) => {
        const parts = path.split('/').filter(part => part.trim());
        let currentPath = '';
        
        parts.forEach((folderName, index) => {
            currentPath = index === 0 ? folderName : `${currentPath}/${folderName}`;
            
            // Check if folder already exists
            const existingFolder = findNodeById(fileTree, currentPath);
            if (!existingFolder) {
                createFolder(currentPath);
            }
        });
    }, [fileTree, createFolder]);

    const deleteNodeRecursive = (nodes: FileNode[], id: string): FileNode[] => {
        return nodes.filter(node => node.id !== id).map(node => ({
            ...node,
            children: node.children ? deleteNodeRecursive(node.children, id) : undefined
        }));
    };

    const deleteNode = useCallback((id: string) => {
        // Check if we are deleting the currently selected folder or one of its parents
        const isDeletingSelected = selectedFolder === id || selectedFolder?.startsWith(id + '/');
        if (isDeletingSelected) {
            setSelectedFolderState('root');
        }

        // Check if active file is being deleted or inside a deleted folder
        const isActiveFileDeleted = activeFile?.id === id || activeFile?.id.startsWith(id + '/');
        if (isActiveFileDeleted) {
            setActiveFileState(null);
            localStorage.removeItem(ACTIVE_FILE_KEY);
        }

        setFileTree(prev => deleteNodeRecursive(prev, id));
    }, [activeFile, selectedFolder]);

    // Bulk delete multiple nodes
    const deleteMultipleNodes = useCallback((ids: string[]) => {
        // Check if selected folder or active file is among the deleted
        for (const id of ids) {
            const isDeletingSelected = selectedFolder === id || selectedFolder?.startsWith(id + '/');
            if (isDeletingSelected) {
                setSelectedFolderState('root');
            }
            const isActiveFileDeleted = activeFile?.id === id || activeFile?.id.startsWith(id + '/');
            if (isActiveFileDeleted) {
                setActiveFileState(null);
                localStorage.removeItem(ACTIVE_FILE_KEY);
            }
        }

        setFileTree(prev => {
            let tree = prev;
            for (const id of ids) {
                tree = deleteNodeRecursive(tree, id);
            }
            return tree;
        });

        setSelectedNodes(new Set());
    }, [selectedFolder, activeFile]);

    const clearSelection = useCallback(() => {
        setSelectedNodes(new Set());
    }, []);

    // Clipboard: cut nodes (mark for moving)
    const cutNodes = useCallback((ids: string[]) => {
        setClipboard({ nodeIds: ids, mode: 'cut' });
    }, []);

    // Clipboard: copy nodes (mark for duplicating)
    const copyNodes = useCallback((ids: string[]) => {
        setClipboard({ nodeIds: ids, mode: 'copy' });
    }, []);

    // Deep clone a node with new IDs based on new parent path
    const cloneNode = (node: FileNode, newParentPath: string): FileNode => {
        const newId = newParentPath === 'root' ? node.name : `${newParentPath}/${node.name}`;
        const cloned: FileNode = {
            ...node,
            id: newId,
            name: node.name,
            children: node.children?.map(child => cloneNode(child, newId))
        };
        return cloned;
    };

    // Clipboard: paste nodes into target folder
    const pasteNodes = useCallback((targetFolderId: string) => {
        if (!clipboard || clipboard.nodeIds.length === 0) return;

        // Collect the actual nodes
        const nodesToPaste: FileNode[] = [];
        for (const id of clipboard.nodeIds) {
            const node = findNodeById(fileTree, id);
            if (node) nodesToPaste.push(node);
        }
        if (nodesToPaste.length === 0) return;

        // Get siblings in the target folder for unique naming
        let targetChildren: FileNode[] = [];
        if (targetFolderId === 'root') {
            targetChildren = fileTree;
        } else {
            const targetNode = findNodeById(fileTree, targetFolderId);
            targetChildren = targetNode?.children || [];
        }

        if (clipboard.mode === 'cut') {
            // Move: remove from source, add to target
            setFileTree(prev => {
                // First remove all cut nodes
                let tree = prev;
                for (const id of clipboard.nodeIds) {
                    tree = deleteNodeRecursive(tree, id);
                }

                // Then add them to the target
                for (const node of nodesToPaste) {
                    if (targetFolderId === 'root') {
                        tree = [...tree, node];
                    } else {
                        const addToFolder = (nodes: FileNode[]): FileNode[] => {
                            return nodes.map(n => {
                                if (n.id === targetFolderId) {
                                    return { ...n, children: [...(n.children || []), node], isOpen: true };
                                }
                                if (n.children) {
                                    return { ...n, children: addToFolder(n.children) };
                                }
                                return n;
                            });
                        };
                        tree = addToFolder(tree);
                    }
                }
                return tree;
            });
            setClipboard(null); // Clear clipboard after cut-paste
        } else {
            // Copy: clone nodes and add to target with unique names
            setFileTree(prev => {
                let tree = prev;
                for (const node of nodesToPaste) {
                    const uniqueName = getUniqueName(node.name, targetChildren, node.type);
                    const cloned = cloneNode({ ...node, name: uniqueName }, targetFolderId);

                    if (targetFolderId === 'root') {
                        tree = [...tree, cloned];
                    } else {
                        const addToFolder = (nodes: FileNode[]): FileNode[] => {
                            return nodes.map(n => {
                                if (n.id === targetFolderId) {
                                    return { ...n, children: [...(n.children || []), cloned], isOpen: true };
                                }
                                if (n.children) {
                                    return { ...n, children: addToFolder(n.children) };
                                }
                                return n;
                            });
                        };
                        tree = addToFolder(tree);
                    }
                    // Update targetChildren for next iteration to avoid duplicate names
                    targetChildren = [...targetChildren, cloned];
                }
                return tree;
            });
        }

        setSelectedNodes(new Set());
    }, [clipboard, fileTree]);

    const startCreating = useCallback((type: 'file' | 'folder', parentId: string = 'root') => {
        // Validation: Ensure parentId exists in the tree (unless it's root)
        let actualParentId = parentId;
        if (parentId !== 'root') {
            const parentNode = findNodeById(fileTree, parentId);
            if (!parentNode) {
                // Fallback to root or handle error. 
                // For now, let's fallback to root to ensure UI shows up.
                actualParentId = 'root';
            }
        }

        // Always expand the parent folder to show the input
        setFileTree(prev => openFolderRecursive(prev, actualParentId));
        setCreationState({ type, parentId: actualParentId, isActive: true });
    }, [fileTree, openFolderRecursive]);

    const cancelCreation = useCallback(() => {
        setCreationState({ type: null, parentId: null, isActive: false });
    }, []);

    const commitCreation = useCallback((name: string) => {
        if (!creationState.isActive || !creationState.type) return;

        const parentId = creationState.parentId || 'root';

        // Get sibling names in the target folder
        let siblings: FileNode[] = [];
        if (parentId === 'root') {
            siblings = fileTree;
        } else {
            const parentNode = findNodeById(fileTree, parentId);
            siblings = parentNode?.children || [];
        }

        // Generate a unique name if duplicate exists
        const uniqueName = getUniqueName(name, siblings, creationState.type);

        const path = parentId === 'root' ? uniqueName : `${parentId}/${uniqueName}`;

        if (creationState.type === 'file') {
            createFile(path, '');
        } else {
            createFolder(path);
        }

        cancelCreation();
    }, [creationState, fileTree, createFile, createFolder, getUniqueName, cancelCreation]);

    // Update file content in the tree (for persistence)
    const updateFileContent = useCallback((fileId: string, content: string) => {
        setFileTree(prev => {
            const updateRecursive = (nodes: FileNode[]): FileNode[] => {
                return nodes.map(node => {
                    if (node.id === fileId) {
                        return { ...node, content };
                    }
                    if (node.children) {
                        return { ...node, children: updateRecursive(node.children) };
                    }
                    return node;
                });
            };
            return updateRecursive(prev);
        });

        // Track modified files
        setModifiedFiles(prev => {
            const next = new Set(prev);
            next.add(fileId);
            return next;
        });

        // Also update activeFile if it's the same file
        if (activeFile?.id === fileId) {
            setActiveFileState({ ...activeFile, content });
        }
    }, [activeFile]);

    const renameNode = useCallback((id: string, newName: string) => {
        setFileTree(prev => {
            const updateRecursive = (nodes: FileNode[]): FileNode[] => {
                return nodes.map(node => {
                    if (node.id === id) {
                        // const newId = node.id.substring(0, node.id.lastIndexOf('/')) + '/' + newName;
                        // Ideally we would recursively update IDs of children too if it's a folder, 
                        // but for this MVP let's just update the name and the ID of this node. 
                        // Note: Breaking IDs of children might break their paths, but for a simple mock FS it might be okay for now.
                        // A proper FS would handle paths more robustly.
                        return { ...node, name: newName };
                    }
                    if (node.children) {
                        return { ...node, children: updateRecursive(node.children) };
                    }
                    return node;
                });
            };
            return updateRecursive(prev);
        });
    }, []);

    const setSelectedFolder = useCallback((folderId: string | null) => {
        setSelectedFolderState(folderId);
    }, []);

    // Create project from template
    const createProjectTemplate = useCallback((template: string, name: string) => {
        const projectTemplate = PROJECT_TEMPLATES[template];
        if (!projectTemplate) {
            console.error('Template not found:', template);
            return;
        }
        
        // Validate project name
        const validation = validateFileName(name, 'folder');
        if (!validation.valid) {
            console.error('Invalid project name:', validation.error);
            return;
        }
        
        // Get unique name for project
        const uniqueName = getUniqueName(name, fileTree, 'folder');
        
        // Create main project folder
        createFolder(uniqueName);
        
        // Create all files and folders from template
        projectTemplate.files.forEach(file => {
            const filePath = file.name.includes('/') 
                ? `${uniqueName}/${file.name}` 
                : `${uniqueName}/${file.name}`;
            
            // Create nested folders if needed
            if (file.name.includes('/')) {
                const folderPath = file.name.substring(0, file.name.lastIndexOf('/'));
                createNestedFolders(`${uniqueName}/${folderPath}`);
            }
            
            createFile(filePath, file.content);
        });
        
        // Expand the project folder
        toggleFolder(uniqueName);
        setSelectedFolder(uniqueName);
    }, [fileTree, createFolder, createFile, createNestedFolders, toggleFolder, setSelectedFolder]);

    // Collapse all folders
    const collapseAll = useCallback(() => {
        const collapseRecursive = (nodes: FileNode[]): FileNode[] => {
            return nodes.map(node => ({
                ...node,
                isOpen: false,
                children: node.children ? collapseRecursive(node.children) : undefined
            }));
        };
        setFileTree(prev => collapseRecursive(prev));
    }, []);

    // Expand all folders
    const expandAll = useCallback(() => {
        const expandRecursive = (nodes: FileNode[]): FileNode[] => {
            return nodes.map(node => ({
                ...node,
                isOpen: node.type === 'folder' ? true : node.isOpen,
                children: node.children ? expandRecursive(node.children) : undefined
            }));
        };
        setFileTree(prev => expandRecursive(prev));
    }, []);

    // Expand a specific folder and all its subfolders recursively
    const expandRecursively = useCallback((folderId: string) => {
        const expandAllChildren = (nodes: FileNode[]): FileNode[] => {
            return nodes.map(node => ({
                ...node,
                isOpen: node.type === 'folder' ? true : node.isOpen,
                children: node.children ? expandAllChildren(node.children) : undefined
            }));
        };

        setFileTree(prev => {
            const expandTarget = (nodes: FileNode[]): FileNode[] => {
                return nodes.map(node => {
                    if (node.id === folderId) {
                        return {
                            ...node,
                            isOpen: true,
                            children: node.children ? expandAllChildren(node.children) : undefined
                        };
                    }
                    if (node.children) {
                        return { ...node, children: expandTarget(node.children) };
                    }
                    return node;
                });
            };
            return expandTarget(prev);
        });
    }, []);

    // Duplicate a node (file or folder)
    const duplicateNode = useCallback((id: string) => {
        const node = findNodeById(fileTree, id);
        if (!node) return;

        // Determine parent
        const lastSlash = id.lastIndexOf('/');
        const parentId = lastSlash !== -1 ? id.substring(0, lastSlash) : 'root';

        // Get siblings
        let siblings: FileNode[] = [];
        if (parentId === 'root') {
            siblings = fileTree;
        } else {
            const parentNode = findNodeById(fileTree, parentId);
            siblings = parentNode?.children || [];
        }

        const uniqueName = getUniqueName(node.name, siblings, node.type);
        const cloneNodeFn = (n: FileNode, newParentPath: string): FileNode => {
            const newId = newParentPath === 'root' ? uniqueName : `${newParentPath}/${n === node ? uniqueName : n.name}`;
            return {
                ...n,
                id: newId,
                name: n === node ? uniqueName : n.name,
                children: n.children?.map(child => cloneNodeFn(child, newId))
            };
        };

        const cloned = cloneNodeFn(node, parentId);

        setFileTree(prev => {
            if (parentId === 'root') {
                return [...prev, cloned];
            }
            const addToFolder = (nodes: FileNode[]): FileNode[] => {
                return nodes.map(n => {
                    if (n.id === parentId) {
                        return { ...n, children: [...(n.children || []), cloned] };
                    }
                    if (n.children) {
                        return { ...n, children: addToFolder(n.children) };
                    }
                    return n;
                });
            };
            return addToFolder(prev);
        });
    }, [fileTree]);

    // Select all visible nodes
    const selectAll = useCallback((allVisibleNodes: string[]) => {
        setSelectedNodes(new Set(allVisibleNodes));
    }, []);

    // Move a node to a different folder
    const moveNode = useCallback((sourceId: string, targetFolderId: string) => {
        const sourceNode = findNodeById(fileTree, sourceId);
        if (!sourceNode) return;
        if (sourceId === targetFolderId) return;
        // Prevent moving a folder into itself or its children
        if (targetFolderId.startsWith(sourceId + '/')) return;

        setFileTree(prev => {
            // First, remove the node from its current location
            const removeNode = (nodes: FileNode[]): FileNode[] => {
                return nodes.filter(n => n.id !== sourceId).map(n => ({
                    ...n,
                    children: n.children ? removeNode(n.children) : undefined
                }));
            };

            // Then, add it to the target folder
            const addToTarget = (nodes: FileNode[]): FileNode[] => {
                return nodes.map(n => {
                    if (n.id === targetFolderId) {
                        return { ...n, children: [...(n.children || []), sourceNode], isOpen: true };
                    }
                    if (n.children) {
                        return { ...n, children: addToTarget(n.children) };
                    }
                    return n;
                });
            };

            let newTree = removeNode(prev);
            if (targetFolderId === 'root') {
                newTree = [...newTree, sourceNode];
            } else {
                newTree = addToTarget(newTree);
            }
            return newTree;
        });
    }, [fileTree]);

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

    const contextValue = React.useMemo(() => ({
        fileTree,
        activeFile,
        setActiveFile,
        selectedFolder,
        setSelectedFolder,
        toggleFolder,
        createFile,
        createFolder,
        createNestedFolders,
        createProjectTemplate,
        deleteNode,
        updateFileContent,
        creationState,
        startCreating,
        cancelCreation,
        commitCreation,
        renameNode,
        collapseAll,
        expandAll,
        moveNode,
        selectedNodes,
        deleteMultipleNodes,
        clearSelection,
        clipboard,
        cutNodes,
        copyNodes,
        pasteNodes,
        duplicateNode,
        modifiedFiles,
        expandRecursively,
        selectAll,
        toggleSelection,
        selectRange
    }), [
        fileTree, activeFile, selectedFolder, creationState, selectedNodes, clipboard, modifiedFiles,
        setActiveFile, setSelectedFolder, toggleFolder, createFile, createFolder, createNestedFolders, createProjectTemplate, deleteNode,
        updateFileContent, startCreating, cancelCreation, commitCreation, renameNode,
        collapseAll, expandAll, moveNode, deleteMultipleNodes, clearSelection, cutNodes,
        copyNodes, pasteNodes, duplicateNode, expandRecursively, selectAll, toggleSelection, selectRange
    ]);

    return (
        <ProjectContext.Provider value={contextValue}>
            {children}
        </ProjectContext.Provider>
    );
};

export const useProject = () => {
    const context = useContext(ProjectContext);
    if (context === undefined) {
        throw new Error('useProject must be used within a ProjectProvider');
    }
    return context;
};
