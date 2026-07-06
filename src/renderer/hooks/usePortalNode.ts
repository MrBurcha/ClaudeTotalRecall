import { useEffect, useState } from 'react'

/**
 * Devuelve un nodo compartido (#overlay-root) montado en <body> para portales
 * de overlays. Se crea una sola vez y no se elimina (varios overlays lo comparten).
 * Devuelve null en el primer render; el overlay se monta cuando está listo.
 */
export function usePortalNode(): HTMLElement | null {
  const [node, setNode] = useState<HTMLElement | null>(null)
  useEffect(() => {
    let el = document.getElementById('overlay-root')
    if (!el) {
      el = document.createElement('div')
      el.id = 'overlay-root'
      document.body.appendChild(el)
    }
    setNode(el)
  }, [])
  return node
}
