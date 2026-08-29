# Components Documentation

This document describes the key React components in `src/components` that build the user interface of Azemax.

## 1. Core Structure (`Layout/`)

### `MainLayout.tsx`
The top-level layout component that orchestrates the entire application interface.
-   **Responsibilities**:
    -   Manages the 3-pane layout: **Sidebar** (File Explorer), **Editor** (Center), and **AI Assistant** (Right).
    -   **Resizing**: Handles drag-to-resize logic for all panels.
    -   **State Persistence**: Saves panel widths and visibility to `localStorage`.
    -   **Global Shortcuts**: Intercepts keys like `Ctrl+A` or context menu events.

---

## 2. Editor (`Editor/`)

### `CodeEditor.tsx`
The heart of the IDE, wrapping the Monaco Editor instance.
-   **Features**:
    -   **Language Support**: Auto-detects language from file extensions.
    -   **AI Integration**:
        -   Inline completions (Ghost text).
        -   `///` command handling (Auto-replace/modify code).
        -   Decorations for AI loading states.
    -   **Diagnostics**: Runs code analysis and displays error markers (red squiggles).
    -   **Toolbar**: Integrated controls for Formatting, Word Wrap, Minimap, and "Run Project".
-   **Configuration**: Persists user preferences (Font size, Minimap, Word Wrap).

---

## 3. Panels (`Panels/`)

### `AIAssistant.tsx`
The right-hand sidebar for conversational AI.
-   **Features**:
    -   Chat interface with the AI.
    -   Context awareness (knows about the open file).

### `BottomPanel.tsx`
The bottom area usually hosting the Terminal.
-   **Features**:
    -   Tabbed interface for multiple terminal sessions.
    -   Displays output from `CodeExecutionService`.

---

## 4. Sidebar (`Sidebar/`)
The left-hand file explorer.
-   **Features**:
    -   Displays the file tree (`FileNode` structure).
    -   Handles file creation, deletion, and navigation.

---

## 5. UI Elements (`UI/`, `Icons/`)
Reusable atoms and molecules.
-   **Icons**: Custom SVG icons (e.g., `ModernAILogo`).
-   **Common**: Shared buttons, inputs, or tooltips (if any).
