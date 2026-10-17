# Test-Effekte

Effekt-Plugins nur für automatische Tests. Sie werden ausschließlich im Dev-Server geladen und nur, wenn
`localStorage['bls.testEffects'] = '1'` gesetzt ist (Hilfsfunktion `enableTestEffects` in `tests/e2e/helpers.ts`).
Im Produktions-Build sind sie nicht enthalten.
