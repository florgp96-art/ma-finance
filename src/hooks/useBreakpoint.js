import { useState, useEffect } from 'react'

export default function useBreakpoint() {
  const getBreakpoint = (w) => w < 768 ? 'mobile' : w < 1024 ? 'tablet' : 'desktop'
  const [bp, setBp] = useState(() => getBreakpoint(window.innerWidth))

  useEffect(() => {
    const handler = () => setBp(getBreakpoint(window.innerWidth))
    window.addEventListener('resize', handler)
    return () => window.removeEventListener('resize', handler)
  }, [])

  return {
    breakpoint: bp,
    isMobile:  bp === 'mobile',
    isTablet:  bp === 'tablet',
    isDesktop: bp === 'desktop',
  }
}
