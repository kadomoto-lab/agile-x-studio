import type { Messages } from './types'

/** English translation of ja.ts (source of truth is Japanese). */
const en: Messages = {
  locale: 'en',
  htmlLang: 'en',

  app: {
    runSimulation: 'Run simulation',
    running: 'Running…',
    waveform: 'Waveform',
    waveformPts: (points, signals) => `${points} pts · ${signals} signals`,
    console: 'Console',
    logSimStart: '> Starting simulation…',
    logSimComplete: (traces, points, dataType) =>
      `> Done: ${traces} traces, ${points} points (${dataType})`,
    logEngineLoading: '> Checking the server-side simulator…',
    logEngineReady: (version) => `> Simulator ready (server: ${version})`,
    logEngineInitFailed: (detail) =>
      `ERROR: Server-side simulator unavailable — ${detail}`,
    logSchematicSynced: '> Synced schematic to netlist & layout',
    sampleCircuit: 'Sample circuit',
    sampleRing31: '31-stage ring oscillator',
    sampleInv2Pulse: '2× INV + pulse input',
    sampleAdder4: '4-bit adder (36× NAND2, 2 rows)',
    logSampleLoaded: (name) => `> Loaded sample: ${name}`,
    languageToggle: 'Display language',
  },

  design: {
    tabSchematic: 'Schematic',
    tabNetlist: 'Netlist',
    tabLayout: 'Layout',
    badgeUnsynced: 'unsynced',
    modified: 'modified',
    syncToNetlistAndLayout: 'Sync to Netlist & Layout',
    syncLayout: 'Sync Layout',
    wiringHint: 'Click a pin or wire to connect · Esc / right-click / double-click to cancel',
  },

  library: {
    title: 'Library',
    hint: 'Drag or click to place',
    categoryPassive: 'Passive',
    categorySource: 'Sources',
    categoryDigital: 'Digital (GA)',
    categoryOther: 'Other',
  },

  properties: {
    title: 'Properties',
    circuitTitle: 'Circuit title',
    analysis: 'Analysis',
    analysisTran: 'Transient (.tran)',
    analysisAc: 'AC (.ac)',
    analysisOp: 'Operating point (.op)',
    selectBlock: 'Select a block to edit parameters',
    fieldRef: 'Ref',
    fieldValue: 'Value',
    fieldVoltage: 'Voltage (V)',
    fieldSubckt: 'Subckt',
    fieldSpice: 'SPICE',
    fieldNetName: 'Net name',
    fieldFlip: 'Flip (pin on the right)',
    fieldPad: (direction) => `Pad (ga_${direction})`,
    voltagePolarityHint:
      'SPICE: V{ref} (+) … (−) … — right is n+, bottom is n−',
    delete: 'Delete',
  },

  waveform: {
    emptyTitle: 'Waveforms appear here',
    emptyHint:
      'Edit the netlist on the left, then press “Run simulation”',
    simulating: 'Simulation running…',
    axisTime: 'Time (s)',
    axisFrequency: 'Frequency (Hz)',
    yAmplitude: 'Amplitude',
    yValue: 'Value',
  },

  console: {
    placeholder: 'Simulation log…',
  },

  gds: {
    downloadGds: 'Download GDS',
    downloadTitle: 'Download combined GDS (base + overlay)',
    downloadFab: 'Download fab data',
    downloadFabTitle: 'Download combined GDS (base_forfab + overlay)',
    missingCombinedForFab:
      'combined_forfab.gds is missing. Sync the layout first',
    print: 'Print',
    printTitle: 'Print the current layout view',
    openInNewTab: 'Open in new tab',
    openInNewTabTitle: 'Open the current view as a high-resolution image in a new tab',
    missingCombined:
      'combined.gds is missing. Sync the layout first',
    imageFailed: 'Failed to capture the layout image',
    popupBlocked: 'Popup blocked. Please allow popups',
    printDocumentTitle: 'Agile-X Studio - Layout',
    printHeading: 'Agile-X Studio — Layout (base.gds + overlay)',
    canvasLabel: 'Layout (drag to pan, wheel to zoom, double-click to fit)',
    viewLoading: 'Loading layout…',
    viewFailed: (detail) =>
      `Cannot show the layout (${detail}). Make sure the API server is running.`,
    zoomIn: 'Zoom in',
    zoomOut: 'Zoom out',
    fit: 'Fit',
    layers: 'Layers',
  },

  simulation: {
    connectFailed: (detail) =>
      `Cannot reach the simulation API (${detail}). ` +
      'Make sure the API server is running (`npm run dev`).',
    requestFailed: (status, body) =>
      `Simulation failed (HTTP ${status}): ${body}`,
    noResult: (reason) => `Simulation produced no result: ${reason}`,
  },

  layoutApi: {
    connectFailed: (detail) =>
      `Cannot reach the layout API (${detail}). ` +
      'Make sure the API server is running (`npm run dev`).',
    syncFailed: (status, body) =>
      `Layout sync failed (HTTP ${status}): ${body}`,
  },

  loadLayout: {
    gzipUnsupported:
      'Layout is gzip-compressed, but this browser lacks DecompressionStream',
    fetchFailed: (detail, url) =>
      `Failed to fetch layout (${detail}). URL: ${url}`,
    notFound: (status, url) =>
      `Layout not found (HTTP ${status}). URL: ${url}`,
  },
}

export default en
