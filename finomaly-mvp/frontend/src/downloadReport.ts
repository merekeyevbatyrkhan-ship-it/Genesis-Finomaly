import { episodeStatus, formatAmount, periodLabel, SCENARIOS } from './auditTypes'
import type { AuditStep, Episode, RecordRef } from './auditTypes'

const percentage = new Intl.NumberFormat('ru-RU', { style: 'percent', maximumFractionDigits: 1 })
const number = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 3 })
const statuses: Record<AuditStep['status'], string> = {
  ok: 'Успешно', error: 'Ошибка', terminated: 'Завершён', truncated: 'Лимит исчерпан',
}

// Все стили входят в файл, в том числе версия таблиц и журнала для печати.
const reportStyles = `
  *, *::before, *::after { box-sizing: border-box; }
  html { color-scheme: light; background: #f3f4f8; }
  body { margin: 0 auto; max-width: 1024px; padding: clamp(16px, 4vw, 48px); color: #23263a; font: 15px/1.55 system-ui, sans-serif; }
  header, section { margin: 0 0 18px; padding: clamp(14px, 3vw, 30px); border: 1px solid #d5d8e6; border-radius: 12px; background: #fff; }
  section, tr { scroll-margin-block-start: 12px; }
  h1, h2, h3, p, dl, pre { margin: 0; }
  h1 { font-size: clamp(28px, 4vw, 44px); line-height: 1.12; letter-spacing: -.05em; }
  h2 { font-size: 22px; letter-spacing: -.03em; }
  h3 { font-size: 17px; }
  p + p, h3 + p, ol, pre, table, .facts { margin-top: 10px; }
  .brand, dt, caption, nav, .note { color: #53596d; font-size: 13px; }
  .brand { color: #53438f; font-weight: 700; letter-spacing: .08em; }
  .company { margin-top: 8px; font-size: 19px; }
  header p, main p, code, td, dd, pre, h3 { overflow-wrap: anywhere; }
  nav { display: flex; flex-wrap: wrap; gap: 8px 18px; margin-top: 14px; }
  a { color: #48328a; text-underline-offset: 3px; }
  a:focus-visible { outline: 2px solid #4e38a6; outline-offset: 2px; }
  .facts { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(170px, 100%), 1fr)); gap: 10px 18px; }
  dd { margin: 2px 0 0; font-weight: 600; }
  ol { padding-left: 22px; }
  ol > li + li { border-top: 1px solid #dadde7; margin-top: 14px; padding-top: 12px; }
  .scroll { overflow: auto; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  caption { text-align: left; padding: 0 0 8px; }
  th, td { padding: 8px; text-align: left; vertical-align: top; border-bottom: 1px solid #d5d8e6; }
  th[scope=col] { background: #f0eff9; }
  tr:target { background: #e9e4ff; }
  code, pre { font-family: ui-monospace, Consolas, monospace; }
  .note { display: block; margin-top: 4px; }
  pre { white-space: pre-wrap; padding: 10px; background: #f4f3f9; border-radius: 5px; font-size: 12px; }
  @media print {
    @page { size: auto; margin: 14mm; }
    html, body { background: white; }
    body { max-width: none; margin: 0; padding: 0; font-size: 10pt; }
    nav, .print-hint { display: none; }
    header, section { border: 0; border-bottom: 1px solid #bbb; border-radius: 0; padding: 10pt 0; margin: 0; }
    h1, h2, h3, caption { break-after: avoid; }
    tr { break-inside: avoid; }
    thead { display: table-header-group; }
    .scroll { overflow: visible; }
    th, td { font-size: 8pt; padding: 4pt; }
    .facts { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  }
`

export function downloadReport(episode: Episode, mode: 'demo' | 'api') {
  const { result, config } = episode
  if (!result || episode.status === 'running') return

  const doc = document.implementation.createHTMLDocument('FINOMALY — ' + config.companyName)
  doc.documentElement.lang = 'ru'

  // Данные API записываются только как текст. ID и адреса ссылок мы создаём сами.
  function element<K extends keyof HTMLElementTagNameMap>(parent: Element, tag: K, value?: string | number) {
    const node = doc.createElement(tag)
    if (value !== undefined) node.textContent = String(value)
    parent.append(node)
    return node
  }
  function facts(parent: Element, entries: Array<[string, string | number]>) {
    const list = element(parent, 'dl')
    list.className = 'facts'
    for (const [label, value] of entries) {
      const pair = element(list, 'div')
      element(pair, 'dt', label)
      element(pair, 'dd', value)
    }
  }
  function section(parent: Element, id: string, title: string) {
    const block = element(parent, 'section')
    block.id = id
    element(block, 'h2', title)
    return block
  }
  const charset = doc.createElement('meta')
  charset.setAttribute('charset', 'utf-8')
  doc.head.prepend(charset)
  const policy = element(doc.head, 'meta')
  policy.httpEquiv = 'Content-Security-Policy'
  policy.content = "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"
  const viewport = element(doc.head, 'meta')
  viewport.name = 'viewport'
  viewport.content = 'width=device-width, initial-scale=1'
  element(doc.head, 'style', reportStyles)

  const header = element(doc.body, 'header')
  element(header, 'p', 'FINOMALY').className = 'brand'
  element(header, 'h1', 'Отчёт об аудите')
  element(header, 'p', config.companyName).className = 'company'
  element(header, 'p', mode === 'demo' ? 'Локальное демо · Синтетические данные' : 'Метрики оценщика · Данные API').className = 'note'
  const nav = element(header, 'nav')
  nav.setAttribute('aria-label', 'Содержание отчёта')
  const chapters = { setup: 'Эпизод', metrics: 'Метрики', findings: 'Выводы', records: 'Записи', trace: 'Журнал действий' }
  for (const [id, title] of Object.entries(chapters)) element(nav, 'a', title).setAttribute('href', '#' + id)
  element(header, 'p', 'Для печати нажмите Ctrl+P или ⌘P.').className = 'note print-hint'

  const main = element(doc.body, 'main')
  facts(section(main, 'setup', chapters.setup), [
    ['Эпизод', episode.id], ['Состояние', episodeStatus[episode.status]], ['Сценарий', SCENARIOS[config.scenario].title],
    ['Seed', config.seed], ['Отчётный период', periodLabel(config)], ['Базовая валюта', config.baseCurrency],
    ['Бюджет шагов', episode.stepBudget], ['Использовано', episode.stepBudget - episode.stepsRemaining], ['Осталось', episode.stepsRemaining],
  ])
  facts(section(main, 'metrics', chapters.metrics), [
    ['Точность (Precision)', percentage.format(result.precision)], ['Полнота (Recall)', percentage.format(result.recall)],
    ['F1', percentage.format(result.f1)], ['Награда', number.format(result.reward)],
  ])

  // Указатели сохраняют точный источник в ответах агента, даже если оба набора содержат одинаковый ID.
  const records = [
    ...episode.documents.map((row) => ({ row, source: 'documents' as const })),
    ...episode.ledger.map((row) => ({ row, source: 'ledger' as const })),
  ]
  const anchors = new Map(records.map(({ source, row }, index) => [source + '/' + row.id, 'record-' + (index + 1)]))
  function references(parent: Element, refs: ReadonlyArray<{ id: string; source?: RecordRef['source'] }>) {
    if (!refs.length) parent.append('Нет')
    refs.forEach(({ id, source }, index) => {
      if (index) parent.append(', ')
      const anchor = source ? anchors.get(source + '/' + id) : anchors.get('documents/' + id) ?? anchors.get('ledger/' + id)
      if (anchor) element(parent, 'a', id).setAttribute('href', '#' + anchor)
      else element(parent, 'code', id + ' (запись недоступна)')
    })
  }
  const findings = section(main, 'findings', chapters.findings)
  if (!result.findings.length) element(findings, 'p', 'Список выводов агента пуст.')
  else {
    const list = element(findings, 'ol')
    result.findings.forEach((finding) => {
      const item = element(list, 'li')
      element(item, 'h3', finding.title)
      element(item, 'p', finding.explanation)
      element(item, 'p', 'Сумма расхождения — ' + formatAmount(finding.amountMinor, finding.currency))
      references(element(item, 'p', 'Затронутые записи — '), finding.affectedIds.map((id) => ({ id })))
      references(element(item, 'p', 'Доказательства — '), finding.evidenceIds.map((id) => ({ id })))
    })
  }

  const evidence = section(main, 'records', chapters.records)
  if (!records.length) element(evidence, 'p', 'Среда не передала открытые записи.')
  else {
    const wrap = element(evidence, 'div')
    wrap.className = 'scroll'
    wrap.tabIndex = 0
    wrap.setAttribute('role', 'region')
    wrap.setAttribute('aria-label', 'Открытые записи эпизода')
    const table = element(wrap, 'table')
    element(table, 'caption', 'Открытые документы и проводки эпизода')
    const heading = table.createTHead().insertRow()
    for (const label of ['Запись', 'Дата', 'Контрагент', 'Сумма', 'Описание и связи']) element(heading, 'th', label).scope = 'col'
    const body = table.createTBody()
    for (const { row, source } of records) {
      const tr = body.insertRow()
      tr.id = anchors.get(source + '/' + row.id)!
      element(tr, 'th', row.id).scope = 'row'
      element(tr, 'td', row.date)
      element(tr, 'td', row.counterparty)
      const amount = element(tr, 'td', formatAmount(row.amountMinor, row.currency))
      element(amount, 'small', row.currency).className = 'note'
      const description = element(tr, 'td', 'description' in row ? row.description : row.kind + ' · ' + row.reference)
      element(description, 'small', 'Счёт ' + row.invoiceId).className = 'note'
      if ('documentIds' in row && row.documentIds.length) {
        const links = element(description, 'small')
        links.className = 'note'
        references(links, row.documentIds.map((id) => ({ id, source: 'documents' })))
      }
      if ('note' in row && row.note) element(description, 'small', row.note).className = 'note'
    }
  }

  const trace = section(main, 'trace', chapters.trace)
  if (!episode.trace.length) element(trace, 'p', 'Журнал действий пуст.')
  else {
    const list = element(trace, 'ol')
    for (const step of episode.trace) {
      const item = element(list, 'li')
      item.value = step.number
      element(item, 'h3', step.action)
      element(item, 'p', step.observation)
      element(item, 'p', statuses[step.status] + ' · Потрачено шагов — ' + step.spentSteps + ' · Осталось — ' + step.stepsRemaining).className = 'note'
      element(item, 'p', 'Параметры запроса')
      element(item, 'pre', JSON.stringify(step.params, null, 2))
      references(element(item, 'p', 'Полученные записи — '), step.records)
    }
  }

  const file = new Blob(['<!doctype html>\n', doc.documentElement.outerHTML], { type: 'text/html;charset=utf-8' })
  const address = URL.createObjectURL(file)
  const link = document.createElement('a')
  link.href = address
  const safeId = episode.id.replace(/[^a-z\d._-]/gi, '_').slice(0, 100)
  link.download = 'FINOMALY-' + (safeId || 'episode') + '.html'
  document.body.append(link)
  link.click()
  link.remove()
  // Даём браузеру принять файл до освобождения Blob URL.
  window.setTimeout(() => URL.revokeObjectURL(address), 60_000)
}
