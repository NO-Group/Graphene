import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { loader } from '@monaco-editor/react'
import * as monaco from 'monaco-editor'
import EditorWorker from '../node_modules/monaco-editor/esm/vs/editor/editor.worker.js?worker'
import JsonWorker from '../node_modules/monaco-editor/esm/vs/language/json/json.worker.js?worker'
import CssWorker from '../node_modules/monaco-editor/esm/vs/language/css/css.worker.js?worker'
import HtmlWorker from '../node_modules/monaco-editor/esm/vs/language/html/html.worker.js?worker'
import TsWorker from '../node_modules/monaco-editor/esm/vs/language/typescript/ts.worker.js?worker'
import '@fontsource/dm-sans/latin-400.css'
import '@fontsource/dm-sans/latin-500.css'
import '@fontsource/dm-sans/latin-600.css'
import '@fontsource/jetbrains-mono/latin-400.css'
import '@fontsource/jetbrains-mono/latin-500.css'
import '@fontsource/jetbrains-mono/latin-600.css'
import App from './App'

self.MonacoEnvironment = {
  getWorker(_workerId: string, label: string) {
    if (label === 'json') return new JsonWorker()
    if (label === 'css' || label === 'scss' || label === 'less') return new CssWorker()
    if (label === 'html' || label === 'handlebars' || label === 'razor') return new HtmlWorker()
    if (label === 'typescript' || label === 'javascript') return new TsWorker()
    return new EditorWorker()
  },
}

loader.config({ monaco })

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
