import Editor, { type OnMount } from '@monaco-editor/react'

type CodeEditorProps = {
  value: string
  onChange: (value: string) => void
  readOnly?: boolean
}

export function CodeEditor({ value, onChange, readOnly }: CodeEditorProps) {
  const handleMount: OnMount = (monacoEditor) => {
    monacoEditor.updateOptions({
      fontFamily: "'IBM Plex Mono', monospace",
      fontSize: 13,
      lineHeight: 20,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      padding: { top: 12, bottom: 12 },
      renderLineHighlight: 'line',
      bracketPairColorization: { enabled: true },
    })
  }

  return (
    <Editor
      height="100%"
      language="plaintext"
      theme="vs"
      value={value}
      onChange={(v) => onChange(v ?? '')}
      onMount={handleMount}
      options={{
        readOnly,
        automaticLayout: true,
        tabSize: 2,
        wordWrap: 'on',
      }}
    />
  )
}
