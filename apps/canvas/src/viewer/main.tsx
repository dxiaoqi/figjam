import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import type { WebExportData } from '@aifig/shared'
import './viewer.css'
import { installTokenStyles } from '../theme'
import { t } from '../i18n'
import { viewer } from './blocks'
import { Viewer } from './Viewer'

installTokenStyles()
const data = (window as { __AIFIG_BOARD__?: WebExportData }).__AIFIG_BOARD__
const root = document.getElementById('root')!
if (!data?.blocks) {
  root.innerHTML = ''
  const p = document.createElement('p')
  p.className = 'aifig-viewer-missing'
  p.textContent = t('viewer.missing')
  root.append(p)
} else {
  viewer.init({ data, fields: data.options.fields, active: null })
  createRoot(root).render(
    <StrictMode>
      <Viewer />
    </StrictMode>,
  )
}
