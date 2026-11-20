import { useLayoutEffect, useRef, useState } from 'react'
import type { Episode, RecordRef } from './auditTypes'
import { formatAmount } from './auditTypes'
import { Icon } from './Visuals'

export type OpenRecord = (reference: RecordRef, trigger: HTMLElement) => void

export function findRecord(episode: Episode, reference: RecordRef) {
  return episode[reference.source].find(({ id }) => id === reference.id)
}

export function useRecordInspector() {
  const [selected, setSelected] = useState<RecordRef | null>(null)
  const origin = useRef<HTMLElement | null>(null)

  const open: OpenRecord = (record, trigger) => {
    // Связанные записи меняют содержимое той же панели. Фокус вернётся к исходной строке.
    if (!trigger.closest('#record-inspector')) origin.current = trigger
    setSelected(record)
  }

  function close() {
    const trigger = origin.current
    origin.current = null
    setSelected(null)
    if (trigger?.isConnected) trigger.focus({ preventScroll: true })
  }

  return { selected, open, close }
}

export function RecordInspector({ episode, reference, onClose, onOpen }: {
  episode: Episode
  reference: RecordRef
  onClose: () => void
  onOpen: OpenRecord
}) {
  const drawer = useRef<HTMLDialogElement>(null)
  const heading = useRef<HTMLHeadingElement>(null)

  useLayoutEffect(() => {
    const panel = drawer.current
    if (!panel) return
    panel.showModal()
    return () => panel.close()
  }, [])
  useLayoutEffect(() => {
    drawer.current?.scrollTo({ top: 0 })
    heading.current?.focus({ preventScroll: true })
  }, [reference])

  function dismiss() {
    drawer.current?.close()
    onClose()
  }

  const record = findRecord(episode, reference)
  const doc = episode.documents.find((item) => reference.source === 'documents' && item.id === reference.id)
  const ledger = episode.ledger.find((item) => reference.source === 'ledger' && item.id === reference.id)
  const related = doc
    ? episode.ledger.filter((row) => row.documentIds.includes(doc.id))
      .map((row) => ({ ...row, source: 'ledger' as const, label: row.description }))
    : episode.documents.filter((item) => ledger?.documentIds.includes(item.id))
      .map((item) => ({ ...item, source: 'documents' as const, label: item.kind }))

  return (
    <dialog ref={drawer} id="record-inspector" className="wb-drawer" aria-labelledby="record-inspector-title"
      onCancel={(event) => { event.preventDefault(); dismiss() }}
      onClick={(event) => {
        if (event.target !== event.currentTarget) return
        const rect = event.currentTarget.getBoundingClientRect()
        if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dismiss()
      }}>
      <header className="wb-drawer-bar">
        <span><Icon name={doc ? 'file' : 'layers'} /> {doc ? 'Просмотр документа' : 'Просмотр проводки'}</span>
        <button type="button" className="wb-icon-button" onClick={dismiss} aria-label="Закрыть подробности записи">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12m0-12L6 18" /></svg>
        </button>
      </header>
      <div className="wb-drawer-body">
        <section className="wb-paper" aria-label="Реквизиты записи">
          <div className="wb-paper-top"><Icon name={doc ? 'file' : 'audit'} /><span>{doc?.kind ?? 'Проводка'}</span></div>
          <h2 id="record-inspector-title" ref={heading} tabIndex={-1}>{reference.id}</h2>
          {record ? <>
            <p className="wb-paper-subtitle">{doc?.reference ?? ledger?.description}</p>
            <dl className="wb-paper-fields">
              <div><dt>Дата</dt><dd><time dateTime={record.date}>{record.date}</time></dd></div>
              <div><dt>Валюта</dt><dd>{record.currency}</dd></div>
              <div><dt>Контрагент</dt><dd>{record.counterparty}</dd></div>
              <div><dt>Счёт</dt><dd>{record.invoiceId}</dd></div>
            </dl>
            <div className="wb-paper-total"><span>Сумма</span><strong>{formatAmount(record.amountMinor, record.currency)}</strong></div>
          </> : <p>Подробности этой записи не получены.</p>}
        </section>
        {doc?.note ? <section className="wb-drawer-note"><h3>Примечание</h3><p>{doc.note}</p></section> : null}
        {record && <section className="wb-related">
          <div className="wb-section-heading">
            <h3>{doc ? 'Связанные операции' : 'Связанные документы'}</h3>
            <span className="wb-count">{related.length}</span>
          </div>
          {related.length ? (
            <ul className="wb-record-list">
              {related.map((item) => (
                <li key={item.id}>
                  <button type="button" onClick={(event) => onOpen({ id: item.id, source: item.source }, event.currentTarget)}>
                    <span><code>{item.id}</code><small>{item.label}</small></span>
                    <span className="wb-list-end">{formatAmount(item.amountMinor, item.currency)} <Icon name="arrow" /></span>
                  </button>
                </li>
              ))}
            </ul>
          ) : <p className="wb-note">В открытых данных эпизода связанных записей нет.</p>}
        </section>}
      </div>
    </dialog>
  )
}

export function RecordButton({ reference, selected, onOpen }: {
  reference: RecordRef
  selected?: RecordRef | null
  onOpen: OpenRecord
}) {
  const active = selected?.id === reference.id && selected.source === reference.source
  return (
    <button className="wb-record-link" type="button" aria-haspopup="dialog" aria-expanded={active}
      aria-controls={active ? 'record-inspector' : undefined}
      onClick={(event) => onOpen(reference, event.currentTarget)}>
      <code>{reference.id}</code><Icon name="arrow" />
    </button>
  )
}
