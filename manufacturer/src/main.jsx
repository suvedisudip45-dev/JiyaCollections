import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}driver-offline-sw.js`, {
      scope: import.meta.env.BASE_URL,
    }).catch((error) => {
      console.warn('Static offline app-shell caching could not be enabled:', error.message)
    })
  })
}
