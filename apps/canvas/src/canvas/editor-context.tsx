import { createContext, useContext } from 'react'
import { useEditorVersion, type Editor } from '@nodboard/canvas-engine'

export const EditorContext = createContext<Editor | null>(null)

export function useEditor() {
  const e = useContext(EditorContext)
  if (!e) throw new Error('useEditor outside EditorContext')
  return e
}

/** The editor, re-rendering the caller on every editor change. */
export function useEditorState() {
  const editor = useEditor()
  useEditorVersion(editor)
  return editor
}
