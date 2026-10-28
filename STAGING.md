# CoproLink staging

This branch is reserved for Netlify branch deploy testing of the CoproLink V2 experience.

Runtime: Node.js 22 for Netlify Functions.

Clean redeploy trigger after rollback: 2026-09-13.
# Configuration sensible

Le webhook entrant Resend exige `RESEND_WEBHOOK_SECRET`, fourni par le tableau
de bord Resend. CoproLink valide les en-têtes Svix sur le corps brut ; l'ancien
jeton placé dans l'URL n'est plus accepté. Ne jamais placer ce secret dans Vite,
dans une URL, ni dans les logs.
