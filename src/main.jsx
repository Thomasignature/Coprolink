import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './app.jsx'
import './styles.css'
import './v2.css'

createRoot(document.getElementById('root')).render(<App />)

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('/sw.js').catch(() => {})
}
