import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { build } from 'esbuild'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

test('syndic uses shared email and invitation controls, including activated accounts; history stays read-only', async () => {
  const outfile = resolve('.netlify/audit-tests/syndic-access.mjs')
  await mkdir(resolve('.netlify/audit-tests'), { recursive: true })
  await build({ entryPoints: ['src/syndic-people-access.jsx'], outfile, bundle: true, format: 'esm', platform: 'node', packages: 'external',
    plugins: [{ name: 'ignore-styles', setup(b) { b.onLoad({ filter: /\.css$/ }, () => ({ contents: '', loader: 'js' })) } }], logLevel: 'silent' })
  const { PeopleAccessList } = await import(outfile)
  const render = (state, historical = false) => renderToStaticMarkup(React.createElement(PeopleAccessList, {
    model: { people: [{ id: 1, fullName: 'Personne QA', email: 'qa@example.invalid' }], units: [{ id: 2, label: 'QA-01' }],
      relations: [{ personId: 1, unitId: 2, endDate: historical ? '2026-01-01' : null }] },
    access: [{ personId: 1, state }], onSaveEmail: () => {}, onInvite: () => {},
  }))
  const active = render('active')
  assert.match(active, /Modifier/)
  assert.match(active, /Envoyer un lien d’accès/)
  assert.match(active, /QA-01/)
  assert.match(render('pending'), /Renvoyer le lien/)
  assert.match(render('none'), /Inviter sur CoproLink/)
  const history = render('active', true)
  assert.match(history, /Ancienne relation/)
  assert.doesNotMatch(history, /<button/)
})
