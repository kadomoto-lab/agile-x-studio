import type { Messages } from './types'

/** UI 文言の正本（日本語）。 */
const ja: Messages = {
  locale: 'ja',
  htmlLang: 'ja',

  app: {
    runSimulation: 'シミュレーション実行',
    running: '実行中…',
    waveform: '波形',
    waveformPts: (points, signals) =>
      `${signals} 信号 · ${points.toLocaleString('ja-JP')} 点`,
    console: 'コンソール',
    logSimStart: '> シミュレーション開始…',
    logSimComplete: (traces, points, dataType) =>
      `> 完了: ${traces} トレース, ${points} ポイント (${dataType})`,
    logEngineLoading: '> サーバ側シミュレータを確認中…',
    logEngineReady: (version) => `> シミュレータ準備完了 (サーバ: ${version})`,
    logEngineInitFailed: (detail) =>
      `ERROR: サーバ側シミュレータを利用できません — ${detail}`,
    logSchematicSynced: '> ブロック図をネットリストとレイアウトに同期しました',
    sampleCircuit: 'サンプル回路',
    circuit: '回路',
    sampleRing31: '31段リングオシレータ',
    sampleInv2Pulse: '2段INV + 矩形波入力',
    sampleAdder4: '4ビット加算器（NAND2×36・2行配置）',
    logSampleLoaded: (name) => `> サンプル回路を読み込み: ${name}`,
    languageToggle: '表示言語',
  },

  design: {
    tabSchematic: 'ブロック図',
    tabNetlist: 'ネットリスト',
    tabLayout: 'レイアウト',
    badgeUnsynced: '未同期',
    modified: '変更あり',
    syncToNetlistAndLayout: 'ネットリストとレイアウトに反映',
    syncLayout: 'レイアウトを同期',
    saveSchematic: 'ローカルに保存',
    fileName: 'ファイル名',
    cancel: 'キャンセル',
    confirmSave: '保存',
    importSchematic: 'ファイルを読み込む',
    importSchematicHint: '保存したブロック図を読み込みます。ネットリストとレイアウトへの反映は同期ボタンで行ってください。取り消しで元の図に戻せます。',
    schematicFileInvalid: '対応するブロック図ファイルではないか、内容が破損しています。',
    schematicExportFailed: 'ブロック図を保存できませんでした。',
    schematicImportFailed: 'ブロック図ファイルを読み込めませんでした。',
    wiringHint: 'ピンまたは配線をクリックで接続 · Esc / 右クリック / ダブルクリックで中止',
  },

  library: {
    title: 'ライブラリ',
    hint: 'ドラッグまたはクリックで配置',
    categoryPassive: '受動素子',
    categorySource: '電源',
    categoryDigital: 'デジタル (GA)',
    categoryOther: 'その他',
  },

  properties: {
    title: 'プロパティ',
    circuitTitle: '回路タイトル',
    analysis: '解析',
    analysisTran: '過渡 (.tran)',
    analysisAc: 'AC (.ac)',
    analysisOp: '動作点 (.op)',
    selectBlock: 'ブロックを選択してパラメータを編集',
    fieldRef: 'Ref',
    fieldValue: 'Value',
    fieldVoltage: 'Voltage (V)',
    fieldSubckt: 'Subckt',
    fieldSpice: 'SPICE',
    fieldNetName: 'ネット名',
    fieldFlip: '左右反転（ピンを右側に）',
    fieldPad: (direction) => `パッド (ga_${direction})`,
    voltagePolarityHint:
      'SPICE: V{ref} (+) … (−) … — 右が n+、下が n−',
    delete: '削除',
  },

  waveform: {
    downloadCsv: 'CSVダウンロード',
    downloadFailed: '波形のCSVをダウンロードできませんでした。',
    emptyTitle: '波形はここに表示されます',
    emptyHint:
      '左のネットリストを編集し、「シミュレーション実行」を押してください',
    simulating: 'シミュレーション実行中…',
    axisTime: '時間 (s)',
    axisFrequency: '周波数 (Hz)',
    yAmplitude: '振幅',
    yValue: '値',
  },

  console: {
    placeholder: 'シミュレーションログ…',
  },

  gds: {
    downloadGds: 'GDS ダウンロード',
    downloadTitle: '合成済み GDS (base + overlay) をダウンロード',
    downloadFab: '製造データダウンロード',
    downloadFabTitle:
      '合成済み GDS (base_forfab + overlay) をダウンロード',
    missingCombinedForFab:
      'combined_forfab.gds がありません。先にレイアウトを同期してください',
    print: '印刷',
    printTitle: '現在のレイアウト表示を印刷',
    openInNewTab: '新しいタブで開く',
    openInNewTabTitle: '今の表示を高解像度の画像で新しいタブに開く',
    missingCombined:
      'combined.gds がありません。先にレイアウトを同期してください',
    imageFailed: 'レイアウト画像の取得に失敗しました',
    popupBlocked: 'ポップアップがブロックされました。許可してください',
    printDocumentTitle: 'Agile-X Studio - Layout',
    printHeading: 'Agile-X Studio — Layout (base.gds + overlay)',
    canvasLabel: 'レイアウト（ドラッグで移動、ホイールで拡大・縮小、ダブルクリックで全体表示）',
    viewLoading: 'レイアウトを読み込み中…',
    viewFailed: (detail) =>
      `レイアウトを表示できません (${detail})。API サーバーが起動しているか確認してください。`,
    zoomIn: '拡大',
    zoomOut: '縮小',
    fit: '全体表示',
    layers: 'レイヤ',
  },

  simulation: {
    connectFailed: (detail) =>
      `シミュレーション API に接続できません (${detail})。` +
      '`npm run dev` で API サーバーが起動しているか確認してください。',
    requestFailed: (status, body) =>
      `シミュレーション失敗 (HTTP ${status}): ${body}`,
    noResult: (reason) => `シミュレーション結果がありません: ${reason}`,
  },

  layoutApi: {
    connectFailed: (detail) =>
      `レイアウト API に接続できません (${detail})。` +
      '`npm run dev` で API サーバーが起動しているか確認してください。',
    syncFailed: (status, body) =>
      `レイアウト同期失敗 (HTTP ${status}): ${body}`,
  },

  loadLayout: {
    gzipUnsupported:
      'gzip 形式のレイアウトですが、このブラウザは DecompressionStream に未対応です',
    fetchFailed: (detail, url) =>
      `レイアウトの取得に失敗しました (${detail})。URL: ${url}`,
    notFound: (status, url) =>
      `レイアウトが見つかりません (HTTP ${status})。URL: ${url}`,
  },
}

export default ja
