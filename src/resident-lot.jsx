import React from 'react'
import { Building2, DoorOpen, FileText, ShieldCheck, WalletCards, Wrench } from 'lucide-react'
import { money } from './format.js'
import './resident-lot.css'

export default function ResidentLotView({ data, previewRole = null }) {
  const isTenant = previewRole === 'tenant'
  const member = data.member || null
  const unitLabel = member?.unitLabel?.trim() || ''
  const shareLabel = member?.shareLabel?.trim() || ''
  const hasQuarterlyCall = Number.isFinite(Number(member?.quarterlyCall)) && Number(member?.quarterlyCall) !== 0
  const hasBalance = Number.isFinite(Number(member?.balance)) && Number(member?.balance) !== 0

  return (
    <div className="rm-content">
      <div className="rm-page-head">
        <span>MON LOT</span>
        <h1>{unitLabel ? `Lot ${unitLabel}` : 'Lot à associer'}</h1>
        <p>{isTenant
          ? 'Les informations pratiques liées à votre logement, sans données réservées au propriétaire.'
          : 'Les informations personnelles liées à votre lot dans la copropriété.'}</p>
      </div>

      <section className="rl-identity-card">
        <span className="rl-icon"><DoorOpen /></span>
        <div>
          <small>{isTenant ? 'LOGEMENT OCCUPÉ' : 'LOT LIÉ À VOTRE COMPTE'}</small>
          <strong>{unitLabel || 'Aucun lot associé pour le moment'}</strong>
          <p>{data.building?.name || 'Copropriété'}{data.building?.address ? ` · ${data.building.address}` : ''}</p>
        </div>
      </section>

      {!unitLabel && (
        <section className="rl-notice">
          <ShieldCheck />
          <div><strong>Association à compléter</strong><p>Le référent CoproLink doit relier votre compte au bon lot. CoproLink n’attribue jamais un logement automatiquement.</p></div>
        </section>
      )}

      <div className="rl-grid">
        <article><Building2 /><span>Immeuble</span><strong>{data.building?.name || '—'}</strong></article>
        <article><Wrench /><span>Signalements personnels</span><strong>{Array.isArray(data.myTickets) ? data.myTickets.length : 0}</strong></article>
        <article><FileText /><span>Documents accessibles</span><strong>{Array.isArray(data.documents) ? data.documents.length : 0}</strong></article>
        <article><DoorOpen /><span>Statut</span><strong>{isTenant ? 'Occupant' : 'Copropriétaire'}</strong></article>
      </div>

      {!isTenant && (
        <section className="rl-owner-card">
          <div className="rl-section-title"><WalletCards /><div><small>INFORMATIONS PROPRIÉTAIRE</small><h2>Situation de mon lot</h2></div></div>
          <div className="rl-owner-grid">
            <div><span>Quotité</span><strong>{shareLabel || 'Non renseignée'}</strong></div>
            <div><span>Appel trimestriel</span><strong>{hasQuarterlyCall ? money(member.quarterlyCall) : 'Non renseigné'}</strong></div>
            <div><span>Solde personnel</span><strong>{hasBalance ? money(member.balance) : 'Non renseigné'}</strong></div>
          </div>
          <p className="rl-private-note"><ShieldCheck /> Ces informations sont personnelles et ne doivent jamais être visibles par un autre lot ou par un occupant non autorisé.</p>
        </section>
      )}

      {isTenant && (
        <section className="rl-tenant-card">
          <div className="rl-section-title"><ShieldCheck /><div><small>ACCÈS OCCUPANT</small><h2>Ce que vous voyez</h2></div></div>
          <p>Informations pratiques de l’immeuble, communications autorisées, documents publics et suivi de vos propres signalements.</p>
          <p className="rl-muted">Les quotités, appels de fonds, soldes et documents réservés aux copropriétaires ne sont pas affichés.</p>
        </section>
      )}
    </div>
  )
}
