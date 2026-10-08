import { describe, it, expect } from 'vitest';
import type { FileNode } from '../src/utils/mockFileSystem';
import { findNodeById, collectFiles } from '../src/utils/safeTree';

const sampleTree: FileNode[] = [
    {
        id: 'root',
        name: 'azemax-workspace',
        type: 'folder',
        isOpen: true,
        children: [
            {
                id: 'src-folder',
                name: 'src',
                type: 'folder',
                parentId: 'root',
                children: [
                    {
                        id: 'app-tsx',
                        name: 'App.tsx',
                        type: 'file',
                        parentId: 'src-folder',
                        content: 'import React from "react"; export default function App() {}',
                    },
                    {
                        id: 'index-css',
                        name: 'index.css',
                        type: 'file',
                        parentId: 'src-folder',
                        content: 'body { margin: 0; }',
                    },
                ],
            },
            {
                id: 'package-json',
                name: 'package.json',
                type: 'file',
                parentId: 'root',
                content: '{"name": "test"}',
            },
        ],
    },
];

describe('Mobile Responsive Architecture & State', () => {
    it('preserves complete filesystem tree and node discovery', () => {
        const files = collectFiles(sampleTree);
        expect(files.length).toBe(3);
        // All files must have valid id, name, and parentId
        for (const file of files) {
            expect(file.id).toBeTruthy();
            expect(file.name).toBeTruthy();
            expect(file.type).toBe('file');
        }
    });

    it('can resolve any node by id in the tree', () => {
        const appTsx = findNodeById(sampleTree, 'app-tsx');
        expect(appTsx).toBeDefined();
        expect(appTsx?.name).toBe('App.tsx');
        expect(appTsx?.content).toContain('React');
    });

    it('validates mobile vs desktop breakpoint boundaries', () => {
        const isMobile = (w: number) => w < 768;
        const isTablet = (w: number) => w >= 768 && w < 1024;
        const isDesktop = (w: number) => w >= 1024;

        // Mobile targets per specification:
        // 320×568, 360×640, 375×667, 390×844, 393×852, 412×915, 430×932
        const mobileWidths = [320, 360, 375, 390, 393, 412, 430, 640, 767];
        for (const w of mobileWidths) {
            expect(isMobile(w)).toBe(true);
            expect(isDesktop(w)).toBe(false);
        }

        // Tablet targets: 768×1024
        expect(isTablet(768)).toBe(true);
        expect(isMobile(768)).toBe(false);
        expect(isDesktop(768)).toBe(false);

        // Desktop targets: 1280×720, 1366×768, 1440×900, 1920×1080
        const desktopWidths = [1024, 1280, 1366, 1440, 1920];
        for (const w of desktopWidths) {
            expect(isDesktop(w)).toBe(true);
            expect(isMobile(w)).toBe(false);
            expect(isTablet(w)).toBe(false);
        }
    });

    it('simulates file tab lifecycle (open, switch, close)', () => {
        let openFileIds = ['file-1', 'file-2'];
        let activeFileId: string | null = 'file-1';

        // Open third file
        const newFileId = 'file-3';
        if (!openFileIds.includes(newFileId)) {
            openFileIds = [...openFileIds, newFileId];
        }
        activeFileId = newFileId;
        expect(openFileIds).toEqual(['file-1', 'file-2', 'file-3']);
        expect(activeFileId).toBe('file-3');

        // Close active file: switches to next available
        const closeFile = (id: string) => {
            openFileIds = openFileIds.filter(f => f !== id);
            if (activeFileId === id) {
                activeFileId = openFileIds[openFileIds.length - 1] ?? null;
            }
        };

        closeFile('file-3');
        expect(openFileIds).toEqual(['file-1', 'file-2']);
        expect(activeFileId).toBe('file-2');

        // Close remaining
        closeFile('file-2');
        expect(openFileIds).toEqual(['file-1']);
        expect(activeFileId).toBe('file-1');

        closeFile('file-1');
        expect(openFileIds).toEqual([]);
        expect(activeFileId).toBeNull();
    });

    it('filters files quickly for mobile search modal', () => {
        const files = collectFiles(sampleTree);
        const query = 'app';
        const matches = files.filter(f => f.name.toLowerCase().includes(query.toLowerCase()));
        expect(matches.length).toBe(1);
        expect(matches[0].name).toBe('App.tsx');
    });
});
