import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { loadRuntimeBrandConfig } from './config/brand.js'

async function boot() {
  await loadRuntimeBrandConfig()
  createRoot(document.getElementById('root')).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}

boot()
