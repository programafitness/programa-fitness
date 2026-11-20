// Service worker mínimo: só existe para o navegador permitir instalar o app.
// Não guarda nada em cache, então os alunos sempre recebem a versão mais nova do site.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {});
