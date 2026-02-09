# State Management (Context) Documentation

This document describes the React Context providers located in `src/context`. These providers manager global state for the application, such as the file system and terminal sessions.

## 1. Project Context (`ProjectContext.tsx`)
Manages the state of the project's file system, including the file tree, active files, and selection state.

### State & Features
- **File System**: Maintains the hierarchy of files and folders (`FileNode[]`).
- **Persistence**: Automatically saves and loads the file tree from `localStorage`.
- **Selection**: Tracks the currently active file (being edited) and selected folder.
- **CRUD Operations**: Provides methods to create, update, delete, and rename files/folders.

### Key Types
- `FileNode`: Represents a file or folder with children.
- `ProjectContextType`: Interface for the context value.

### Key Methods
- `createFile(path, content?)`: Creates a new file at the specified path.
- `createFolder(path)`: Creates a new folder.
- `deleteNode(id)`: Deletes a file or folder by ID.
- `updateFileContent(fileId, content)`: Updates the content of a file.
- `startCreating(type, parentId)`: Initiates the UI flow for creating a new item.

---

## 2. Terminal Context (`TerminalContext.tsx`)
Manages the integrated terminal sessions, allowing code execution and output display.

### State & Features
- **Multi-terminal Support**: Manages a list of active terminal sessions (`TerminalSession[]`).
- **Execution**: Handles sending code to the backend execution service.
- **Logs**: Stores stdout, stderr, and system messages for each terminal.
- **Input**: specific `stdin` management for interactive programs.

### Key Types
- `LogEntry`: An individual line of output (stdout, stderr, or system message).
- `TerminalSession`: Represents a tab in the terminal panel.

### Key Methods
- `runCode(code, language, filename)`: Sends code to be executed.
- `createTerminal()`: Opens a new terminal tab.
- `appendLog(id, type, content)`: Adds output to a terminal session.
- `clearTerminal(id)`: Clears the logs of a specific terminal.
