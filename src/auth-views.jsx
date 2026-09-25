import React, { useState } from 'react'
import { acceptInvite, login, requestPasswordRecovery, signup, updateUser } from '@netlify/identity'
import { Building2, Check, Gauge, Info, LogOut, Mail, ShieldCheck } from 'lucide-react'
import { Logo } from './views.jsx'

const messageFor = error => {
  const text = String(error?.message || '')
  if (/invalid|credential|grant/i.test(text)) return 'E-mail ou mot de passe incorrect.'
  if (/already (been )?registered|exists/i.test(text)) return 'Un compte existe déjà pour cette adresse.'
  if (/signup.*disabled|disabled.*signup/i.test(text)) return "Les inscriptions libres sont désactivées : demandez une invitation au syndic."
  if (/password/i.test(text) && /short|least/i.test(text)) return 'Le mot de passe doit contenir au moins 8 caractères.'
  if (/expired|invalid.*token|token.*invalid/i.test(text)) return 'Ce lien a expiré. Demandez-en un nouveau.'
  if (/identity/i.test(text)) return "L'authentification n'est pas encore activée sur ce déploiement."
  return text || 'Une erreur est survenue.'
}

function AuthFrame({ children }) {
  return (
    <main className="auth-shell">
      <section className="auth-aside">
        <Logo />
        <h1>Une copropriété qui se pilote sans relances.</h1>
        <p>
          Signalements, communications, agenda et documents : une seule source de vérité,
          partagée entre l'écran du hall, les copropriétaires et le syndic.
        </p>
        <ul className="auth-points">
          <li><ShieldCheck /> Rôles vérifiés côté serveur à chaque requête</li>
          <li><Gauge /> Écran des communs sans compte nominatif</li>
          <li><Check /> Historique des interventions horodaté</li>
        </ul>
      </section>
      <section className="auth-panel">{children}</section>
    </main>
  )
}

/**
 * Connexion, création de compte et récupération de mot de passe.
 *
 * Toute l'authentification passe par Netlify Identity : le mot de passe ne
 * transite jamais par nos propres fonctions, et le cookie `nf_jwt` posé ici est
 * ce que le serveur vérifie ensuite pour chaque appel d'API.
 */
export function LoginView({ mode: initialMode = 'login', inviteToken = null, onAuthenticated }) {
  const [mode, setMode] = useState(initialMode)
  const [email, setEmail] = useState('')
  const [fullName, setFullName] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const run = async action => {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await action()
    } catch (e) {
      setError(messageFor(e))
    } finally {
      setBusy(false)
    }
  }

  const submit = e => {
    e.preventDefault()
    if (busy) return
    if (mode === 'login') {
      return run(async () => {
        await login(email.trim(), password)
        await onAuthenticated()
      })
    }
    if (mode === 'signup') {
      return run(async () => {
        await signup(email.trim(), password, { full_name: fullName.trim() })
        // Sans auto-confirmation, aucune session n'est ouverte : la personne doit
        // d'abord cliquer le lien reçu par e-mail. `onAuthenticated` renvoie donc
        // false et l'on reste sur le formulaire de connexion.
        if (await onAuthenticated()) return
        setMode('login')
        setNotice('Compte créé. Vérifiez votre boîte mail pour confirmer votre adresse, puis connectez-vous.')
      })
    }
    if (mode === 'forgot') {
      return run(async () => {
        await requestPasswordRecovery(email.trim())
        setMode('login')
        setNotice('Si un compte existe pour cette adresse, un e-mail de réinitialisation vient de partir.')
      })
    }
    if (mode === 'invite') {
      // Le lien d'invitation ne porte pas encore de session : le mot de passe
      // choisi ici crée le compte et ouvre la session.
      return run(async () => {
        await acceptInvite(inviteToken, password)
        await onAuthenticated()
      })
    }
    // Récupération : `handleAuthCallback` a déjà ouvert la session, il reste à
    // enregistrer le nouveau mot de passe sur le compte courant.
    return run(async () => {
      await updateUser({ password })
      await onAuthenticated()
    })
  }

  const titles = {
    login: 'Se connecter',
    signup: 'Créer un compte',
    forgot: 'Mot de passe oublié',
    reset: 'Choisir un nouveau mot de passe',
    invite: 'Activer votre accès',
  }

  return (
    <AuthFrame>
      <form className="auth-form" onSubmit={submit}>
        <span className="overline">CoproLink</span>
        <h2>{titles[mode]}</h2>

        {mode === 'login' && <p className="muted-p">Accédez à votre espace copropriétaire ou syndic.</p>}
        {mode === 'signup' && <p className="muted-p">Votre accès à un immeuble sera ensuite accordé par le syndic.</p>}
        {mode === 'forgot' && <p className="muted-p">Nous vous enverrons un lien de réinitialisation.</p>}
        {mode === 'invite' && <p className="muted-p">Choisissez un mot de passe pour activer le compte qui vient de vous être ouvert.</p>}
        {mode === 'reset' && <p className="muted-p">Ce mot de passe remplacera l'ancien immédiatement.</p>}

        {notice && <div className="notice-inline"><Info size={16} /><span>{notice}</span></div>}
        {error && <div className="form-error" role="alert">{error}</div>}

        {mode === 'signup' && (
          <label>
            Nom complet
            <input value={fullName} onChange={e => setFullName(e.target.value)} autoComplete="name" required />
          </label>
        )}

        {mode !== 'reset' && mode !== 'invite' && (
          <label>
            Adresse e-mail
            <input
              type="email" value={email} onChange={e => setEmail(e.target.value)}
              autoComplete="email" required
            />
          </label>
        )}

        {mode !== 'forgot' && (
          <label>
            {mode === 'login' || mode === 'signup' ? 'Mot de passe' : 'Nouveau mot de passe'}
            <input
              type="password" value={password} onChange={e => setPassword(e.target.value)}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              minLength={8} required
            />
          </label>
        )}

        <button className="primary-btn full-btn" disabled={busy}>
          {busy ? 'Un instant…' : titles[mode]}
        </button>

        <div className="auth-links">
          {mode === 'login' && (
            <>
              <button type="button" onClick={() => { setMode('signup'); setError('') }}>Créer un compte</button>
              <button type="button" onClick={() => { setMode('forgot'); setError('') }}>Mot de passe oublié ?</button>
            </>
          )}
          {mode !== 'login' && mode !== 'reset' && mode !== 'invite' && (
            <button type="button" onClick={() => { setMode('login'); setError('') }}>Retour à la connexion</button>
          )}
        </div>
      </form>
    </AuthFrame>
  )
}

/**
 * Écran affiché à un compte authentifié qui n'est membre d'aucun immeuble.
 *
 * Deux cas : la plateforme est vierge et le syndic installe le premier
 * immeuble, ou l'accès de la personne doit encore être accordé par un syndic.
 */
export function SetupView({ onCreated, onLogout, email }) {
  const [name, setName] = useState('')
  const [address, setAddress] = useState('')
  const [lots, setLots] = useState('')
  const [managerName, setManagerName] = useState('')
  const [emergencyPhone, setEmergencyPhone] = useState('')
  const [setupToken, setSetupToken] = useState('')
  const [withSampleData, setWithSampleData] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const submit = async e => {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    setError('')
    try {
      await onCreated({
        name: name.trim(),
        address: address.trim(),
        lots: Number(lots) || 0,
        managerName: managerName.trim(),
        emergencyPhone: emergencyPhone.trim(),
        withSampleData,
        setupToken: setupToken.trim(),
      })
    } catch (e2) {
      setError(e2.message)
      setBusy(false)
    }
  }

  return (
    <AuthFrame>
      <form className="auth-form wide" onSubmit={submit}>
        <span className="overline">Onboarding syndic</span>
        <h2>Initialiser une copropriété</h2>
        <p className="muted-p">
          Le syndic initialise l’immeuble, renseigne les lots et les personnes puis
          invite les copropriétaires et occupants. L’espace CoproLink reste attaché à l’immeuble.
        </p>

        {error && <div className="form-error" role="alert">{error}</div>}

        <label>Nom de l'immeuble<input value={name} onChange={e => setName(e.target.value)} placeholder="Résidence Les Tilleuls" required maxLength={120} /></label>
        <label>Adresse<input value={address} onChange={e => setAddress(e.target.value)} placeholder="Rue des Tilleuls 12, 1000 Bruxelles" maxLength={200} /></label>
        <div className="field-row">
          <label>Nombre de lots<input type="number" min="0" value={lots} onChange={e => setLots(e.target.value)} placeholder="24" /></label>
          <label>Téléphone d'urgence<input value={emergencyPhone} onChange={e => setEmergencyPhone(e.target.value)} placeholder="+32 2 000 00 00" maxLength={40} /></label>
        </div>
        <label>Nom du syndic<input value={managerName} onChange={e => setManagerName(e.target.value)} placeholder="Cabinet Dupont" maxLength={120} /></label>
        <label>
          Jeton d'installation <small>(uniquement si configuré sur le déploiement)</small>
          <input value={setupToken} onChange={e => setSetupToken(e.target.value)} autoComplete="off" />
        </label>
        <label className="checkbox">
          <input type="checkbox" checked={withSampleData} onChange={e => setWithSampleData(e.target.checked)} />
          Préremplir avec quelques exemples pour découvrir l'interface
        </label>

        <button className="primary-btn full-btn" disabled={busy}>
          <Building2 /> {busy ? 'Création…' : "Initialiser la copropriété"}
        </button>
        <div className="auth-links">
          <span className="subtle">Connecté en tant que {email}</span>
          <button type="button" onClick={onLogout}>Se déconnecter</button>
        </div>
      </form>
    </AuthFrame>
  )
}

/** Compte valide, mais aucun accès accordé et aucun immeuble à installer. */
export function NoAccessView({ email, onLogout, onRetry }) {
  return (
    <AuthFrame>
      <div className="auth-form">
        <span className="overline">Accès en attente</span>
        <h2>Votre compte n'est rattaché à aucun immeuble.</h2>
        <p className="muted-p">
          Communiquez l'adresse <strong>{email}</strong> à votre syndic : il pourra vous
          accorder l'accès à votre copropriété en quelques secondes.
        </p>
        <button className="primary-btn full-btn" onClick={onRetry}>Vérifier à nouveau</button>
        <div className="auth-links"><button type="button" onClick={onLogout}><LogOut size={15} /> Se déconnecter</button></div>
      </div>
    </AuthFrame>
  )
}

/**
 * Écran d'enrôlement de la tablette.
 *
 * La vue des communs exige un jeton de terminal. Aucun formulaire de connexion
 * n'est proposé ici : une tablette de hall ne doit jamais héberger une session
 * copropriétaire.
 */
export function TerminalEnrollView({ error, onSubmit }) {
  const [token, setToken] = useState('')

  return (
    <AuthFrame>
      <form
        className="auth-form"
        onSubmit={e => { e.preventDefault(); if (token.trim()) onSubmit(token.trim()) }}
      >
        <span className="overline">Écran des communs</span>
        <h2>Enrôler cette tablette</h2>
        <p className="muted-p">
          Collez le jeton fourni par le syndic, ou ouvrez directement l'adresse
          d'enrôlement qu'il vous a transmise. Le jeton reste sur l'appareil et
          n'ouvre aucun accès nominatif.
        </p>
        {error && <div className="form-error" role="alert">{error}</div>}
        <label>
          Jeton de terminal
          <input value={token} onChange={e => setToken(e.target.value)} autoComplete="off" spellCheck={false} required />
        </label>
        <button className="primary-btn full-btn"><Gauge /> Activer l'écran</button>
        <div className="notice-inline">
          <Mail size={16} />
          <span>Le syndic génère ces jetons depuis son espace, onglet « Écrans ».</span>
        </div>
      </form>
    </AuthFrame>
  )
}
