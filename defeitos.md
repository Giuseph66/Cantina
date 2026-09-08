# Defeitos e plano de correção

Registro da auditoria realizada em 08/09/2026. Base de código mais recente: `5dc99c3`.

As caixas ficam abertas até existir evidência de implementação e validação. As severidades abaixo orientam a prioridade; achados em dependências não significam, por si só, exploração comprovada na aplicação. Esta lista não garante ausência de outras falhas.

A criptografia JSON adicionada posteriormente não corrige autorização, vazamento pelo Socket.IO, dependências vulneráveis nem regras de negócio. O transporte JSON foi implementado e validado separadamente.

## 1. Exposição de eventos no Socket.IO — prioridade alta

**Problema:** o gateway não autentica conexões e usa `server.emit` para transmitir `orderId`, `userId`, status e código do ticket para todos os clientes conectados.

**Evidência:** `apps/api/src/events/events.gateway.ts`; transmissão no pagamento em `apps/api/src/payments/asaas-payments.service.ts`. O handshake público Engine.IO retornou uma sessão sem autenticação. Isso confirma a abertura do transporte; a exposição do evento foi identificada no código, sem capturar eventos reais de terceiros. A classificação inicial como crítica precisa ser calibrada conforme o impacto demonstrado.

**Correção:** autenticar o socket e limitar os destinatários de cada evento no servidor.

- [ ] Validar a sessão no handshake, incluindo usuário ativo e expiração.
- [ ] Rejeitar conexões sem sessão, adulteradas ou expiradas.
- [ ] Criar salas por usuário e salas de operação autorizadas pelo servidor.
- [ ] Enviar atualizações pessoais somente ao proprietário e aos perfis operacionais autorizados.
- [ ] Separar os dados mínimos do painel de retirada dos dados privados do pedido.
- [ ] Atualizar conexão, logout e reconexão no frontend.
- [ ] Testar isolamento entre dois clientes, acesso administrativo e desconexão após perda de autorização.
- [ ] Validar polling e WebSocket pelo domínio publicado.

## 2. Limitador de requisições não registrado — prioridade alta

**Problema:** existem `ThrottlerModule` e anotações `@Throttle`, mas não foi localizado registro de `ThrottlerGuard`.

**Evidência:** `apps/api/src/app.module.ts`, controladores de autenticação, pedidos, pagamentos e tickets. Dez chamadas sem autenticação retornaram `401`, sem `429`; isoladamente, esse teste não comprova ausência de limite após autenticação. O achado principal é a configuração incompleta no código.

**Correção:** ativar o guard e definir limites adequados por operação e identidade.

- [ ] Registrar o guard e estabelecer limites para login, cadastro, pedidos, pagamentos e validação de tickets.
- [ ] Definir identificação confiável do cliente atrás de Vercel/Cloudflare, sem confiar em cabeçalhos arbitrários.
- [ ] Tratar webhooks, healthchecks e reconciliação sem bloquear o funcionamento legítimo.
- [ ] Definir armazenamento compartilhado dos limites se houver múltiplas instâncias.
- [ ] Testar `429`, recuperação após a janela e isolamento entre usuários/clientes.
- [ ] Verificar que o limite continua funcionando com criptografia JSON habilitada.

## 3. Pedidos prontos disponíveis a qualquer usuário autenticado — prioridade alta

**Problema:** `GET /orders/ready` exige login, mas não restringe perfil e consulta pedidos de todos, incluindo o objeto completo de ticket.

**Evidência:** `apps/api/src/orders/orders.controller.ts` e `apps/api/src/orders/orders.service.ts`. Identificado por revisão do código.

**Correção:** definir acesso do painel de retirada e reduzir os campos retornados.

- [ ] Restringir a rota operacional a caixa/admin ou criar uma identidade específica para o totem.
- [ ] Se houver painel público, retornar apenas os dados estritamente necessários, sem identificadores pessoais ou credenciais de retirada reutilizáveis.
- [ ] Substituir a inclusão completa de ticket por seleção explícita de campos.
- [ ] Atualizar `apps/web/src/pages/totem/TotemPage.tsx` conforme a política escolhida.
- [ ] Testar acesso anônimo, cliente, caixa/admin e funcionamento do totem.

## 4. Dependências com vulnerabilidades conhecidas — prioridade alta

**Problema:** a auditoria inicial dentro do contêiner encontrou 36 entradas vulneráveis em dependências de produção: 2 críticas, 15 altas e 17 moderadas. Entre os pacotes envolvidos estavam `tar`, `websocket-driver`, `ws`, `multer` e componentes do NestJS.

**Observação:** essa contagem é histórica. Os builds posteriores também emitiram alertas, incluindo dependências de desenvolvimento; os totais não são diretamente comparáveis. Não foi comprovada exploração de todas as entradas.

**Correção:** atualizar versões de forma compatível e confirmar quais avisos se aplicam ao código executado.

- [ ] Gerar um novo `npm audit --omit=dev --json` localmente e na imagem de produção.
- [ ] Mapear cada aviso à versão instalada, cadeia de dependências e funcionalidade exposta.
- [ ] Aplicar atualizações compatíveis no lockfile.
- [ ] Planejar migrações necessárias entre versões principais; evitar `npm audit fix --force` sem revisão.
- [ ] Remover dependências de desenvolvimento da imagem final quando possível.
- [ ] Testar autenticação, upload, sockets, backups e pagamentos após as atualizações.
- [ ] Reconstruir e publicar a imagem; repetir a auditoria e registrar os riscos restantes.

## 5. Bloqueio de vendas não aplicado no backend — prioridade alta

**Problema:** o frontend usa `config.sandbox || config.salesEnabled === true`; o serviço de criação de pedidos não verifica `SALES_ENABLED`. Na auditoria, a variável estava ausente e a configuração pública retornava `salesEnabled: false`.

**Evidência:** `apps/web/src/pages/client/CheckoutPage.tsx`, `apps/api/src/orders/orders.service.ts` e `apps/api/src/payments/payments.service.ts`. O desvio foi identificado no código; não foram criados pedidos para reproduzi-lo nessa auditoria.

**Correção:** estabelecer uma regra única de disponibilidade de vendas, aplicada no servidor.

- [ ] Definir explicitamente como a pausa de vendas funciona em sandbox e produção.
- [ ] Rejeitar novos pedidos no backend quando as vendas estiverem pausadas.
- [ ] Definir separadamente a política para cobrar pedidos já existentes e para `PAYMENTS_NEW_CHARGES_ENABLED`.
- [ ] Manter consulta, reconciliação e processamento de webhooks durante a pausa.
- [ ] Alinhar o frontend à regra do backend.
- [ ] Testar chamadas diretas à API, sandbox, produção e pedidos já em andamento.

## 6. Upload confia no MIME e preserva extensão arbitrária — prioridade média

**Problema:** o filtro verifica o MIME declarado pelo cliente, mas a extensão original é mantida. Um arquivo HTML declarado como imagem pode ser armazenado e servido como HTML. A rota exige ADMIN; não foi demonstrado upload anônimo.

**Evidência:** `apps/api/src/uploads/uploads.controller.ts` e `apps/api/src/uploads/uploads.service.ts`. Achado de código, sem envio de arquivo malicioso ao servidor.

**Correção:** validar o conteúdo real e gerar um formato de imagem controlado.

- [ ] Identificar o formato pelos bytes do arquivo, não apenas pelo MIME declarado.
- [ ] Derivar a extensão somente de formatos permitidos; considerar reprocessamento seguro da imagem.
- [ ] Limitar tamanho, dimensões e consumo de recursos na leitura de imagens.
- [ ] Garantir `Content-Type` correto e `X-Content-Type-Options: nosniff` na API e no proxy de uploads.
- [ ] Revisar proteção CSRF da operação de upload.
- [ ] Usar verificação de confinamento de caminhos que considere separadores de diretório.
- [ ] Testar MIME forjado, extensão `.html`, conteúdo inválido, traversal e imagens legítimas.

## 7. Cabeçalhos de segurança incompletos — prioridade média

**Problema:** nas respostas examinadas, a API expôs `X-Powered-By: Express` e não enviou HSTS ou cabeçalhos adicionais de proteção. O frontend tinha HSTS, mas não apresentou CSP ou proteção contra enquadramento.

**Evidência:** respostas HTTP públicas e `apps/api/src/main.ts`. A ausência de CSP em uma resposta JSON, isoladamente, não comprova XSS; a proteção deve considerar principalmente as páginas HTML e os arquivos servidos.

**Correção:** configurar políticas adequadas em cada origem e tipo de conteúdo.

- [ ] Remover `X-Powered-By`.
- [ ] Configurar `nosniff`, política de referência e proteção contra enquadramento onde aplicáveis.
- [ ] Definir CSP para o frontend, contemplando login Google, Asaas, imagens e conexões necessárias.
- [ ] Configurar HSTS na origem HTTPS da API, avaliando o alcance antes de incluir subdomínios.
- [ ] Validar cabeçalhos no domínio final, passando por Vercel e Cloudflare.
- [ ] Testar login, checkout, uploads e sockets para evitar bloqueios indevidos por CSP.

## 8. Serviços administrativos acessíveis na rede local — revisão de infraestrutura

**Problema:** Portainer respondeu em `192.168.0.35:9443`; o host também escutava nas portas SMB 139/445 e em outras portas de aplicações. Isso comprova acesso/escuta na LAN, não exposição à Internet nem falha de autenticação desses serviços.

**Evidência:** listeners do host e resposta HTTP do Portainer. A API da cantina estava corretamente vinculada a `127.0.0.1:1205`. Não foi possível consultar a política efetiva do firewall sem privilégios adicionais.

- [ ] Inventariar os serviços e confirmar quais precisam de acesso pela LAN.
- [ ] Restringir interfaces e origens de acesso administrativo a redes confiáveis/VPN.
- [ ] Revisar regras de firewall, publicação Docker, IPv6 e encaminhamento de portas do roteador.
- [ ] Validar autenticação e atualização do Portainer e dos serviços SMB.
- [ ] Preservar os demais projetos do host e testar os acessos legítimos após qualquer alteração.

## 9. Validação de CPF e telefone insuficiente — problema funcional

**Problema:** o perfil valida CPF principalmente pelo comprimento e aceita telefones entre 10 e 15 dígitos. Durante a validação anterior de pagamentos, o Asaas rejeitou um telefone aceito pela aplicação, levando a uma falha genérica no início da cobrança.

**Evidência:** `apps/api/src/auth/dto/update-profile.dto.ts`, `apps/api/src/auth/auth.service.ts` e comportamento observado na integração sandbox.

- [ ] Validar dígitos verificadores do CPF no servidor.
- [ ] Normalizar e validar telefone conforme o contrato aceito pelo Asaas.
- [ ] Alinhar validação e mensagens do frontend.
- [ ] Exibir erro acionável sem divulgar dados pessoais ou respostas sensíveis do provedor.
- [ ] Testar cadastros válidos, inválidos e correção do perfil antes de tentar novamente.

## 10. Configurações padrão e proteção de sessões — endurecimento pendente

**Problema:** o código permite fallback de JWT para `dev_secret`, e o seed contém senhas previsíveis. Na auditoria, o segredo efetivo do servidor estava configurado e não era o fallback; não foi verificado se contas com senhas do seed existem no banco publicado.

**Evidência:** `apps/api/src/auth/auth.module.ts`, `apps/api/src/auth/strategies/jwt.strategy.ts` e `apps/api/prisma/seed.ts`.

- [ ] Impedir inicialização em produção com JWT ausente, fraco ou padrão conhecido.
- [ ] Impedir uso acidental do seed com credenciais previsíveis em produção.
- [ ] Verificar contas de demonstração de forma controlada, sem tentativas automatizadas de senha no ambiente público.
- [ ] Revisar política de senhas e invalidação de sessões após troca de senha/desativação.
- [ ] Revisar proteção CSRF em todas as operações administrativas que alteram estado; CORS e SameSite não substituem uma análise dessas rotas.
- [ ] Testar as regras de sessão e documentar o procedimento de rotação de segredos.

## Ordem de execução e conclusão

- [ ] Corrigir isolamento de sockets e acesso a pedidos prontos.
- [ ] Ativar e validar limitação de requisições.
- [ ] Corrigir bloqueio de vendas no servidor.
- [ ] Atualizar e validar dependências expostas.
- [ ] Corrigir uploads, cabeçalhos e validação de cadastro.
- [ ] Concluir revisão de infraestrutura e sessões.
- [ ] Executar regressão de login, catálogo, Pix, cartão, caixa e retirada em ambiente controlado.
- [ ] Fazer backup antes do deploy e preparar rollback.
- [ ] Validar o resultado publicado e anexar, para cada item, commit, teste executado e resultado.

## Verificações já realizadas — não representam correção dos itens acima

- [x] Verificação SQLite `PRAGMA quick_check` retornou `ok` na auditoria.
- [x] API da cantina vinculada ao loopback, sem publicação direta da porta na LAN.
- [x] Rotas protegidas examinadas retornaram `401` sem sessão.
- [x] A origem externa examinada não recebeu autorização CORS da API HTTP.
- [x] Configuração de credenciais Asaas/JWT e permissões dos arquivos de segredo foram verificadas sem registrar seus valores neste documento.
- [x] Camada JSON criptografada implementada no commit `5dc99c3`, publicada e validada contra adulteração e chamadas em texto claro quando obrigatória.

**Limite importante:** a criptografia JSON não impede o usuário do navegador de inspecionar os dados após a decifragem. O modo implementado mantém chaves RSA por processo, depende de HTTPS e não fornece proteção própria contra replay. Múltiplas réplicas exigem planejamento adicional de distribuição/rotação de chaves ou afinidade.
