import { useEffect } from 'react'
import type { RefObject } from 'react'

/** Эффекты работают с уже видимой разметкой. Вся навигация доступна при отключённой анимации. */
export function useLabMotion(main: RefObject<HTMLElement | null>, screen: string) {
  useEffect(() => {
    const root = main.current
    if (!root) return
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)')
    const fine = window.matchMedia('(pointer: fine) and (hover: hover)')
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue
        if (!reduce.matches) entry.target.classList.add('just-revealed')
        observer.unobserve(entry.target)
      }
    }, {threshold: .08})
    root.querySelectorAll('.lab-card, .wb-panel').forEach(panel => {
      if (panel.getBoundingClientRect().top > window.innerHeight * .85) observer.observe(panel)
    })
    const target = (event: Event) => event.target instanceof Element ?
      event.target.closest<HTMLButtonElement>('button:is(.hero-primary,.primary,.secondary):enabled') : null
    function position(event: PointerEvent) {
      const button = target(event)
      if (!button || !fine.matches || reduce.matches || event.pointerType !== 'mouse') return
      const rect = button.getBoundingClientRect()
      if (!rect.width || !rect.height) return
      button.style.setProperty('--mag-x', ((event.clientX - rect.left) / rect.width * 4 - 2) + 'px')
      button.style.setProperty('--mag-y', ((event.clientY - rect.top) / rect.height * 4 - 2) + 'px')
    }
    function reset(event: PointerEvent) {
      const button = target(event)
      if (!button || (event.relatedTarget instanceof Node && button.contains(event.relatedTarget))) return
      button.style.removeProperty('--mag-x')
      button.style.removeProperty('--mag-y')
    }
    function ripple(event: MouseEvent) {
      const button = target(event)
      if (!button || reduce.matches) return
      const rect = button.getBoundingClientRect()
      button.style.setProperty('--ripple-x', (event.detail ? event.clientX - rect.left : rect.width / 2) + 'px')
      button.style.setProperty('--ripple-y', (event.detail ? event.clientY - rect.top : rect.height / 2) + 'px')
      button.classList.remove('ripple')
      requestAnimationFrame(() => { if (button.isConnected) button.classList.add('ripple') })
    }
    function done(event: AnimationEvent) {
      if (event.animationName === 'button-ripple') target(event)?.classList.remove('ripple')
    }
    root.addEventListener('pointermove', position, {passive: true})
    root.addEventListener('pointerout', reset)
    root.addEventListener('click', ripple, true)
    root.addEventListener('animationend', done)
    return () => {
      observer.disconnect()
      root.removeEventListener('pointermove', position)
      root.removeEventListener('pointerout', reset)
      root.removeEventListener('click', ripple, true)
      root.removeEventListener('animationend', done)
    }
  }, [main, screen])
}
