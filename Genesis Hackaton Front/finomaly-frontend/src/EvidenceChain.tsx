import type { Episode, Finding, RecordRef } from './auditTypes'
import { formatAmount } from './auditTypes'
import type { OpenRecord } from './RecordInspector'
import { Icon } from './Visuals'

export function EvidenceChain({ episode, finding, onOpen }: {
  episode: Episode
  finding: Finding
  onOpen: OpenRecord
}) {
  const anchors = new Set([...finding.evidenceIds, ...finding.affectedIds])
  const invoiceIds = new Set([...episode.ledger, ...episode.documents]
    .filter((record) => anchors.has(record.id)).map((record) => record.invoiceId))
  const affected = new Set(finding.affectedIds)

  if (!invoiceIds.size) return null

  return (
    <section className="evidence-chain" aria-label="Цепочка доказательств">
      <h4>Цепочка доказательств</h4>
      {[...invoiceIds].map((invoiceId) => {
        const documents = episode.documents.filter((row) => row.invoiceId === invoiceId)
        const invoices = documents.filter((row) => row.kind === 'Счёт')
        const supporting = documents.filter((row) => row.kind !== 'Счёт')
        const ledger = episode.ledger.filter((row) => row.invoiceId === invoiceId)
        const lanes = [
          { title: 'Счёт', source: 'documents', items: invoices },
          { title: 'Проводки по счёту', source: 'ledger', items: ledger },
          { title: 'Платежи и документы', source: 'documents', items: supporting },
        ] as const

        return (
          <div className="chain-map" key={invoiceId} aria-label={invoiceId}>
            {lanes.map(({ title, source, items }) => (
              <section className="chain-lane" aria-label={title} key={title}>
                <h5>{title}</h5>
                {items.length ? items.map((item) => (
                  <button className="chain-node" type="button" key={item.id}
                    data-affected={affected.has(item.id) || undefined}
                    onClick={(event) => {
                      const reference: RecordRef = { source, id: item.id }
                      onOpen(reference, event.currentTarget)
                    }}>
                    <span><Icon name={source === 'documents' ? 'file' : 'audit'} /><code>{item.id}</code></span>
                    <small>{formatAmount(item.amountMinor, item.currency)}</small>
                    {affected.has(item.id) ? <small className="chain-flag">Затронута</small> : null}
                  </button>
                )) : <p className="muted">Нет открытых записей</p>}
              </section>
            ))}
          </div>
        )
      })}
    </section>
  )
}
