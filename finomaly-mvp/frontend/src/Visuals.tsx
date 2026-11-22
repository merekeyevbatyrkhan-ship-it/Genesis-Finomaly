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
  sliders: 'M4 7h7m4 0h5M4 17h3m4 0h9M11 4v6m-4 4v6',
  book: 'M3 5c3-1.4 6-1 9 1.1C15 4 18 3.6 21 5v14c-3-1.3-6-1-9 1-3-2-6-2.3-9-1V5Zm9 1v14',
  currency: 'M5 6h13M5 10h11M9 10v9m5-9v9M3 19h15',
  globe: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM3 12h18m-9-9c-5 6-5 12 0 18 5-6 5-12 0-18Z',
  compass: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-6-3-2 5-4 1 2-5 4-1Z',
  circlePlay: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-11-4 6 4-6 4V8Z',
  chevron: 'm7 10 5 5 5-5',
  menu: 'M3 7h18M3 12h14M3 17h18',
  close: 'm6 6 12 12M18 6 6 18',
  hash: 'm9 3-3 18m12-18-3 18M4 9h17M3 15h17',
  server: 'M4 4h16v6H4zm0 10h16v6H4zm3-7h1m-1 10h1',
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
