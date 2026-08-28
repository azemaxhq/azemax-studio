import { getCommentSyntax } from './commentSyntax';

export function stripCommentMarkers(text: string): string {
  return text.trim()
    .replace(/^\/\/+\s*/, '')
    .replace(/^#\s*/, '')
    .replace(/^\/\*\s*/, '')
    .replace(/\s*\*\/$/, '')
    .trim();
}

export function getIndent(line: string): string {
  return line.match(/^[ \t]*/)?.[0] ?? '';
}

export function isFunctionOrClassLine(line: string, language: string | null): boolean {
  const lang = (language || '').toLowerCase();
  const jsLike = ['javascript','typescript','java','c','cpp','csharp','go','rust','kotlin','swift','php','dart'];
  if (jsLike.includes(lang)) {
    return /^\s*(async\s+)?(function|class|interface|enum|const\s+\w+\s*=\s*\(|let\s+\w+\s*=\s*\(|var\s+\w+\s*=\s*\(|export\s+(default\s+)?(function|class)|public|private|protected)/.test(line)
      || /=>\s*\{/.test(line)
      || /^\s*def\s+\w+\s*\(/.test(line);
  }
  if (lang === 'python') return /^\s*(def|class|async def)\s+\w+/.test(line);
  return /^\s*(function|class|def)\b/.test(line);
}

export function buildCommentLine(targetLine: string, text: string, language: string | null): string {
  const syntax = getCommentSyntax(language);
  const indent = getIndent(targetLine);
  const lineMarker = syntax?.line || (language === 'python' ? '#' : '//');
  const useBlock = !syntax?.line && !!syntax?.blockStart;
  const isFunc = isFunctionOrClassLine(targetLine, language);

  if (isFunc && language && ['javascript','typescript','java','kotlin','php','cpp'].includes(language.toLowerCase())) {
    return `${indent}/** ${text} */`;
  }
  if (isFunc && language?.toLowerCase() === 'python') {
    return `${indent}${syntax?.blockStart ?? '"""'}${text}${syntax?.blockEnd ?? '"""'}`;
  }
  if (useBlock && syntax?.blockStart && syntax?.blockEnd) {
    return `${indent}${syntax.blockStart} ${text} ${syntax.blockEnd}`;
  }
  return `${indent}${lineMarker} ${text}`;
}

export function buildReplacementComment(existingLine: string, newText: string, fallbackIndent: string, fallbackMarker: string): string {
  const existingIndent = getIndent(existingLine);
  const indent = existingIndent || fallbackIndent;
  const trimmed = existingLine.trim();
  if (trimmed.startsWith('/**') || trimmed.startsWith('/*')) {
    const isDouble = trimmed.startsWith('/**');
    return isDouble ? `${indent}/** ${newText} */` : `${indent}/* ${newText} */`;
  }
  const markerMatch = trimmed.match(/^(\/\/+|#|--)/);
  const marker = markerMatch ? markerMatch[1] : fallbackMarker;
  return `${indent}${marker} ${newText}`;
}
