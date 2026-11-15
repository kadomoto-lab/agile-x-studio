import { serializeSchematic } from './file'
import type { SchematicDocument } from './types'
import { downloadBlob } from '../lib/download'

export function downloadSchematic(doc: SchematicDocument, fileName: string): void {
  const savedDoc = { ...doc, title: fileName.replace(/\.json$/i, '') }
  const blob = new Blob([serializeSchematic(savedDoc)], { type: 'application/json' })
  downloadBlob(blob, fileName)
}
