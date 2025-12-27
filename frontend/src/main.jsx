import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import { RepoProvider } from './context/RepoContext'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <RepoProvider>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </RepoProvider>
  </React.StrictMode>,
)
