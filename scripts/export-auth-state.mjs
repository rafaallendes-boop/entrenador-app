/**
 * Extrae el estado de autenticación del browser del usuario vía DevTools Protocol.
 *
 * Uso:
 *   node scripts/export-auth-state.mjs
 *
 * Requiere que Chrome/Chromium esté corriendo con remote debugging habilitado:
 *   /Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
 *     --remote-debugging-port=9222 \
 *     --user-data-dir=/tmp/chrome-debug \
 *     http://localhost:5173
 *
 * O más fácil: correr el script helper abajo y pegar el output en la terminal.
 */

console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Exportar sesión para E2E tests
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Para exportar tu sesión actual:

1. Abre http://localhost:5173 en tu browser y asegurate de estar logueado.

2. Abre DevTools (F12 o Cmd+Option+I) → pestaña "Console"

3. Pega este código y presiona Enter:

─────────────────────────────────────────
(function() {
  const state = {
    localStorage: {},
    cookies: document.cookie
  };
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    state.localStorage[key] = localStorage.getItem(key);
  }
  const json = JSON.stringify(state, null, 2);
  console.log('AUTH_STATE_START');
  console.log(json);
  console.log('AUTH_STATE_END');
  copy(json);
  console.log('✅ Estado copiado al clipboard');
})();
─────────────────────────────────────────

4. El estado quedó copiado. Ahora corrí en terminal:

   npm run e2e:auth:import

   y pegá el JSON cuando te lo pida.
`)
