import { Bold, Code, Italic, Link2, List, ListOrdered } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { EditorContent, useEditor, useEditorState, type Editor as TipTap } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { Placeholder } from '@tiptap/extensions'
import { useCamera, type Editor } from '@nodboard/canvas-engine'
import { cn } from '@/lib/utils'
import { t } from '../i18n'
import { docToMarkdown, mdToHtml, renderMarkdown } from './markdown'

/** Rendered (read-only) rich text, same typography as the editor. */
export function RichText({ value, placeholder, className, style }: { value: string; placeholder?: string; className?: string; style?: CSSProperties }) {
  if (!value) return <div className={cn('nodboard-rich nodboard-placeholder', className)} style={style}>{placeholder}</div>
  return (
    <div className={cn('nodboard-rich', className)} style={style}>
      {renderMarkdown(value)}
    </div>
  )
}

function ToolButton({ active, label, onClick, children }: { active?: boolean; label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onMouseDown={(e) => {
        e.preventDefault()
        onClick()
      }}
      className={cn('flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground', active && 'bg-accent text-foreground')}
    >
      {children}
    </button>
  )
}

function Toolbar({ tiptap, engine, linkOpen, setLinkOpen }: { tiptap: TipTap; engine: Editor; linkOpen: boolean; setLinkOpen: (v: boolean) => void }) {
  const cam = useCamera(engine)
  const state = useEditorState({
    editor: tiptap,
    selector: ({ editor }) => ({
      bold: editor.isActive('bold'),
      italic: editor.isActive('italic'),
      code: editor.isActive('code'),
      link: editor.isActive('link'),
      bullet: editor.isActive('bulletList'),
      ordered: editor.isActive('orderedList'),
      href: (editor.getAttributes('link').href as string) ?? '',
    }),
  })
  const [href, setHref] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (linkOpen) {
      setHref(state.href || 'https://')
      requestAnimationFrame(() => inputRef.current?.select())
    }
  }, [linkOpen, state.href])
  const applyLink = () => {
    const chain = tiptap.chain().focus().extendMarkRange('link')
    if (!href.trim() || href === 'https://') chain.unsetLink().run()
    else chain.setLink({ href: /^[a-z]+:/i.test(href) ? href : `https://${href}` }).run()
    setLinkOpen(false)
  }
  return (
    <div
      data-ui
      className="chrome absolute bottom-full left-0 z-10 flex items-center gap-0.5 rounded-lg p-1 text-foreground"
      style={{ transform: `translateY(-${8 / cam.z}px) scale(${1 / cam.z})`, transformOrigin: 'bottom left' }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {linkOpen ? (
        <form
          className="flex items-center gap-1"
          onSubmit={(e) => {
            e.preventDefault()
            applyLink()
          }}
        >
          <input
            ref={inputRef}
            value={href}
            onChange={(e) => setHref(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault()
                e.stopPropagation()
                setLinkOpen(false)
                tiptap.commands.focus()
              }
            }}
            placeholder={t('rich.pasteLink')}
            className="h-7 w-52 rounded-md bg-muted px-2 text-xs outline-none"
          />
          <button type="submit" className="h-7 rounded-md px-2 text-xs font-medium hover:bg-accent">
            {t(href && href !== 'https://' ? 'rich.apply' : 'rich.remove')}
          </button>
        </form>
      ) : (
        <>
          <ToolButton label={t('rich.bold')} active={state.bold} onClick={() => tiptap.chain().focus().toggleBold().run()}>
            <Bold className="size-3.5" />
          </ToolButton>
          <ToolButton label={t('rich.italic')} active={state.italic} onClick={() => tiptap.chain().focus().toggleItalic().run()}>
            <Italic className="size-3.5" />
          </ToolButton>
          <ToolButton label={t('rich.code')} active={state.code} onClick={() => tiptap.chain().focus().toggleCode().run()}>
            <Code className="size-3.5" />
          </ToolButton>
          <ToolButton label={t('rich.link')} active={state.link} onClick={() => setLinkOpen(true)}>
            <Link2 className="size-3.5" />
          </ToolButton>
          <div className="mx-0.5 h-4 w-px bg-border" />
          <ToolButton label={t('rich.bullet')} active={state.bullet} onClick={() => tiptap.chain().focus().toggleBulletList().run()}>
            <List className="size-3.5" />
          </ToolButton>
          <ToolButton label={t('rich.ordered')} active={state.ordered} onClick={() => tiptap.chain().focus().toggleOrderedList().run()}>
            <ListOrdered className="size-3.5" />
          </ToolButton>
        </>
      )}
    </div>
  )
}

/** WYSIWYG editor for a block's Markdown text (TipTap / ProseMirror, IME-safe). */
export function RichEditor(props: {
  value: string
  placeholder: string
  onChange: (md: string) => void
  engine: Editor
  onTab?: () => void
  className?: string
  style?: CSSProperties
  toolbar?: boolean
  autoFocus?: boolean
}) {
  const onTab = useRef(props.onTab)
  onTab.current = props.onTab
  // TipTap builds placeholder decorations once from the extension options. A callback
  // read at decoration time stays current when the block gains a type while editing
  // (the untyped “/ to set a type” hint must not stay painted over the status line).
  const placeholderRef = useRef(props.placeholder)
  placeholderRef.current = props.placeholder
  const [linkOpen, setLinkOpen] = useState(false)
  const tiptap = useEditor({
    extensions: [
      StarterKit.configure({
        heading: false,
        blockquote: false,
        codeBlock: false,
        horizontalRule: false,
        strike: false,
        underline: false,
        link: { openOnClick: false, autolink: true, protocols: ['mailto'] },
      }),
      Placeholder.configure({ placeholder: () => placeholderRef.current }),
    ],
    content: mdToHtml(props.value),
    autofocus: props.autoFocus === false ? false : 'end',
    editorProps: {
      attributes: { class: cn('nodboard-rich', props.className), spellcheck: 'false' },
      // blocks grow to fit; past their max height only the block's own scroller follows the caret (never the page)
      handleScrollToSelection: (view) => {
        const box = view.dom.closest<HTMLElement>('[data-scroll]')
        if (!box || box.scrollHeight <= box.clientHeight) return true
        const caret = view.coordsAtPos(view.state.selection.head)
        const r = box.getBoundingClientRect()
        const k = r.height / box.offsetHeight || 1
        if (caret.bottom > r.bottom - 8 * k) box.scrollTop += (caret.bottom - r.bottom) / k + 16
        else if (caret.top < r.top + 8 * k) box.scrollTop -= (r.top - caret.top) / k + 16
        return true
      },
      handleKeyDown: (_view, event) => {
        if (event.isComposing) return false
        if (event.key === 'Tab' && onTab.current && !event.shiftKey && !tiptap?.isActive('listItem')) {
          event.preventDefault()
          onTab.current()
          return true
        }
        if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
          event.preventDefault()
          setLinkOpen(true)
          return true
        }
        return false
      },
    },
    onUpdate: ({ editor }) => props.onChange(docToMarkdown(editor.getJSON() as never)),
  })
  // blocks clip their content, so the toolbar is portaled onto the block wrapper
  const hostRef = useRef<HTMLDivElement>(null)
  const [blockEl, setBlockEl] = useState<HTMLElement | null>(null)
  useLayoutEffect(() => setBlockEl(hostRef.current?.closest<HTMLElement>('.ae-block') ?? null), [])
  useLayoutEffect(() => {
    if (!tiptap || tiptap.isDestroyed) return
    try {
      if (tiptap.view.isDestroyed) return
      // Rebuild decorations so data-placeholder matches the prop (type just applied, locale changed).
      tiptap.view.dispatch(tiptap.state.tr.setMeta('addToHistory', false))
    } catch {
      /* editor view not mounted yet; the placeholder callback already has the current text */
    }
  }, [tiptap, props.placeholder])
  // e.g. Enter in a card title moves the caret to the end of the body
  useEffect(() => {
    const host = hostRef.current
    if (!host || !tiptap) return
    const focusEnd = () => tiptap.commands.focus('end')
    const clear = () => tiptap.chain().clearContent(true).focus('end').run()
    host.addEventListener('nodboard-focus-end', focusEnd)
    host.addEventListener('nodboard-clear', clear)
    return () => {
      host.removeEventListener('nodboard-focus-end', focusEnd)
      host.removeEventListener('nodboard-clear', clear)
    }
  }, [tiptap])
  if (!tiptap) return null
  return (
    <>
      {props.toolbar !== false && blockEl && createPortal(<Toolbar tiptap={tiptap} engine={props.engine} linkOpen={linkOpen} setLinkOpen={setLinkOpen} />, blockEl)}
      <EditorContent ref={hostRef} editor={tiptap} className="nodboard-rich-host" style={props.style} />
    </>
  )
}
