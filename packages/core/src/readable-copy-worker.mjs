// Worker thread for readable-copy.ts: decodes a board's Yjs state and writes the readable <id>.json.
// Plain JS so it runs from source without a loader; the desktop build bundles it (yjs inlined) next to aifig.mjs.
// Keep the shape in sync with Board.toJSON() (tests/data-safety/readable-copy.test.ts compares them).
import fs from 'node:fs'
import path from 'node:path'
import { parentPort } from 'node:worker_threads'
import * as Y from 'yjs'

let n = 0
parentPort.on('message', ({ id, file, payload, board, title, schema }) => {
  try {
    const doc = new Y.Doc()
    Y.applyUpdate(doc, payload)
    const meta = doc.getMap('meta')
    const values = (name) => [...doc.getMap(name).values()]
    const json = {
      id: board,
      title: meta.get('title') ?? title,
      schema,
      createdAt: meta.get('createdAt'),
      updatedAt: meta.get('updatedAt'),
      blocks: values('blocks'),
      connectors: values('connectors'),
      changeSets: values('changeSets'),
      assets: values('assets').map(({ bytes, ...rest }) => ({ ...rest, size: bytes.byteLength })),
      threads: values('threads'),
    }
    const tmp = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.w${++n}.tmp`)
    fs.writeFileSync(tmp, JSON.stringify(json, null, 2))
    fs.renameSync(tmp, file)
    doc.destroy()
    parentPort.postMessage({ id })
  } catch (e) {
    parentPort.postMessage({ id, error: String(e?.message ?? e) })
  }
})
