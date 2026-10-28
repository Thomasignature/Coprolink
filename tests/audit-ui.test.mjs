import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { build } from 'esbuild'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

test('real resident screens: tenant has no owner finance block; owner can select lots and see zero', async () => {
  const outfile = resolve('.netlify/audit-tests/resident-ui.mjs')
  await mkdir(resolve('.netlify/audit-tests'), { recursive: true })
  await build({ entryPoints: ['src/resident-v2.jsx'], outfile, bundle: true, format: 'esm', platform: 'node', packages: 'external',
    plugins: [{ name:'ignore-style-only', setup(b) { b.onLoad({filter:/\.css$/},()=>({contents:'',loader:'js'})) } }], logLevel:'silent' })
  const View = (await import(outfile)).default
  const base = { building:{slug:'qa',name:'QA'},capabilities:['resident:tenant'], lots:[{id:1,unitLabel:'C',relationTypes:['tenant']}],myTickets:[],buildingTickets:[],documents:[],events:[],announcements:[] }
  const props = { data:base, session:{user:{fullName:'Test',email:'test@example.invalid'}},initialSection:'lot' }
  const tenant = renderToStaticMarkup(React.createElement(View, props))
  assert.match(tenant,/Locataire \/ occupant/)
  assert.doesNotMatch(tenant,/<h2>Situation de mon lot<\/h2>/)
  const owner = renderToStaticMarkup(React.createElement(View, { ...props, data:{...base,capabilities:['resident:owner'],lots:[{id:1,unitLabel:'A',relationTypes:['owner'],shareLabel:'10/100',balance:0,quarterlyCall:0},{id:2,unitLabel:'B',relationTypes:['owner'],shareLabel:'20/100',balance:50,quarterlyCall:100}] } }))
  assert.match(owner,/Choisir un lot/)
  assert.match(owner,/Situation de mon lot/)
  assert.match(owner,/<strong>0,00[\s\u00a0]*€<\/strong>/)
  assert.doesNotMatch(owner,/Non renseigné/)
})
