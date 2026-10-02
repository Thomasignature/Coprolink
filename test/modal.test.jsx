// @vitest-environment jsdom
import React, { useState } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Modal, ReportModal } from '../src/views.jsx'

afterEach(cleanup)

function ChangingModal({ close }) {
  const [value, setValue] = useState('')
  return <Modal onClose={() => close(value)} labelledBy="title">
    <h2 id="title">Test</h2>
    <input aria-label="Saisie" value={value} onChange={event => setValue(event.target.value)} />
    <button>Fin</button>
  </Modal>
}

describe('Modal', () => {
  it('conserve le focus et le curseur pendant une saisie continue', async () => {
    const user = userEvent.setup()
    render(<ChangingModal close={() => {}} />)
    const input = screen.getByLabelText('Saisie')
    await user.click(input)
    await user.type(input, 'plusieurs caractères')
    expect(document.activeElement).toBe(input)
    expect(input.value).toBe('plusieurs caractères')
  })

  it('enferme Tab et Maj+Tab dans la fenêtre', async () => {
    const user = userEvent.setup()
    render(<ChangingModal close={() => {}} />)
    const input = screen.getByLabelText('Saisie')
    const last = screen.getByRole('button', { name: 'Fin' })
    last.focus()
    await user.tab()
    expect(document.activeElement).toBe(input)
    input.focus()
    await user.tab({ shift: true })
    expect(document.activeElement).toBe(last)
  })

  it('Échap appelle toujours la fermeture avec la saisie courante', async () => {
    const close = vi.fn()
    const user = userEvent.setup()
    render(<ChangingModal close={close} />)
    await user.type(screen.getByLabelText('Saisie'), 'courant')
    await user.keyboard('{Escape}')
    expect(close).toHaveBeenCalledWith('courant')
  })

  it('ferme par arrière-plan et restitue le focus au déclencheur', () => {
    const close = vi.fn()
    function Harness() {
      const [open, setOpen] = useState(false)
      return <><button onClick={() => setOpen(true)}>Ouvrir</button>{open && <Modal onClose={() => { close(); setOpen(false) }} labelledBy="title"><h2 id="title">Test</h2></Modal>}</>
    }
    render(<Harness />)
    const trigger = screen.getByRole('button', { name: 'Ouvrir' })
    trigger.focus()
    fireEvent.click(trigger)
    fireEvent.mouseDown(screen.getByRole('dialog').parentElement)
    expect(close).toHaveBeenCalledOnce()
    expect(document.activeElement).toBe(trigger)
  })
})

describe('ReportModal', () => {
  it('laisse le partage privé par défaut et confirme l’abandon avec la saisie courante', async () => {
    const user = userEvent.setup()
    const close = vi.fn()
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    render(<ReportModal onClose={close} onSubmit={vi.fn()} setToast={() => {}} allowPrivate />)
    await user.click(screen.getByRole('button', { name: /Continuer/ }))
    const share = screen.getByRole('checkbox', { name: /Partager/ })
    expect(share.checked).toBe(false)
    await user.type(screen.getByLabelText('Où ?'), 'Hall')
    await user.keyboard('{Escape}')
    expect(confirm).toHaveBeenCalledOnce()
    expect(close).not.toHaveBeenCalled()
    expect(screen.getByLabelText('Où ?').value).toBe('Hall')
    confirm.mockRestore()
  })
})
