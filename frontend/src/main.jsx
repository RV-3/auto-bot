import React from 'react'
import ReactDOM from 'react-dom/client'
import Dashboard from './Dashboard'
// If you prefer, rename Dashboard.css -> index.css. Just ensure the Tailwind content is in it.
import './Dashboard.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <Dashboard />
  </React.StrictMode>
)
