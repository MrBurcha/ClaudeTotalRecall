import { stdout } from 'node:process'
import { main } from './run'

// Thin bin entrypoint: parse argv, run, and map the returned code to the exit
// code. The logic lives in ./run so it can be imported and tested without
// executing on import.
main(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code
  })
  .catch((err: unknown) => {
    stdout.write(`Error: ${err instanceof Error ? err.message : String(err)}\n`)
    process.exitCode = 1
  })
