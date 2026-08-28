export interface ArtifactProps {
  title: string;
  type: 'code' | 'example' | 'explanation' | 'diagram' | string;
  language: string;
  content: string;
}

export interface ArtifactSegment {
  type: 'text' | 'artifact';
  content: string;
  artifact?: ArtifactProps;
}

const ARTIFACT_RE = /```artifact\s*\n(?:title:\s*"([^"]+)"\s*\n)?(?:type:\s*(\w+)\s*\n)?(?:language:\s*(\w+)\s*\n)?([\s\S]*?)```/gi;

export function parseArtifacts(text: string): { segments: ArtifactSegment[] } {
  const segments: ArtifactSegment[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  // Reset regex state for reused calls
  ARTIFACT_RE.lastIndex = 0;
  while ((match = ARTIFACT_RE.exec(text)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ type: 'text', content: text.slice(lastIndex, match.index) });
    }
    segments.push({
      type: 'artifact',
      content: '',
      artifact: {
        title: match[1] || 'Code Example',
        type: (match[2] as ArtifactProps['type']) || 'code',
        language: match[3] || 'typescript',
        content: match[4]?.trim() || '',
      },
    });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) segments.push({ type: 'text', content: text.slice(lastIndex) });
  if (segments.length === 0) segments.push({ type: 'text', content: text });
  return { segments };
}
