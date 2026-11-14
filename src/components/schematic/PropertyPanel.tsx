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
    <aside className="flex w-52 shrink-0 flex-col border-l border-hairline bg-surface-muted">
      <div className="border-b border-hairline px-3 pb-2 pt-2.5">
        <h2 className="text-[13px] font-semibold text-foreground">
          {messages.properties.title}
        </h2>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto px-3 pb-4 pt-3">
        <div>
          <label className="mb-1 block text-[11px] font-medium text-muted">
            {messages.properties.circuitTitle}
          </label>
          <input
            type="text"
            value={title}
            onChange={(e) => onTitleChange(e.target.value)}
            className="h-8 w-full rounded-md border border-border bg-surface px-2 text-[12.5px] text-foreground outline-none transition-colors hover:border-border-strong focus:border-accent focus:ring-2 focus:ring-accent/20"
          />
        </div>

        <div>
          <label className="mb-1 block text-[11px] font-medium text-muted">
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
            className="mb-1.5 h-8 w-full rounded-md border border-border bg-surface px-2 text-[12.5px] text-foreground outline-none transition-colors hover:border-border-strong focus:border-accent focus:ring-2 focus:ring-accent/20"
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
              className="h-8 w-full rounded-md border border-border bg-surface px-2 text-[12.5px] text-foreground outline-none transition-colors hover:border-border-strong focus:border-accent focus:ring-2 focus:ring-accent/20 font-mono"
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
          <p className="border-t border-hairline pt-4 text-[12px] leading-relaxed text-muted-light">
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
    <div className="space-y-3 border-t border-hairline pt-4">
      <div className="text-[13px] font-semibold text-foreground">{lib.label}</div>

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
              <label className="mb-1 block text-[11px] font-medium text-muted">
                {messages.properties.fieldSpice}
              </label>
              <pre className="overflow-x-auto rounded-md border border-hairline bg-surface-inset p-2 font-mono text-[11px] leading-relaxed text-muted">
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
            <p className="text-[11px] leading-relaxed text-muted-light">
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
                  <label className="mb-1 block text-[11px] font-medium text-muted">
                    {messages.properties.fieldSpice}
                  </label>
                  <pre className="overflow-x-auto rounded-md border border-hairline bg-surface-inset p-2 font-mono text-[11px] leading-relaxed text-muted">
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
          <label className="flex items-center gap-2 text-[12px] text-muted">
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
            <label className="mb-1 block text-[11px] font-medium text-muted">
              {messages.properties.fieldPad(
                d.kind === 'ga_io_in' ? 'in' : 'out',
              )}
            </label>
            <select
              value={d.padIndex ?? 0}
              onChange={(e) => onUpdate({ padIndex: Number(e.target.value) })}
              className="h-8 w-full rounded-md border border-border bg-surface px-2 text-[12.5px] text-foreground outline-none transition-colors hover:border-border-strong focus:border-accent focus:ring-2 focus:ring-accent/20"
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
        className="mt-1 h-8 w-full rounded-md border border-transparent text-[12px] font-medium text-danger transition-colors hover:border-danger/30 hover:bg-danger/[0.06]"
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
      <label className="mb-1 block text-[11px] font-medium text-muted">{label}</label>
      <input
        type="text"
        value={value}
        readOnly={readOnly}
        onChange={onChange ? (e) => onChange(e.target.value) : undefined}
        className={`h-8 w-full rounded-md border px-2 text-[12.5px] text-foreground outline-none transition-colors ${mono ? 'font-mono' : ''} ${readOnly ? 'border-hairline bg-surface-inset text-muted' : 'border-border bg-surface hover:border-border-strong focus:border-accent focus:ring-2 focus:ring-accent/20'}`}
      />
    </div>
  )
}
