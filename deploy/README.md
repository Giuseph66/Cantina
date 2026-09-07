# Cantina no servidor local

Stack em `/home/kali/progetos/cantina-stack`, projeto Compose `cantina`.
API pública: `https://api-cantina.neurelix.com.br`.
Frontend: `https://cantina.neurelix.com.br`.

O backend atual usa SQLite. O banco fica em `data/cantina.db`, montado em
`/data/cantina.db`; não precisa de um processo PostgreSQL. Imagens ficam em
`uploads/`. Ambos persistem quando os containers são recriados.

Arquivos privados necessários, fora do Git e do contexto Docker:

- `.env.production`: variáveis da API, JWT forte, credenciais das integrações,
  `CORS_ORIGIN=https://cantina.neurelix.com.br`,
  `APP_PUBLIC_URL=https://cantina.neurelix.com.br` e `CLOUDFLARE_TUNNEL_ID`.
- `secrets/firebase.json`: credencial existente dos backups Firebase.
- `secrets/cloudflared.json`: credencial do túnel `cantina-backend`.

Os diretórios `data`, `uploads` e `secrets` precisam ser acessíveis pelo UID 1000.
O banco original deve ser restaurado em `data/cantina.db` antes do primeiro deploy.

```sh
cd /home/kali/progetos/cantina-stack
docker compose --env-file .env.production -f docker-compose.prod.yml build migrate
docker compose --env-file .env.production -f docker-compose.prod.yml up -d
docker compose --env-file .env.production -f docker-compose.prod.yml ps -a
curl --fail https://api-cantina.neurelix.com.br/api/v1/catalog/categories
curl --fail https://cantina.neurelix.com.br/api/v1/catalog/products
```

O serviço `migrate` aplica as migrations e encerra. A API inicia somente após seu
sucesso, sem executar seed. API e túnel reiniciam automaticamente com o Docker.
A porta 1205 fica disponível apenas no loopback do servidor.

Antes de atualizar, faça backup consistente com a API de backup do SQLite
(`sqlite3.Connection.backup` em Python), copie `uploads/` e guarde a versão da
imagem em uso. Backups iniciais ficam em `backups/`, com data UTC. A instalação
anterior em `/home/kali/progetos/Cantina` foi preservada.

Para restaurar, pare API e túnel, restaure banco e uploads de um mesmo backup,
recupere a imagem correspondente e só então suba os serviços. Não execute
migrations novas sobre um banco restaurado para uma versão antiga sem revisar
a compatibilidade.
