import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { Episode, Finding, RecordRef } from './auditTypes'
import { formatAmount } from './auditTypes'
import type { OpenRecord } from './RecordInspector'
import { Icon } from './Visuals'

type Link = { from: string; to: string }
type Node = RecordRef & { amountMinor: number; currency: string; label: string }

function InvoiceMap({ episode, finding, invoiceId, onOpen }: {
  episode: Episode
  finding: Finding
  invoiceId: string
  onOpen: OpenRecord
}) {
  const area = useRef<HTMLDivElement>(null)
  const [paths, setPaths] = useState<Array<Link & { d: string }>>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const affected = new Set(finding.affectedIds)
  const { lanes, links, incoming, outgoing } = useMemo(() => {
    const documents = episode.documents.filter((doc) => doc.invoiceId === invoiceId)
    const ledger = episode.ledger.filter((row) => row.invoiceId === invoiceId)
    const documentsById = new Map(documents.map((doc) => [doc.id, doc]))
    const nodes: Node[] = documents.map((doc) => ({ ...doc, label: doc.kind, source: 'documents' }))
    const links: Link[] = []
    const incoming = new Map<string, string[]>()
    const outgoing = new Map<string, string[]>()
    for (const row of ledger) {
      for (const id of new Set(row.documentIds)) {
        const doc = documentsById.get(id)
        if (!doc) continue
        const link = doc.kind === 'Счёт' ? { from: doc.id, to: row.id } : { from: row.id, to: doc.id }
        links.push(link)
        if (!incoming.has(link.to)) incoming.set(link.to, [])
        if (!outgoing.has(link.from)) outgoing.set(link.from, [])
        incoming.get(link.to)!.push(link.from)
        outgoing.get(link.from)!.push(link.to)
      }
    }
    return {
      links, incoming, outgoing,
      lanes: [
        { title: 'Первичные счета', nodes: nodes.filter((item) => item.label === 'Счёт') },
        { title: 'Проводки', nodes: ledger.map((row): Node => ({ ...row, label: row.description, source: 'ledger' })) },
        { title: 'Платежи и документы', nodes: nodes.filter((item) => item.label !== 'Счёт') },
      ],
    }
  }, [episode.ledger, episode.documents, invoiceId])

  // Рёбра выводятся из documentIds. Геометрия следует за переносами текста и шириной контейнера.
  useLayoutEffect(() => {
    const graph = area.current
    if (!graph) return
    const nodes = [...graph.querySelectorAll<HTMLElement>('[data-node]')]
    const measure = () => {
      const bounds = graph.getBoundingClientRect()
      const rects = new Map(nodes.map((node) => [node.dataset.node, node.getBoundingClientRect()]))
      setPaths(links.flatMap((edge) => {
        const left = rects.get(edge.from)
        const right = rects.get(edge.to)
        if (!left || !right) return []
        const x1 = left.right - bounds.left, x2 = right.left - bounds.left
        const y1 = left.top + left.height / 2 - bounds.top, y2 = right.top + right.height / 2 - bounds.top
        const mid = (x1 + x2) / 2
        return [{ ...edge, d: `M ${x1},${y1} C ${mid},${y1} ${mid},${y2} ${x2},${y2}` }]
      }))
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(graph)
    nodes.forEach((node) => observer.observe(node))
    return () => observer.disconnect()
  }, [links])

  return (
    <section className="wb-map" aria-label={'Связи по счёту ' + invoiceId}>
      <header><span><Icon name="layers" /> Связи по счёту</span><code>{invoiceId}</code></header>
      <div className="wb-map-area" ref={area}>
        <svg className="wb-edges" width="100%" height="100%" aria-hidden="true">
          {paths.map(({ from, to, d }) => <path key={from + ':' + to} d={d}
            data-active={activeId ? activeId === from || activeId === to : undefined} />)}
        </svg>
        {lanes.map(({ title, nodes }) => (
          <section className="wb-lane" aria-label={title} key={title}>
            <h5>{title}</h5>
            <div className="wb-node-list">
              {nodes.length ? nodes.map((node) => {
                const related = [...(incoming.get(node.id) ?? []), ...(outgoing.get(node.id) ?? [])]
                return (
                <button className="wb-node" key={node.id} type="button" data-node={node.id} aria-haspopup="dialog"
                  data-incoming={incoming.has(node.id) || undefined} data-outgoing={outgoing.has(node.id) || undefined}
                  data-affected={affected.has(node.id) || undefined}
                  onPointerEnter={() => setActiveId(node.id)} onPointerLeave={() => setActiveId(null)}
                  onFocus={() => setActiveId(node.id)} onBlur={() => setActiveId(null)}
                  onClick={(event) => onOpen({ source: node.source, id: node.id }, event.currentTarget)}>
                  <span><Icon name={node.source === 'documents' ? 'file' : 'audit'} /><code>{node.id}</code></span>
                  <small>{formatAmount(node.amountMinor, node.currency)}</small>
                  {affected.has(node.id) && <small className="wb-node-flag">С расхождением</small>}
                  {related.length > 0 && <small className="wb-node-related">Связи · {related.join(', ')}</small>}
                </button>
                )
              }) : <small className="wb-note">Нет открытых записей</small>}
            </div>
          </section>
        ))}
      </div>
    </section>
  )
}

export function EvidenceChain({ episode, finding, onOpen }: {
  episode: Episode
  finding: Finding
  onOpen: OpenRecord
}) {
  const anchors = new Set([...finding.evidenceIds, ...finding.affectedIds])
  const invoiceIds = new Set([...episode.ledger, ...episode.documents]
    .filter((record) => anchors.has(record.id)).map((record) => record.invoiceId))
  if (!invoiceIds.size) return null
  return (
    <section className="wb-chains" aria-label="Цепочка доказательств">
      {[...invoiceIds].map((invoiceId) => (
        <InvoiceMap key={invoiceId} episode={episode} finding={finding} invoiceId={invoiceId} onOpen={onOpen} />
      ))}
    </section>
  )
}
