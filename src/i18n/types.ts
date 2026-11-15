/** UI 文言の型。正本は ja.ts、en.ts は翻訳。キー欠落は型エラーになる。 */

export type Locale = 'ja' | 'en'

export type Messages = {
  locale: Locale
  htmlLang: string

  app: {
    runSimulation: string
    running: string
    waveform: string
    waveformPts: (points: number, signals: number) => string
    console: string
    logSimStart: string
    logSimComplete: (traces: number, points: number, dataType: string) => string
    logEngineLoading: string
    logEngineReady: (version: string) => string
    logEngineInitFailed: (detail: string) => string
    logSchematicSynced: string
    sampleCircuit: string
    circuit: string
    sampleRing31: string
    sampleInv2Pulse: string
    sampleAdder4: string
    logSampleLoaded: (name: string) => string
    languageToggle: string
  }

  design: {
    tabSchematic: string
    tabNetlist: string
    tabLayout: string
    badgeUnsynced: string
    modified: string
    syncToNetlistAndLayout: string
    syncLayout: string
    saveSchematic: string
    fileName: string
    cancel: string
    confirmSave: string
    importSchematic: string
    importSchematicHint: string
    schematicFileInvalid: string
    schematicExportFailed: string
    schematicImportFailed: string
    wiringHint: string
  }

  library: {
    title: string
    hint: string
    categoryPassive: string
    categorySource: string
    categoryDigital: string
    categoryOther: string
  }

  properties: {
    title: string
    circuitTitle: string
    analysis: string
    analysisTran: string
    analysisAc: string
    analysisOp: string
    selectBlock: string
    fieldRef: string
    fieldValue: string
    fieldVoltage: string
    fieldSubckt: string
    fieldSpice: string
    fieldNetName: string
    fieldFlip: string
    fieldPad: (direction: 'in' | 'out') => string
    voltagePolarityHint: string
    delete: string
  }

  waveform: {
    downloadCsv: string
    downloadFailed: string
    emptyTitle: string
    emptyHint: string
    simulating: string
    axisTime: string
    axisFrequency: string
    yAmplitude: string
    yValue: string
  }

  console: {
    placeholder: string
  }

  gds: {
    downloadGds: string
    downloadTitle: string
    downloadFab: string
    downloadFabTitle: string
    missingCombinedForFab: string
    print: string
    printTitle: string
    openInNewTab: string
    openInNewTabTitle: string
    missingCombined: string
    imageFailed: string
    popupBlocked: string
    printDocumentTitle: string
    printHeading: string
    canvasLabel: string
    viewLoading: string
    viewFailed: (detail: string) => string
    zoomIn: string
    zoomOut: string
    fit: string
    layers: string
  }

  simulation: {
    connectFailed: (detail: string) => string
    requestFailed: (status: number, body: string) => string
    noResult: (reason: string) => string
  }

  layoutApi: {
    connectFailed: (detail: string) => string
    syncFailed: (status: number, body: string) => string
  }

  loadLayout: {
    gzipUnsupported: string
    fetchFailed: (detail: string, url: string) => string
    notFound: (status: number, url: string) => string
  }
}
