import { useLayoutEffect, useRef, useState } from 'react'
import type { Episode, RecordRef } from './auditTypes'
import { formatAmount } from './auditTypes'
import { Icon } from './Visuals'

export type OpenRecord = (ref: RecordRef, trigger: HTMLElement) => void

export function findRecord(episode: Episode, reference: RecordRef) {
  return episode[reference.source].find(({ id }) => id === reference.id)
}

export function useRecordInspector() {
  const [selected, setSelected] = useState<RecordRef | null>(null)
  const origin = useRef<HTMLElement | null>(null)

  const open: OpenRecord = (record, trigger) => {
    if (!trigger.closest('#record-inspector')) origin.current = trigger
    setSelected(record)
  }

  function close() {
    setSelected(null)
    if (origin.current?.isConnected) origin.current.focus()
    origin.current = null
  }

  return { selected, open, close }
}

export function RecordInspector({ episode, reference, onClose, onOpen }: {
  episode: Episode
  reference: RecordRef
  onClose: () => void
  onOpen: OpenRecord
}) {
  const heading = useRef<HTMLHeadingElement>(null)
  useLayoutEffect(() => { heading.current?.focus() }, [reference])

  const record = findRecord(episode, reference)
  const document = episode.documents.find((item) => reference.source === 'documents' && item.id === reference.id)
  const ledger = episode.ledger.find((item) => reference.source === 'ledger' && item.id === reference.id)
  const related = document
    ? episode.ledger.filter((row) => row.documentIds.includes(document.id))
      .map((row) => ({ ...row, source: 'ledger' as const, label: row.description }))
    : episode.documents.filter((item) => ledger?.documentIds.includes(item.id))
      .map((item) => ({ ...item, source: 'documents' as const, label: item.kind }))

  return (
    <aside className="card inspector" id="record-inspector" aria-labelledby="record-inspector-title"
      onKeyDown={(event) => { if (event.key === 'Escape') onClose() }}>
      <div className="panel-title inspector-header">
        <div>
          <p className="inspector-type">{document?.kind ?? (ledger ? 'Проводка' : 'Запись')}</p>
          <h2 id="record-inspector-title" ref={heading} tabIndex={-1}><code>{reference.id}</code></h2>
        </div>
        <button className="secondary inspector-close" type="button" onClick={onClose} aria-label="Закрыть подробности записи">×</button>
      </div>
      {record ? (
        <>
          <dl className="inspector-fields">
            <div><dt>Дата</dt><dd><time dateTime={record.date}>{record.date}</time></dd></div>
            <div><dt>Сумма</dt><dd>{formatAmount(record.amountMinor, record.currency)}</dd></div>
            <div><dt>Валюта</dt><dd>{record.currency}</dd></div>
            <div><dt>Контрагент</dt><dd>{record.counterparty}</dd></div>
            <div><dt>Счёт</dt><dd><code>{record.invoiceId}</code></dd></div>
            {document?.note ? <div className="full"><dt>Примечание</dt><dd>{document.note}</dd></div> : null}
          </dl>
          <h3>{document ? 'Связанные операции' : 'Связанные документы'}</h3>
          {related.length ? (
            <ul className="record-items">
              {related.map((item) => (
                <li key={item.id}>
                  <button className="record-item" type="button"
                    onClick={(event) => onOpen({ id: item.id, source: item.source }, event.currentTarget)}>
                    <span><code>{item.id}</code><small>{item.label}</small></span>
                    <span className="amount">{formatAmount(item.amountMinor, item.currency)}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : <p className="muted inspector-empty">Связанные записи отсутствуют в открытом наборе.</p>}
        </>
      ) : <p className="muted">Подробности этой записи не получены.</p>}
    </aside>
  )
}

export function RecordButton({ reference, selected, onOpen }: {
  reference: RecordRef
  selected?: RecordRef | null
  onOpen: OpenRecord
}) {
  const active = selected?.id === reference.id && selected.source === reference.source
  return (
    <button className="record-link" type="button" aria-expanded={active}
      aria-controls={active ? 'record-inspector' : undefined}
      onClick={(event) => onOpen(reference, event.currentTarget)}>
      <code>{reference.id}</code><Icon name="arrow" />
    </button>
  )
}
