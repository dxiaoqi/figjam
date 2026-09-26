// Child process for the crash tests. AIFIG_HOME comes from the parent.
//   loop     create a board, then add a fat block and save, forever, printing "saved <n>" after each write
//   edit     load the board, make one edit without saving, print "edited", then wait (the debounce is long)
import { BoardRegistry } from '../../../packages/core/src/board'
import { installFlushOnExit } from '../../../packages/core/src/safety'

const mode = process.argv[2]
const reg = new BoardRegistry()
reg.loadAll()
installFlushOnExit(() => reg.flush())
const text = 'crash-safety '.repeat(4000)

if (mode === 'loop') {
  const b = reg.all()[0] ?? reg.create('Crash board')
  process.stdout.write(`board ${b.id}\n`)
  for (let n = b.blocks.size + 1; ; n++) {
    b.blocks.set(`c${n}`, { id: `c${n}`, kind: 'sticky', x: 0, y: 0, w: 200, h: 200, text, color: 'yellow', size: 'm', createdAt: n, updatedAt: n })
    b.saveNow()
    process.stdout.write(`saved ${n}\n`)
  }
} else if (mode === 'edit') {
  const b = reg.all()[0]
  b.blocks.set('unsaved', { id: 'unsaved', kind: 'sticky', x: 0, y: 0, w: 200, h: 200, text: 'written on the way out', color: 'blue', size: 'm', createdAt: 1, updatedAt: 1 })
  process.stdout.write('edited\n')
  setInterval(() => {}, 1000)
}
