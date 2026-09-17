# Plano — Família Steam

## Objetivo e limites

Recriar somente o frontend do Família Steam, preservando o backend e seu contrato atual. A interface fará chamadas com `fetch`, usando cookie de sessão `HttpOnly`, CSRF mantido apenas em memória e as respostas/erros em pt-BR já fornecidos pela API.

Não serão criados banco, autenticação paralela, rotas de backend ou dados fictícios persistentes.

## Direção visual

Uma biblioteca familiar de jogos com linguagem editorial e um grande momento anual, não um dashboard corporativo. A referência de Linear entra na precisão, hierarquia e economia visual; a de igloo.inc entra na composição tipográfica, ritmo e personalidade.

- **Atmosfera:** noturna sem cair em preto + neon; superfícies azul-petróleo profundas, texto mineral claro e acentos quentes pontuais.
- **Composição:** bastante respiro, divisórias finas e blocos abertos; cards somente para itens que realmente são objetos, como jogo ou membro.
- **Formas:** raios mistos e contidos, entre 4 e 10 px; sem uma sombra cinza repetida em tudo.
- **Movimento:** entradas curtas por sequência, contadores suaves e barras/gráficos revelados progressivamente; tudo desativável por `prefers-reduced-motion`.
- **Texto:** sem caixa alta decorativa, eyebrows, frases separadas por pontos ou setas em botões.

## Paleta

- **Fundo profundo:** `#0B1417`
- **Superfície elevada:** `#132126`
- **Superfície suave:** `#1B2D32`
- **Texto principal:** `#F2F5F3`
- **Texto secundário:** `#9FB0AE`
- **Borda:** `#294047`
- **Verde Steam familiar / ação:** `#79C7A5`
- **Azul de dados:** `#63A9D8`
- **Coral de presentes / destaque:** `#F18D74`
- **Amarelo de recordes:** `#E7C66A`
- **Erro:** `#E56B6F`

Esses valores serão convertidos para tokens semânticos em OKLCH no sistema visual. Cores de rankings e gráficos serão tokens próprios, nunca valores soltos nas telas.

## Tipografia

- **Títulos e números de destaque:** `Space Grotesk`, peso 500–600. Geométrica, expressiva e ótima para valores grandes.
- **Interface e leitura:** `Manrope`, peso 400–600. Clara em tabelas, filtros e formulários.
- **Números:** algarismos tabulares onde comparação e alinhamento importam.
- **Escala:** título anual grande e responsivo por breakpoints; sem dimensionar fonte diretamente pela largura da janela.

## Navegação e estrutura

Desktop usa uma barra lateral compacta com marca, ano ativo e quatro destinos. Mobile usa cabeçalho curto e navegação inferior. A troca de ano fica próxima ao conteúdo anual, não escondida em Ajustes.

1. **Retrospectiva**
2. **Jogos**
3. **Família**
4. **Ajustes**

A raiz verifica `GET /api/me`: sessão válida abre a Retrospectiva; `401` mostra Login. Nada protegido aparece antes dessa verificação.

## Componentes shadcn/ui

- **Button:** ações principais, secundárias e destrutivas, com variantes próprias do tema.
- **Input, Label e Textarea:** login, busca e formulários de jogos/membros.
- **Select:** ano, membro, presenteado e filtros categóricos.
- **Command + Popover:** busca/seleção de jogos na Steam e filtros pesquisáveis.
- **Dialog:** criar/editar jogo e membro.
- **AlertDialog:** exclusões e troca de senha com consequência de sessão.
- **Avatar:** membros, ranking e upload com fallback de iniciais.
- **Tabs:** alternância compacta dentro da retrospectiva, sem substituir a navegação principal.
- **DropdownMenu:** ações contextuais de jogo/membro e menu da sessão.
- **Tooltip:** botões apenas com ícone.
- **Badge:** presente, rachado e pequenos estados sem dominar a leitura.
- **Table:** visão densa de jogos em desktop, adaptada para linhas editoriais no mobile.
- **Skeleton:** carregamento sem saltos de layout.
- **Progress:** upload e indicadores comparativos quando fizer sentido.
- **Sonner:** confirmação e erros da API.
- **Recharts:** gráfico mensal e visualizações comparativas, estilizados com os tokens do app.

Não haverá card envolvendo página inteira, cards aninhados ou uma grade uniforme de métricas.

## Wireframes

### 1. Login

```text
┌──────────────────────────────────────────────────────────────┐
│ Família Steam                                                │
│                                                              │
│             Sua biblioteca, um ano de cada vez.              │
│             ┌──────────────────────────────┐                 │
│             │ Senha da família             │                 │
│             └──────────────────────────────┘                 │
│             [ Entrar ]                                       │
│             mensagem de erro / bloqueio                      │
│                                                              │
│      faixa baixa com capas recortadas da biblioteca*         │
└──────────────────────────────────────────────────────────────┘
* exibida apenas quando houver fonte real disponível na API
```

Tela simples, com a marca e a senha como foco. Estados específicos para senha incorreta, limite de tentativas, bloqueio e senha ainda não configurada.

### 2. Retrospectiva

```text
┌──────────────┬────────────────────────────────────────────────┐
│ Família      │ Retrospectiva                         [2026 ▾] │
│ Steam        │                                                │
│              │  48 jogos                                      │
│ Retrospectiva│  R$ 2.438,70                                   │
│ Jogos        │  O ano da família na Steam                     │
│ Família      │                                                │
│ Ajustes      │  compras por mês ───────────── gráfico aberto  │
│              │                                                │
│              │  Pódio do ano                                  │
│              │  1  mais comprou       2  mais presenteou      │
│              │  3  mais gastou         rankings secundários   │
│              │                                                │
│              │  O jogo mais caro                              │
│              │  capa grande + preço + comprador + contexto    │
│              │                                                │
│              │  rachados / presentes / top 5                  │
└──────────────┴────────────────────────────────────────────────┘
```

Os totais formam o “momento” principal. O gráfico ocupa uma faixa horizontal ampla. Rankings usam pódios/listas com retratos, não caixas de KPI. Jogo mais caro recebe tratamento de pôster. No mobile, a retrospectiva vira narrativa vertical preservando essa ordem.

### 3. Jogos

```text
┌──────────────┬────────────────────────────────────────────────┐
│ navegação    │ Jogos                         [ Exportar CSV ] │
│              │                                                │
│              │ [ Buscar jogos...        ] [2026] [Filtros]    │
│              │                                                │
│              │ capa  título                 membro    valor   │
│              │ ███   Hollow Knight          Gabriel   59,99   │
│              │       presente para Maria · 14 mar             │
│              │ ─────────────────────────────────────────────  │
│              │ capa  título...                                 │
│              │                                                │
│              │                         [ + Adicionar jogo ]    │
└──────────────┴────────────────────────────────────────────────┘
```

Busca e filtros permanecem visíveis. Desktop prioriza leitura densa; mobile mostra cada jogo como linha com capa vertical, metadados e menu. Cadastro começa pelo lookup da Steam, permite confirmar capa/dados e então completar comprador, preço, presente, divisão, data, link e nota conforme o contrato existente.

### 4. Família

```text
┌──────────────┬────────────────────────────────────────────────┐
│ navegação    │ Família                    [ + Novo membro ]   │
│              │                                                │
│              │ retratos em linha, nomes com presença forte    │
│              │                                                │
│              │ [foto] Gabriel                                 │
│              │        totais pessoais e ações contextuais     │
│              │ ─────────────────────────────────────────────  │
│              │ [foto] Maria ...                               │
└──────────────┴────────────────────────────────────────────────┘
```

Os membros parecem parte de um álbum compartilhado, não registros administrativos. Criar/editar abre diálogo; avatar aceita envio, mostra progresso, preview, fallback e erros de tamanho/formato retornados pela API.

### 5. Ajustes

```text
┌──────────────┬────────────────────────────────────────────────┐
│ navegação    │ Ajustes                                        │
│              │                                                │
│              │ Segurança                                      │
│              │ senha atual  nova senha  confirmar             │
│              │ [ Atualizar senha ]                            │
│              │                                                │
│              │ Dados                                          │
│              │ ano para exportação          [ Baixar CSV ]    │
│              │                                                │
│              │ Sessão                         [ Sair ]         │
└──────────────┴────────────────────────────────────────────────┘
```

A troca de senha explica de modo curto que outras sessões serão encerradas. Logout limpa estado e cache visual antes de voltar ao login.

## Integração com a API existente

- Cliente único de `fetch` usando caminhos relativos `/api/*`, `credentials: "include"` e tradução uniforme de respostas não-2xx.
- CSRF obtido no login ou em `GET /api/me`, guardado somente em memória e anexado a mutações, exceto login/logout.
- Em `401`, limpar estado protegido e voltar ao login; em `403`, renovar o CSRF uma vez e repetir a mutação com segurança; demais erros mostram a mensagem em pt-BR do backend.
- URL-base configurável somente para desenvolvimento. Em produção, o padrão será mesma origem, compatível com o Cloudflare Tunnel descrito.
- Avatar usa o formato de upload exigido pela rota existente; capas e links Steam usam diretamente os campos devolvidos pelo backend.
- CSV será baixado como arquivo, respeitando nome e conteúdo fornecidos pelo servidor.
- Consultas serão cacheadas por recurso e ano; depois de criar, editar ou excluir, apenas os dados relacionados serão invalidados.

## Estados e acessibilidade

- Vazio, carregando, erro e sucesso em todas as quatro áreas.
- Formulários bloqueiam reenvio durante mutações e preservam o que o usuário digitou quando a API rejeitar.
- Foco visível, navegação por teclado, diálogos com foco contido, ícones com nome acessível e contraste AA.
- Capas têm proporção estável e fallback textual; avatares têm iniciais; gráficos têm resumo textual e tooltip acessível.
- Layout validado em desktop e mobile, sem sobreposição ou mudanças de tamanho ao carregar imagens.

## Ordem de implementação

1. Sistema visual, fontes, shell responsivo e componentes base.
2. Cliente da API, sessão/CSRF, login, logout e proteção das telas.
3. Retrospectiva anual e gráfico/rankings.
4. Jogos: listagem, busca, filtros, Steam lookup, cadastro/edição/exclusão e CSV.
5. Família: listagem, cadastro/edição/exclusão e avatar.
6. Ajustes: senha, exportação e sessão.
7. Estados de erro, acessibilidade, validação mobile/desktop e metadados de cada tela.

## Condição de ambiente

`http://127.0.0.1:3001` aponta para a máquina onde o navegador está rodando e não fica acessível no preview hospedado. A implementação continuará correta para a publicação na mesma origem. Para testar dados reais durante o desenvolvimento, será necessário disponibilizar o backend em uma URL HTTPS alcançável pelo preview ou executar frontend e backend localmente sob a mesma origem/proxy.
