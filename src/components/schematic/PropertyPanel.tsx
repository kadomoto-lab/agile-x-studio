import type { CircuitNode, AnalysisType } from '../../schematic/types'
import { getLibraryItem, isDigitalKind } from '../../schematic/library'
import { messages } from '../../i18n'

type PropertyPanelProps = {
  selectedNode: CircuitNode | null
  analysis: { type: AnalysisType; params: string }
  title: string
  onTitleChange: (title: string) => void
  onAnalysisChange: (analysis: { type: AnalysisType; params: string }) => void
  onNodeUpdate: (nodeId: string, patch: Partial<CircuitNode['data']>) => void
  onDeleteNode: (nodeId: string) => void
}

export function PropertyPanel({
  selectedNode,
  analysis,
  title,
  onTitleChange,
  onAnalysisChange,
  onNodeUpdate,
  onDeleteNode,
}: PropertyPanelProps) {
  return (
    <aside className="flex w-52 shrink-0 flex-col border-l border-border bg-surface-muted">
      <div className="border-b border-border px-3 py-2">
        <h2 className="text-[10px] font-semibold uppercase tracking-wider text-muted">
          {messages.properties.title}
        </h2>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        <div>
          <label className="mb-1 block text-[10px] text-muted">
            {messages.properties.circuitTitle}
          </label>
          <input
            type="text"
            value={title}
            onChange={(e) => onTitleChange(e.target.value)}
            className="w-full rounded-md border border-border bg-surface px-2 py-1 text-xs text-foreground outline-none focus:border-accent/60"
          />
        </div>

        <div>
          <label className="mb-1 block text-[10px] text-muted">
            {messages.properties.analysis}
          </label>
          <select
            value={analysis.type}
            onChange={(e) =>
              onAnalysisChange({
                ...analysis,
                type: e.target.value as AnalysisType,
              })
            }
            className="mb-1 w-full rounded-md border border-border bg-surface px-2 py-1 text-xs text-foreground"
          >
            <option value="tran">{messages.properties.analysisTran}</option>
            <option value="ac">{messages.properties.analysisAc}</option>
            <option value="op">{messages.properties.analysisOp}</option>
          </select>
          {analysis.type !== 'op' && (
            <input
              type="text"
              value={analysis.params}
              onChange={(e) =>
                onAnalysisChange({ ...analysis, params: e.target.value })
              }
              placeholder={analysis.type === 'tran' ? '10u 5m' : 'dec 50 10 1Meg'}
              className="w-full rounded-md border border-border bg-surface px-2 py-1 font-mono text-xs text-foreground outline-none focus:border-accent/60"
            />
          )}
        </div>

        {selectedNode ? (
          <NodeProperties
            node={selectedNode}
            onUpdate={(patch) => onNodeUpdate(selectedNode.id, patch)}
            onDelete={() => onDeleteNode(selectedNode.id)}
          />
        ) : (
          <p className="text-[10px] text-muted-light">
            {messages.properties.selectBlock}
          </p>
        )}
      </div>
    </aside>
  )
}

function NodeProperties({
  node,
  onUpdate,
  onDelete,
}: {
  node: CircuitNode
  onUpdate: (patch: Partial<CircuitNode['data']>) => void
  onDelete: () => void
}) {
  const lib = getLibraryItem(node.data.kind)
  const d = node.data

  return (
    <div className="space-y-2 rounded-lg border border-border bg-surface-muted p-2">
      <div className="text-xs font-semibold text-foreground">{lib.label}</div>

      {d.kind === 'vdd' && (
        <>
          <Field
            label={messages.properties.fieldRef}
            value={d.ref}
            onChange={(v) => onUpdate({ ref: v })}
          />
          <Field
            label={messages.properties.fieldVoltage}
            value={d.value}
            mono
            onChange={(v) => onUpdate({ value: v })}
          />
          {lib.spiceTemplate && (
            <div>
              <label className="mb-0.5 block text-[10px] text-muted">
                {messages.properties.fieldSpice}
              </label>
              <pre className="overflow-x-auto rounded-md border border-border bg-surface-inset p-2 font-mono text-[9px] leading-relaxed text-muted">
                {lib.spiceTemplate
                  .replace('{ref}', d.ref)
                  .replace('{value}', d.value)}
              </pre>
            </div>
          )}
        </>
      )}

      {d.kind !== 'ground' &&
        d.kind !== 'vdd' &&
        d.kind !== 'net_label' &&
        d.kind !== 'ga_io_in' &&
        d.kind !== 'ga_io_out' && (
        <>
          <Field
            label={messages.properties.fieldRef}
            value={d.ref}
            onChange={(v) => onUpdate({ ref: v })}
          />
          {!isDigitalKind(d.kind) && (
            <Field
              label={messages.properties.fieldValue}
              value={d.value}
              mono
              onChange={(v) => onUpdate({ value: v })}
            />
          )}
          {d.kind.startsWith('voltage_') && (
            <p className="text-[9px] leading-relaxed text-muted">
              {messages.properties.voltagePolarityHint.replace(
                '{ref}',
                d.ref,
              )}
            </p>
          )}
          {lib.spiceSubckt && (
            <>
              <Field
                label={messages.properties.fieldSubckt}
                value={lib.spiceSubckt}
                mono
                readOnly
              />
              {lib.spiceTemplate && (
                <div>
                  <label className="mb-0.5 block text-[10px] text-muted">
                    {messages.properties.fieldSpice}
                  </label>
                  <pre className="overflow-x-auto rounded-md border border-border bg-surface-inset p-2 font-mono text-[9px] leading-relaxed text-muted">
                    {lib.spiceTemplate.replace('{ref}', d.ref)}
                  </pre>
                </div>
              )}
            </>
          )}
        </>
      )}

      {d.kind === 'net_label' && (
        <>
          <Field
            label={messages.properties.fieldNetName}
            value={d.netName ?? d.value}
            mono
            onChange={(v) => onUpdate({ netName: v, value: v })}
          />
          <label className="flex items-center gap-1.5 text-[10px] text-muted">
            <input
              type="checkbox"
              checked={!!d.flip}
              onChange={(e) => onUpdate({ flip: e.target.checked })}
              className="accent-accent"
            />
            {messages.properties.fieldFlip}
          </label>
        </>
      )}

      {(d.kind === 'ga_io_in' || d.kind === 'ga_io_out') && (
        <>
          <Field
            label={messages.properties.fieldRef}
            value={d.ref}
            onChange={(v) => onUpdate({ ref: v })}
          />
          <div>
            <label className="mb-0.5 block text-[10px] text-muted">
              {messages.properties.fieldPad(
                d.kind === 'ga_io_in' ? 'in' : 'out',
              )}
            </label>
            <select
              value={d.padIndex ?? 0}
              onChange={(e) => onUpdate({ padIndex: Number(e.target.value) })}
              className="w-full rounded-md border border-border bg-surface-inset px-2 py-1 text-xs text-foreground"
            >
              {Array.from({ length: 13 }, (_, i) => (
                <option key={i} value={i}>
                  [{i}]
                </option>
              ))}
            </select>
          </div>
        </>
      )}

      <button
        type="button"
        onClick={onDelete}
        className="mt-2 w-full rounded-md border border-danger/30 bg-danger/10 py-1 text-[10px] font-medium text-danger hover:bg-danger/20"
      >
        {messages.properties.delete}
      </button>
    </div>
  )
}

function Field({
  label,
  value,
  mono,
  readOnly,
  onChange,
}: {
  label: string
  value: string
  mono?: boolean
  readOnly?: boolean
  onChange?: (v: string) => void
}) {
  return (
    <div>
      <label className="mb-0.5 block text-[10px] text-muted">{label}</label>
      <input
        type="text"
        value={value}
        readOnly={readOnly}
        onChange={onChange ? (e) => onChange(e.target.value) : undefined}
        className={`w-full rounded-md border border-border bg-surface-inset px-2 py-1 text-xs text-foreground outline-none focus:border-accent/60 ${mono ? 'font-mono' : ''} ${readOnly ? 'opacity-70' : ''}`}
      />
    </div>
  )
}
