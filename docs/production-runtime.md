# Execução de produção

Requer Node 22 e `npm ci` na raiz. Configure `apps/api/.env.production` com DATABASE_URL, JWT_SECRET forte, CORS_ORIGIN e credenciais Asaas do ambiente desejado. Os arquivos `.env.production` são ignorados pelo Git.

- Raiz: `npm run prod` compila e inicia API e frontend; encerra ambos se um deles terminar.
- API: `npm run prod -w apps/api` compila e executa `dist/main.js` com NODE_ENV=production e `.env.production`.
- Frontend: `npm run prod -w apps/web` compila o bundle e serve em http://127.0.0.1:4173, com proxy de API, uploads e Socket.IO para http://127.0.0.1:3000. Não utiliza o servidor de desenvolvimento/preview do Vite.

Frontend aceita WEB_PORT, WEB_HOST e API_PROXY_URL via ambiente ou `apps/web/.env.production`. Publicação externa exige proxy HTTPS (por exemplo Cloudflare Tunnel). Cookies de autenticação usam Secure em produção. As migrações são uma etapa explícita do deploy: faça backup antes de `prisma migrate deploy`; iniciar o servidor não modifica o schema automaticamente.

## JSON criptografado

O bundle de produção usa AES-256-GCM com chave aleatória por requisição. O navegador obtém a chave pública RSA-2048 e encapsula a chave AES com RSA-OAEP/SHA-256. As mensagens autenticam método, URL, direção e, na resposta, o status HTTP. Nonces aleatórios de 96 bits são novos em cada mensagem. Chaves privadas RSA ficam somente na memória do processo da API; reiniciar invalida requisições em trânsito. Escritas não são repetidas automaticamente.

Login, cadastro, perfil e chamadas via useApi enviam/recebem envelopes JSON. Respostas de erro posteriores à decifragem também são criptografadas. Chaves e envelopes não devem ser registrados nos logs. Cache HTTP dos envelopes é desativado.

O servidor aceita clientes antigos por padrão para possibilitar deploy gradual: backend primeiro, frontend depois. Após atualização de todos os clientes, configure PAYLOAD_ENCRYPTION_REQUIRED=true para rejeitar JSON sem chave encapsulada. Isso inclui chamadas manuais e healthchecks antigos: use GET /api/v1/crypto/public-key para verificar disponibilidade HTTP. A obrigatoriedade também bloqueia o frontend de desenvolvimento (que usa JSON normal).

HTTPS é obrigatório: autentica a chave pública e protege cookies, URLs, cabeçalhos, imagens, uploads e webhooks. A camada JSON não impede inspeção dos dados já decifrados pelo usuário do navegador, não substitui autorização e não previne replay de requisições válidas. IDs, URLs e tamanhos continuam observáveis. Multipart/imagens, Socket.IO e webhook Asaas permanecem no protocolo original sobre HTTPS/WSS; esta mudança não corrige as falhas de autorização relatadas na auditoria.

O processo único mantém uma chave RSA efêmera. Não habilite múltiplas réplicas sem projetar distribuição/rotação de chaves ou afinidade para a consulta de chave e requisição correspondente. Não há fallback silencioso para texto claro no frontend de produção.
