const crypto = require('crypto')
const fs = require('fs')

const buildNumber = process.env.BUILD_NUMBER
const bundleId = 'com.stefan.procrastinate'

if (!buildNumber) {
  console.error('BUILD_NUMBER is required')
  process.exit(1)
}

function token() {
  const key = crypto.createPrivateKey(fs.readFileSync(process.env.ASC_KEY_PATH))
  const now = Math.floor(Date.now() / 1000)
  const header = Buffer.from(JSON.stringify({ alg: 'ES256', kid: process.env.ASC_KEY_ID, typ: 'JWT' })).toString('base64url')
  const payload = Buffer.from(JSON.stringify({
    iss: process.env.ASC_ISSUER_ID,
    iat: now,
    exp: now + 10 * 60,
    aud: 'appstoreconnect-v1',
  })).toString('base64url')
  const input = `${header}.${payload}`
  const sig = crypto.sign('SHA256', Buffer.from(input), { key, dsaEncoding: 'ieee-p1363' })
  return `${input}.${sig.toString('base64url')}`
}

async function asc(path) {
  const response = await fetch(`https://api.appstoreconnect.apple.com${path}`, {
    headers: { Authorization: `Bearer ${token()}` },
  })
  const body = await response.text()
  if (!response.ok) {
    console.error(`App Store Connect ${response.status} ${path}: ${body.slice(0, 500)}`)
    process.exit(1)
  }
  return JSON.parse(body)
}

async function main() {
  const apps = await asc(`/v1/apps?filter[bundleId]=${encodeURIComponent(bundleId)}&limit=1`)
  const appId = apps.data?.[0]?.id
  if (!appId) {
    console.error(`No App Store Connect app for ${bundleId}`)
    process.exit(1)
  }

  const deadline = Date.now() + 40 * 60 * 1000
  let last = 'missing'
  while (Date.now() < deadline) {
    const query = new URLSearchParams({
      'filter[app]': appId,
      'filter[version]': buildNumber,
      'fields[builds]': 'processingState,version,uploadedDate',
      limit: '5',
    })
    const builds = await asc(`/v1/builds?${query}`)
    const match = (builds.data ?? []).find((build) => build.attributes?.version === buildNumber)
    const state = match?.attributes?.processingState ?? 'missing'
    const uploaded = match?.attributes?.uploadedDate ?? ''
    if (state !== last) {
      console.log(`build ${buildNumber} processingState=${state}${uploaded ? ` uploaded=${uploaded}` : ''}`)
      last = state
    }
    if (state === 'VALID') {
      console.log(`TestFlight has build ${buildNumber}`)
      return
    }
    if (state === 'FAILED' || state === 'INVALID') {
      console.error(`Build ${buildNumber} processingState=${state}`)
      process.exit(1)
    }
    await new Promise((resolve) => setTimeout(resolve, 20000))
  }
  console.error(`Build ${buildNumber} was still ${last} when the wait ended`)
  process.exit(1)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
