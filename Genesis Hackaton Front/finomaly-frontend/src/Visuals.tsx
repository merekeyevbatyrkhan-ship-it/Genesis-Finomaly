import type { ReactNode } from 'react'

const paths = {
  dashboard: 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z',
  audit: 'M3 12h4l3-6 4 12 3-6h4',
  results: 'M4 20h16M6 16v-4m6 4V5m6 11V9',
  play: 'm9 5 11 7-11 7V5Z',
  arrow: 'M4 12h15m-6-6 6 6-6 6',
  steps: 'M3 17h4v-4h5V9h5V5h4',
  layers: 'm12 3 9 5-9 5-9-5 9-5Zm-9 9 9 5 9-5m-18 4 9 5 9-5',
  file: 'M13 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V10Zm0 0v7h7M8 14h8m-8 3h5',
  duplicate: 'M9 8h11v12H9zM15 8V4H4v11h5',
  check: 'm5 12 5 5 9-10',
  terminal: 'M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Zm3 4 3 3-3 3m6 0h4',
  info: 'M12 11v5m0-8h.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z',
  alert: 'M12 9v4m0 3h.01M10.3 4.7a2 2 0 0 1 3.4 0L21 17a2 2 0 0 1-1.7 3h-14a2 2 0 0 1-1.7-3l6.7-12.3Z',
  target: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-5 0a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z',
  reward: 'M13 2 5 14h6l-1 8 9-12h-6l1-8Z',
} as const

export type IconName = keyof typeof paths

export function Icon({ name }: { name: IconName }) {
  return (
    <svg className="icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor"
      strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round">
      <path d={paths[name]} />
    </svg>
  )
}

export function StatCard({ icon, tone = 'violet', label, children }: {
  icon: IconName
  tone?: 'violet' | 'cyan' | 'rose' | 'green'
  label: string
  children: ReactNode
}) {
  return (
    <div className="stat-card">
      <span className="icon-tile" data-tone={tone}><Icon name={icon} /></span>
      <div className="stat-content">
        <span className="stat-label">{label}</span>
        <strong className="stat-value">{children}</strong>
      </div>
    </div>
  )
}

export function AuditIllustration() {
  return (
    <svg className="audit-illustration" viewBox="0 0 392 174" fill="none" aria-hidden="true">
      <defs>
        <linearGradient id="audit-flow" x1="30" y1="30" x2="350" y2="125" gradientUnits="userSpaceOnUse">
          <stop stopColor="#8d73ff" />
          <stop offset=".58" stopColor="#b59cff" />
          <stop offset="1" stopColor="#64e5ff" />
        </linearGradient>
        <linearGradient id="audit-surface" x1="136" y1="31" x2="252" y2="135" gradientUnits="userSpaceOnUse">
          <stop stopColor="#282248" />
          <stop offset="1" stopColor="#141829" />
        </linearGradient>
      </defs>
      <g stroke="#a28af1" strokeOpacity=".19">
        <path d="M8 38h376M8 62h376M8 86h376M8 110h376M8 134h376M64 14v146m24-146v146m24-146v146m24-146v146m24-146v146m24-146v146m24-146v146m24-146v146m24-146v146m24-146v146m24-146v146m24-146v146" />
      </g>
      <g stroke="url(#audit-flow)" strokeWidth="1.3">
        <path className="audit-signal" pathLength="1" d="M56 54h41l29 32h25M56 118h41l29-32m119 0h33l24 24h30m-54-24 24-32h30" />
        <rect x="150" y="39" width="102" height="96" rx="15" fill="url(#audit-surface)" />
        <path d="M164 60h74M165 109h19l10-20 12 25 11-18h20" />
        <circle cx="56" cy="54" r="20" fill="#221b39" />
        <circle cx="56" cy="118" r="20" fill="#221b39" />
        <circle cx="334" cy="82" r="32" fill="#142937" />
        <path d="M49 46h13v17H49zm3 5h7m-7 4h7M49 112h14v12H49zm3 4h8m-8 4h5M323 83l7 7 14-15" />
      </g>
      <g fill="#cdb9ff">
        <circle cx="165" cy="50" r="2" /><circle cx="173" cy="50" r="2" opacity=".45" />
        <circle cx="181" cy="50" r="2" opacity=".25" />
      </g>
      <circle cx="278" cy="86" r="3" fill="#89e8ff" />
      <circle cx="126" cy="86" r="2.8" fill="#b8a0ff" />
    </svg>
  )
}
