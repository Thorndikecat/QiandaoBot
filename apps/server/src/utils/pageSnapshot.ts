import fs from 'fs';
import path from 'path';

type SnapshotKind = 'signin' | 'practice' | 'browser' | 'unknown';

interface PageSnapshotInput {
  kind?: string;
  activeId?: string | number;
  url?: string;
  html?: string;
  metadata?: Record<string, unknown>;
  structure?: unknown;
}

const SnapshotDir = path.resolve(__dirname, '../../../../logs/page-snapshots');
const MaxHtmlChars = 800000;
const MaxJsonChars = 250000;

const clip = (value: string, max: number): string => (
  value.length > max ? `${value.slice(0, max)}\n<!-- clipped: ${value.length - max} chars omitted -->` : value
);

const sanitizeSegment = (value: unknown): string => String(value || 'unknown')
  .replace(/[^a-z0-9_-]+/gi, '-')
  .replace(/^-+|-+$/g, '')
  .slice(0, 80) || 'unknown';

const normalizeKind = (kind: string | undefined): SnapshotKind => {
  if (kind === 'signin' || kind === 'practice' || kind === 'browser') return kind;
  return 'unknown';
};

export const writePageSnapshot = (input: PageSnapshotInput) => {
  fs.mkdirSync(SnapshotDir, { recursive: true });

  const now = new Date();
  const timestamp = now.toISOString().replace(/[:.]/g, '-');
  const kind = normalizeKind(input.kind);
  const id = sanitizeSegment(input.activeId || input.metadata?.activeId || input.url);
  const baseName = `${timestamp}-${kind}-${id}`;
  const htmlFile = input.html ? `${baseName}.html` : undefined;
  const jsonFile = `${baseName}.json`;

  if (input.html && htmlFile) {
    fs.writeFileSync(path.join(SnapshotDir, htmlFile), clip(input.html, MaxHtmlChars), 'utf8');
  }

  const payload = {
    capturedAt: now.toISOString(),
    kind,
    activeId: input.activeId,
    url: input.url,
    htmlFile,
    metadata: input.metadata || {},
    structure: input.structure,
  };

  fs.writeFileSync(
    path.join(SnapshotDir, jsonFile),
    clip(JSON.stringify(payload, null, 2), MaxJsonChars),
    'utf8',
  );

  return {
    dir: SnapshotDir,
    jsonFile,
    htmlFile,
  };
};

export const safeWritePageSnapshot = (input: PageSnapshotInput) => {
  try {
    return writePageSnapshot(input);
  } catch (error) {
    console.log(`[pageSnapshot] save failed: ${error}`);
    return null;
  }
};
