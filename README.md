# Família Steam

Retrospectiva anual de compras da família Steam: quem comprou cada jogo, quem presenteou quem, quais compras foram rachadas — e os rankings do ano no estilo da retrospectiva de 2025.


## Como funciona

- **Senha única**: sem usuários — toda a família entra com a mesma senha. Troca em **Ajustes → Senha da família**.
- **Adicionar jogo**: **busque pelo nome** (ex.: `Hollow Knight`) e toque no resultado, **ou** cole o **link da loja Steam** (`store.steampowered.com/app/ID/…`). O app busca **nome, capa e preço atual** na API pública da Steam e preenche o formulário — você confirma o **preço pago no dia da compra** e a **data da compra**.
  > Limitação real: a API da Steam informa apenas o preço **atual**, não o histórico. Por isso o valor buscado entra como sugestão e você ajusta para o que foi pago de fato (nota, e-mail da Steam ou extrato).
- **Presente**: marque se a compra foi presente para um dos membros.
- **Racha**: marque um ou mais membros que dividiram a compra.
- **Fotos de perfil**: na aba **Família**, toque na foto de cada membro para enviar uma (o app reduz sozinho no celular).
- **Anos independentes**: o seletor de ano no topo filtra tudo. Cada ano tem suas próprias estatísticas — o ano passado não influencia o atual.
- **Retrospectiva do ano**: total de jogos, mês com mais/menos jogos, gráfico por mês e os rankings:
  - Quem comprou mais
  - Maiores presenteadores (com valor em R$)
  - Comprador compulsivo (mais jogos num único mês)
  - Quem mais gastou (R$ no ano)
  - Presentes recebidos
  - Rachas: quem mais entrou e quem mais iniciou
  - Reis do mês (quem mais comprou em cada mês)
  - Jogos mais caros do ano

## Dados de exemplo (formato 2025)

```
Retrospectiva Família Steam 2025:
Total de Jogos: 165
Mês com mais jogos: Junho (29 jogos)
Mês com menos jogos: Janeiro e Agosto (4 jogos)

Rankings:
1º: Gahtee e Redwolf (36 jogos)
3º: Bulbasaurito (32 jogos)
...
```

Os empates seguem a numeração de competição (1º, 1º, 3º…), igual à retrospectiva original.

## Celular

Layout mobile-first: no celular aparece uma **barra de navegação inferior** (Resumo · Jogos · + Jogo · Família · Ajustes), o formulário de jogo vira **bottom-sheet**, botões e campos com altura mínima de toque e lista de jogos compacta.

## Frontend (React + Vite + Tailwind, gerado no Lovable)

O frontend atual é um SPA em `frontend-novo/` (React 19 + Vite 8 + Tailwind 4 + shadcn/ui + TanStack Router/Start em modo SPA). Ele consome o backend **na mesma origem** (caminhos relativos `/api/*`), sem CORS.

```bash
# 1. build do frontend (gera frontend-novo/dist/client/)
cd frontend-novo && npm install && npm run build

# 2. publicar no backend (a partir da raiz do projeto)
rm -rf public/index.html public/assets public/favicon.ico public/robots.txt
cp frontend-novo/dist/client/_shell.html public/index.html
cp -r frontend-novo/dist/client/assets public/assets
cp frontend-novo/dist/client/favicon.ico frontend-novo/dist/client/robots.txt public/

# 3. reiniciar o backend
pm2 restart fsteam   # ou: node server.js --daemon
```

Detalhes:

- `frontend-novo/vite.config.ts` usa `tanstackStart: { spa: { enabled: true } }` + `nitro: false` para gerar HTML estático em vez de servidor SSR.
- `VITE_API_BASE_URL` não precisa ser definido: `API_BASE` vazio em `src/lib/familia-api.ts` mantém tudo mesma-origem.
- O `server.js` serve `public/` com fallback SPA (qualquer `GET` fora de `/api/*` e `/avatars/*` sem extensão cai em `index.html`) e CSP liberando `fonts.googleapis.com`/`fonts.gstatic.com`.
- O frontend antigo (`index.html` + `style.css` + `app.js`) está salvo em `/tmp/fsteam-old/` (cópia local, não versionada).

## Como rodar

```bash
# 1. requer Node 22+
node --version

# 2. primeira vez: define a senha da família (ou via env PASSWORD)
node server.js --set-password
# ou: PASSWORD='troque-por-uma-senha-forte' node server.js --set-password

# 3. inicia
PORT=3001 BIND=127.0.0.1 node server.js
# abra http://127.0.0.1:3001
```

Modo serviço (background, estilo pm2 — sobrevive ao fim da sessão do terminal):

```bash
node server.js --daemon [porta]  # escolhe porta livre se omitida; gera senha se o banco estiver vazio
node server.js --status          # pid + endereço
node server.js --stop            # parar
# log: data/service.log
```

### Primeiro uso (ordem sugerida)

1. Entre com a senha da família.
2. Vá em **Família** → cadastre `Gahtee`, `Redwolf` (ou quem for) e toque na foto de cada um para colocar o avatar.
3. Toque em **+ Jogo** e registre as compras do ano.

## Exposição via Cloudflare Tunnel

O app serve **HTTP puro** (sem TLS próprio). No painel do túnel, configure o Public Hostname com **Service Type `HTTP`** apontando para o endereço local, ex.: `http://127.0.0.1:3001`. Detalhes e endurecimento (WAF, Access, SSL Full strict) em [`tunnel.md`](tunnel.md).

## Rodando com PM2 (recomendado)

```bash
pm2 start ecosystem.config.cjs   # sobe o app em 127.0.0.1:3001
pm2 status                       # ver status
pm2 logs fsteam                  # ver logs
pm2 restart fsteam               # reiniciar
pm2 save                         # congela a lista (restaura com `pm2 resurrect`)
pm2 startup                      # subir o pm2 no boot (rode o comando que ele imprimir)
```

## Backup

```bash
cp data/fsteam.db ./backup-$(date +%F).db
cp -r data/avatars ./backup-avatars-$(date +%F)   # fotos de perfil
```

## Esquema do banco (SQLite, `data/fsteam.db`)

- `auth` / `sessions` / `audit` — senha única (scrypt), sessões HttpOnly + CSRF (30 dias), auditoria com rotação (5000 eventos).
- `members(id, name, avatar)` — membros da família; `avatar` é o nome do arquivo em `data/avatars/`.
- `purchases(id, appid, game_name, header_image, steam_url, buyer_member_id, purchase_date, price_paid_cents, price_source, is_gift, gift_to_member_id, note, …)` — `price_paid_cents` guarda o valor **pago no dia**; `price_source` indica se veio da sugestão da Steam (`steam-atual`) ou digitado (`manual`).
- `purchase_splits(purchase_id, member_id)` — parceiros do racha (o comprador não entra; ele já conta).
- `steam_cache(appid, name, header_image, payload, updated_at)` — cache de 6h das respostas da API da Steam (evita rate-limit e acelera o cadastro). Buscas por nome usam cache em memória (10 min).

## Segurança

Senha única com hash scrypt, lockout progressivo anti-bruteforce, rate-limit por IP, CSRF, sessões HttpOnly. Upload de avatar com validação de magic bytes e limite de 500 KB (o app reduz no celular antes de enviar). Cabeçalhos de segurança + CSP (com exceção para as capas `steamstatic.com`). Logs de auditoria em `audit`.

## Publicando no GitHub (sem vazar segredos)

O `.gitignore` já bloqueia `data/` (banco, avatares, pid/ports, logs), `.env`, chaves e credenciais do tunnel. Antes de publicar, confira:

```bash
# 1. revise o que será commitado — NÃO pode aparecer data/, .env, *.pem, tunnel *.json
git status --short
git check-ignore -v data/fsteam.db data/avatars .env 2>/dev/null || true

# 2. garanta que nenhum segredo está nos arquivos rastreados
grep -rn "PRIVATE KEY" --exclude-dir=node_modules --exclude-dir=.git . || echo "limpo"

# 3. primeiro publish
git init -b main                                   # se ainda não for repo
git add server.js public package.json ecosystem.config.cjs .gitignore README.md tunnel.md
git commit -m "Família Steam: retrospectiva de compras da família"
gh repo create familia-steam --private --source=. --push   # requer gh autenticado
# sem gh: crie o repo no github.com e rode:
#   git remote add origin git@github.com:SEUUSER/familia-steam.git
#   git push -u origin main
```

> Recomenda-se repo **privado**: embora não contenha segredos, o código expõe a superfície da API. Nunca commite `data/` — ele contém hash da senha e sessões.
