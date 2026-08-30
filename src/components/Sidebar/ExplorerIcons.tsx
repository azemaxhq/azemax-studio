import React, { memo } from 'react';
import {
  SiTypescript, SiJavascript, SiPython, SiCplusplus, SiC,
  SiGo, SiRust, SiRuby, SiPhp, SiSwift, SiKotlin, SiHtml5,
  SiCss3, SiSass, SiMarkdown, SiGnubash, SiDocker, SiGit,
  SiReact, SiVuedotjs, SiSvelte, SiNodedotjs, SiGraphql, SiLua, SiScala, SiDart
} from 'react-icons/si';
import { FaJava, FaDatabase, FaFileAlt, FaCogs } from 'react-icons/fa';
import { VscJson, VscSymbolFile } from 'react-icons/vsc';
import { Folder, FolderOpen } from 'lucide-react';

// Unified 16px optical container — VS Code density: 14px visual glyph in 16px box
const IconBox: React.FC<{ children: React.ReactNode; scale?: number }> = ({ children, scale = 1 }) => (
  <span className="inline-flex items-center justify-center w-4 h-4 shrink-0 leading-none" aria-hidden>
    <span className="inline-flex items-center justify-center" style={{ transform: `scale(${scale})`, transformOrigin: 'center' }}>
      {children}
    </span>
  </span>
);

// Folder — compact, consistent stroke, muted neutral
export const ExplorerFolderIcon: React.FC<{ isOpen: boolean }> = memo(({ isOpen }) => (
  <IconBox scale={1}>
    {isOpen
      ? <FolderOpen size={15} strokeWidth={1.65} className="text-[#858A97]" />
      : <Folder size={15} strokeWidth={1.65} className="text-[#858A97]" />
    }
  </IconBox>
));
ExplorerFolderIcon.displayName = 'ExplorerFolderIcon';

// Centralized type detection — reuses language.ts mapping but optimized for icons
export type ExplorerFileKind =
  | 'typescript' | 'javascript' | 'react' | 'vue' | 'svelte'
  | 'python' | 'java' | 'csharp' | 'c' | 'cpp' | 'go' | 'rust' | 'swift' | 'kotlin'
  | 'php' | 'ruby' | 'lua' | 'dart' | 'scala' | 'shell' | 'powershell' | 'perl'
  | 'html' | 'css' | 'scss' | 'json' | 'xml' | 'yaml' | 'toml' | 'sql' | 'graphql'
  | 'markdown' | 'dockerfile' | 'makefile' | 'readme' | 'packagejson' | 'tsconfig' | 'viteconfig'
  | 'gitignore' | 'env' | 'generic';

export function detectFileKind(name: string): ExplorerFileKind {
  const lower = name.toLowerCase();
  const base = lower.split('/').pop() || lower;
  const ext = base.includes('.') ? base.split('.').pop()! : '';

  // Special basenames first
  if (base === 'dockerfile' || base.startsWith('dockerfile.')) return 'dockerfile';
  if (base === 'makefile' || base === 'gnumakefile') return 'makefile';
  if (base === 'readme' || base.startsWith('readme.')) return 'readme';
  if (base === 'package.json') return 'packagejson';
  if (base === 'tsconfig.json' || base.startsWith('tsconfig')) return 'tsconfig';
  if (base.startsWith('vite.config.')) return 'viteconfig';
  if (base === '.gitignore' || base === '.gitattributes' || base === '.gitmodules') return 'gitignore';
  if (base.startsWith('.env')) return 'env';
  if (base === 'cargo.toml') return 'toml';
  if (base === 'go.mod' || base === 'go.sum') return 'go';
  if (base === 'pom.xml') return 'xml';
  if (base === 'build.gradle' || base.endsWith('.gradle')) return 'java';

  // By extension
  if (ext === 'ts' || ext === 'mts' || ext === 'cts') return 'typescript';
  if (ext === 'js' || ext === 'mjs' || ext === 'cjs') return 'javascript';
  if (ext === 'tsx' || ext === 'jsx') return 'react';
  if (ext === 'vue') return 'vue';
  if (ext === 'svelte') return 'svelte';
  if (ext === 'py' || ext === 'pyw') return 'python';
  if (ext === 'java') return 'java';
  if (ext === 'cs') return 'csharp';
  if (ext === 'c' || ext === 'h') return 'c';
  if (ext === 'cpp' || ext === 'cc' || ext === 'cxx' || ext === 'hpp' || ext === 'hh') return 'cpp';
  if (ext === 'go') return 'go';
  if (ext === 'rs') return 'rust';
  if (ext === 'swift') return 'swift';
  if (ext === 'kt' || ext === 'kts') return 'kotlin';
  if (ext === 'php' || ext === 'phtml') return 'php';
  if (ext === 'rb') return 'ruby';
  if (ext === 'lua') return 'lua';
  if (ext === 'dart') return 'dart';
  if (ext === 'scala' || ext === 'sc') return 'scala';
  if (ext === 'sh' || ext === 'bash' || ext === 'zsh') return 'shell';
  if (ext === 'ps1' || ext === 'psm1') return 'powershell';
  if (ext === 'pl' || ext === 'pm' || ext === 'perl') return 'perl';
  if (ext === 'html' || ext === 'htm') return 'html';
  if (ext === 'css') return 'css';
  if (ext === 'scss' || ext === 'sass' || ext === 'less') return 'scss';
  if (ext === 'json' || ext === 'jsonc') return 'json';
  if (ext === 'xml' || ext === 'xsl' || ext === 'svg') return 'xml';
  if (ext === 'yaml' || ext === 'yml') return 'yaml';
  if (ext === 'toml') return 'toml';
  if (ext === 'sql') return 'sql';
  if (ext === 'gql' || ext === 'graphql') return 'graphql';
  if (ext === 'md' || ext === 'mdx') return 'markdown';

  return 'generic';
}

// Unified premium file icon — 16px box, 14px glyph, optical scales for viewBox variance
export const ExplorerFileIcon: React.FC<{ name: string }> = memo(({ name }) => {
  const kind = detectFileKind(name);

  const scaleMap: Record<ExplorerFileKind, number> = {
    typescript: 1.0,
    javascript: 1.0,
    react: 0.98,
    vue: 0.98,
    svelte: 0.98,
    python: 1.02,
    java: 1.06,
    csharp: 1.0,
    c: 1.0,
    cpp: 1.02,
    go: 1.04,
    rust: 1.02,
    swift: 1.02,
    kotlin: 0.98,
    php: 1.04,
    ruby: 1.0,
    lua: 1.0,
    dart: 1.0,
    scala: 1.0,
    shell: 1.0,
    powershell: 1.0,
    perl: 1.0,
    html: 1.0,
    css: 1.0,
    scss: 1.0,
    json: 1.0,
    xml: 1.0,
    yaml: 1.0,
    toml: 1.0,
    sql: 1.0,
    graphql: 1.0,
    markdown: 1.0,
    dockerfile: 1.0,
    makefile: 1.0,
    readme: 1.0,
    packagejson: 1.0,
    tsconfig: 1.0,
    viteconfig: 1.0,
    gitignore: 1.0,
    env: 1.0,
    generic: 1.0,
  };

  const scale = scaleMap[kind] ?? 1;

  const icon = (() => {
    switch (kind) {
      case 'typescript': return <SiTypescript size={14} className="text-[#3178C6]" />;
      case 'javascript': return <SiJavascript size={14} className="text-[#C9A61A]" />;
      case 'react': return <SiReact size={14} className="text-[#61DAFB]" />;
      case 'vue': return <SiVuedotjs size={14} className="text-[#42B883]" />;
      case 'svelte': return <SiSvelte size={14} className="text-[#FF3E00]" />;
      case 'python': return <SiPython size={14} className="text-[#8BC34A]" />;
      case 'java': return <FaJava size={14} className="text-[#E86A3D]" />;
      case 'csharp': return <span className="text-[10px] font-bold tracking-tight text-[#9B6BFF] leading-none">C#</span>;
      case 'c': return <SiC size={14} className="text-[#659AD2]" />;
      case 'cpp': return <SiCplusplus size={14} className="text-[#649AD2]" />;
      case 'go': return <SiGo size={14} className="text-[#00ADD8]" />;
      case 'rust': return <SiRust size={14} className="text-[#DE5342]" />;
      case 'swift': return <SiSwift size={14} className="text-[#F05138]" />;
      case 'kotlin': return <SiKotlin size={14} className="text-[#B19CFF]" />;
      case 'php': return <SiPhp size={14} className="text-[#777BB4]" />;
      case 'ruby': return <SiRuby size={14} className="text-[#CC342D]" />;
      case 'lua': return <SiLua size={14} className="text-[#2C2D72]" />;
      case 'dart': return <SiDart size={14} className="text-[#0175C2]" />;
      case 'scala': return <SiScala size={14} className="text-[#DC322F]" />;
      case 'shell': return <SiGnubash size={14} className="text-[#89E051]" />;
      case 'powershell': return <FaCogs size={12} className="text-[#4D8DC6]" />;
      case 'perl': return <FaCogs size={12} className="text-[#96B4E0]" />;
      case 'html': return <SiHtml5 size={14} className="text-[#E44D26]" />;
      case 'css': return <SiCss3 size={14} className="text-[#1572B6]" />;
      case 'scss': return <SiSass size={14} className="text-[#CC6699]" />;
      case 'json': return <VscJson size={14} className="text-[#C9B65E]" />;
      case 'xml': return <SiHtml5 size={14} className="text-[#E44D26]" />;
      case 'yaml': return <FaCogs size={12} className="text-[#E07A5F]" />;
      case 'toml': return <FaCogs size={12} className="text-[#9C8A6B]" />;
      case 'sql': return <FaDatabase size={12} className="text-[#5B9CD6]" />;
      case 'graphql': return <SiGraphql size={14} className="text-[#E535AB]" />;
      case 'markdown': return <SiMarkdown size={14} className="text-white/55" />;
      case 'dockerfile': return <SiDocker size={14} className="text-[#2496ED]" />;
      case 'makefile': return <FaCogs size={12} className="text-white/45" />;
      case 'readme': return <FaFileAlt size={12} className="text-white/50" />;
      case 'packagejson': return <SiNodedotjs size={14} className="text-[#68A063]" />;
      case 'tsconfig': return <SiTypescript size={14} className="text-[#3178C6]" />;
      case 'viteconfig': return <SiTypescript size={14} className="text-[#646CFF]" />;
      case 'gitignore': return <SiGit size={14} className="text-[#F05032]" />;
      case 'env': return <FaCogs size={12} className="text-[#ECD53F]" />;
      default: return <VscSymbolFile size={14} className="text-white/35" />;
    }
  })();

  return <IconBox scale={scale}>{icon}</IconBox>;
});
ExplorerFileIcon.displayName = 'ExplorerFileIcon';
