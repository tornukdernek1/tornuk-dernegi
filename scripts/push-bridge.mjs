import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const content = readFileSync('public/data/bridge.json')
const b64 = content.toString('base64')

function put(path, branch) {
  let sha = ''
  try {
    sha = execFileSync(
      'gh',
      [
        'api',
        `repos/tornukdernek1/tornuk-dernegi/contents/${path}?ref=${branch}`,
        '--jq',
        '.sha',
      ],
      { encoding: 'utf8' },
    ).trim()
  } catch {
    // new file
  }
  const args = [
    'api',
    '--method',
    'PUT',
    `repos/tornukdernek1/tornuk-dernegi/contents/${path}`,
    '-f',
    'message=chore: refresh publish bridge',
    '-f',
    `content=${b64}`,
    '-f',
    `branch=${branch}`,
  ]
  if (sha) args.push('-f', `sha=${sha}`)
  execFileSync('gh', args, { stdio: 'inherit' })
  console.log('updated', branch, path)
}

put('public/data/bridge.json', 'main')
put('data/bridge.json', 'gh-pages')
