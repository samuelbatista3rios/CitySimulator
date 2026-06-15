# 🌆 Genesis City — Simulador de Sociedade Viva 3D

Uma cidade 3D procedural onde **10.000+ habitantes** vivem de forma autônoma: cada um
tem personalidade (Big Five), memória episódica, objetivos que surgem dinamicamente,
carreira, relacionamentos, filhos e morte. A simulação **continua evoluindo sozinha**,
sem intervenção do usuário — economia, eventos globais e ciclo de vida rodam em loop.

Arquitetado para escalar até **100.000 habitantes** com **50+ FPS**.

![stack](https://img.shields.io/badge/React_Three_Fiber-Three.js-blue) ![ecs](https://img.shields.io/badge/ECS-Web_Worker-green) ![ai](https://img.shields.io/badge/IA-GOAP-orange)

---

## 🚀 Como rodar

### 1. Frontend (a simulação roda 100% no navegador, via Web Worker)

```bash
npm install
npm run dev
# abre http://localhost:5173
```

Isso é **suficiente** para rodar a cidade inteira — a simulação vive num Web Worker e
não precisa de backend. O salvamento cai automaticamente em `localStorage` se a API
estiver offline.

### 2. Backend opcional (persistência em PostgreSQL)

```bash
cd server
npm install
# configure: PGHOST, PGUSER, PGPASSWORD, PGDATABASE (padrão genesis_city)
createdb genesis_city
npm run db:init     # aplica server/schema.sql
npm run dev         # API em http://localhost:4000 (proxied via /api)
```

Com o backend no ar, **💾 Salvar** grava o snapshot completo (JSONB) + um espelho
analítico relacional (tabelas `citizens`, `companies`, `city_stats`).

---

## 🎮 Controles

| Ação | Como |
|------|------|
| Mover câmera | Arrastar (botão esquerdo) |
| Zoom | Scroll |
| Ver a vida de um habitante | **Clicar** num boneco |
| Velocidade do tempo | Botões `4h/s` … `3 meses/s` |
| Pausar | `⏸ Pausar` |
| Salvar / Carregar | `💾` / `📂` |
| Ranking de empresas | `🏢 Empresas` |

---

## 🧠 Como funciona (arquitetura)

```
┌──────────────────────── MAIN THREAD (UI / Render) ────────────────────────┐
│  React + React Three Fiber                                                 │
│  • CityScene → Ground · Buildings · Citizens · Vehicles (InstancedMesh)    │
│  • Dashboard · CitizenPanel · TimeControls · EventFeed                     │
│  • Zustand store (state/store.ts)                                          │
└───────────────▲───────────────────────────────────┬──────────────────────┘
                │ frames (Float32Array transferível) │ comandos
                │ stats · feed · citizen detail       ▼
┌───────────────┴──────────────── WEB WORKER (simWorker.ts) ─────────────────┐
│  Simulation (orquestrador)                                                 │
│  ┌────────────── ECS híbrido (SoA + cold data) ──────────────┐            │
│  │ HotComponents: typed arrays (posição, necessidades, $…)    │            │
│  │ ColdData[]: memória, relações, objetivos (acesso sob demanda)│          │
│  └────────────────────────────────────────────────────────────┘          │
│  Sistemas por tick: needs → GOAP think → activities                       │
│  Mensais: economia · carreiras · casais · ciclo de vida · eventos globais │
│  Tráfego: veículos autônomos + semáforos + congestionamento               │
└──────────────────────────────────┬────────────────────────────────────────┘
                                    │ /api/save · /api/load
┌──────────────────────────────────▼────────────────────────────────────────┐
│  BACKEND (Node + Express + PostgreSQL)  — server/                          │
│  snapshots(JSONB) · citizens · companies · city_stats                     │
└────────────────────────────────────────────────────────────────────────────┘
```

### Por que isso escala para 100k habitantes

1. **Worker isolado** — a simulação nunca trava a UI; o render roda a 60 FPS
   independentemente do peso do tick.
2. **ECS Structure-of-Arrays** — os dados "quentes" (lidos todo tick) ficam em
   `Float32Array`/`Int32Array` contíguos: cache-friendly, **zero garbage collection**,
   e transferíveis por referência (zero-copy) para a thread de render.
   Capacidade pré-alocada em `CONFIG.MAX_CITIZENS = 100_000`.
3. **Dados frios separados** — memória, relacionamentos e objetivos (objetos JS) só são
   tocados quando o agente *pensa* (a cada ~6h simuladas, **escalonado** entre os
   agentes), não todo tick.
4. **GOAP barato** — busca regressiva com *beam search* (profundidade 5, 8 nós): planos
   saem em microssegundos por agente.
5. **Render instanciado** — todos os prédios em **1 draw call**; até 20k cidadãos e 2.5k
   veículos cada um em 1 InstancedMesh. **LOD** (descarta quem está longe da câmera) +
   **frustum culling** + culling lógico (quem está dentro de prédios não vira boneco).
6. **Sincronização desacoplada** — posições a 10 Hz, estatísticas a 1 Hz; o tick da
   simulação pode rodar muito mais rápido que o envio de frames.

---

## 📦 Estrutura

```
src/
  simulation/            # toda a lógica (roda no worker)
    config.ts            # parâmetros globais (população, tempo, economia…)
    rng.ts               # PRNG determinístico (seed → cidade reprodutível)
    simulation.ts        # ORQUESTRADOR: pipeline de sistemas por tick
    ecs/
      components.ts       # HotComponents (SoA) + ColdData
      world.ts            # alocação/reciclagem de entidades
    agents/
      personality.ts      # Big Five + herança + pesos de comportamento
      goap.ts             # Goal Oriented Action Planning
      goals.ts            # objetivos de vida dinâmicos
      memory.ts           # memória episódica (com esquecimento)
      relationships.ts    # amizade, conflito, namoro, casamento, separação
      skills.ts           # aprendizado com retornos decrescentes
      lifecycle.ts        # envelhecer, saúde, aposentar, morrer, nascer
      spawn.ts            # criação de cidadãos e filhos (herança)
      names.ts            # nomes pt-BR
    economy/
      companies.ts        # empresas, cargos, setores, vagas
      careers.ts          # contratar, promover, demitir, trocar, empreender
      economy.ts          # PIB, inflação, impostos, falências, crescimento
      bank.ts             # crédito, hipoteca/financiamento, contas, inadimplência
    government/government.ts # eleições, prefeito, leis, orçamento público
    institutions/institutions.ts # hospitais, escolas, polícia, crime e prisão
    events/globalEvents.ts# crise, boom, pandemia, eleições, tecnologia
    traffic/traffic.ts    # veículos autônomos, semáforos, congestionamento
    world/                # geração procedural da cidade
  rendering/             # CityScene, Buildings, Citizens, Vehicles, Ground
  ui/                    # Dashboard, CitizenPanel, TimeControls, EventFeed
  state/store.ts         # ponte worker↔UI (Zustand)
  workers/simWorker.ts   # entrypoint do Web Worker
  database/              # serializer (snapshot) + saveSystem (API/localStorage)
server/                  # Node + Express + PostgreSQL
```

---

## 🧬 Sistemas de vida (detalhe)

- **Personalidade Big Five** (0–100): abertura, consciência, extroversão, amabilidade,
  neuroticismo. Modula pesos de necessidade, ambição e sociabilidade — é o que faz dois
  cidadãos agirem diferente na mesma situação. Filhos **herdam** a média dos pais + ruído.
- **Necessidades**: fome, sono, social, segurança, diversão, dinheiro — decaem por hora
  (vetorizado sobre toda a população).
- **GOAP**: o objetivo vem da necessidade mais urgente (ponderada pela personalidade) ou,
  quando o básico está satisfeito, do **objetivo de vida** prioritário. O planejador gera
  a sequência de ações (`Trabalhar`, `Dormir`, `Estudar`, `AbrirEmpresa`…).
- **Objetivos dinâmicos**: comprar carro/casa, casar, abrir empresa, enriquecer, estudar,
  conseguir emprego/promoção — surgem conforme idade, finanças e personalidade.
- **Carreira**: contratação por compatibilidade de skill, promoção por mérito, demissão
  voluntária por insatisfação, troca de empresa, demissão em massa por crise, e
  **abertura de negócio próprio** por cidadãos ambiciosos.
- **Economia emergente**: folha + impostos, receita por produtividade × demanda,
  **inflação** dirigida por demanda agregada, **falências**, aposentadoria pública e
  crescimento (empresas lucrativas abrem vagas).
- **Relacionamentos**: compatibilidade por Big Five → amizade/conflito → namoro →
  casamento → filhos → separação. Tudo registrado na **memória** de cada um.
- **Ciclo de vida**: nascer → crescer → estudar → trabalhar → aposentar → morrer, com
  **herança** de dinheiro aos filhos.
- **Eventos globais**: crise, boom, pandemia (sobe mortalidade), eleições, avanço
  tecnológico — alteram parâmetros macro por meses.
- **Estatísticas emergentes**: PIB, desemprego, criminalidade (ancorada em crimes
  reais), felicidade/educação/saúde médias, inflação, nascimentos/mortes.

### Governo, leis e cidadania (módulos novos)

- **Governo & leis** (`government/government.ts`): a cada 4 anos há **eleição**;
  cada cidadão vota numa plataforma (Progressista / Centro / Liberal / Lei e Ordem)
  conforme personalidade e bolso. A plataforma vencedora vira **lei**: define
  imposto, salário mínimo e como o **orçamento público** (impostos arrecadados) é
  gasto em segurança, saúde, educação e transferência de renda — e isso afeta a
  economia e as instituições de verdade. Um cidadão é eleito **Prefeito(a)**.
- **Banco & financiamento** (`economy/bank.ts`): compra de casa/carro **à vista ou
  financiada** (hipoteca de 20 anos, financiamento de carro de 4 anos, entrada de
  20%), **contas itemizadas** (água/luz/internet), **score de crédito** (300–850)
  que define os juros, **inadimplência** e **execução de garantia** (perde a casa/o
  carro após 3 parcelas atrasadas).
- **Saúde, educação e polícia** (`institutions/institutions.ts`): hospitais, escolas,
  delegacias e prefeitura ocupam prédios reais (com ícones no mapa). Hospitais
  **tratam** os mais doentes (capacidade × verba de saúde); escolas **aceleram** a
  escolaridade dos jovens (× verba de educação); e o **crime é real** — cidadãos em
  risco (pobres, desempregados, infelizes) cometem furtos contra vítimas, a **polícia
  prende** conforme a verba de segurança, e os presos vão para a **cadeia** por alguns
  meses (com reincidência).

### Experiência (UX)

- **Busca por nome** (canto superior): digite e clique para abrir a ficha.
- **Destaque ao passar o mouse** sobre um habitante (fica maior e branco).
- **Seguir com a câmera**: botão na ficha — a câmera acompanha o cidadão.
- **Ciclo dia/noite**: o sol descreve um arco conforme a hora simulada; luz e céu
  acompanham (amanhecer, meio-dia, entardecer, noite).

---

## 💾 Salvamento

`serialize()` no worker monta um snapshot completo (typed arrays + cold data + empresas +
economia) como JSON. `saveSystem.ts` tenta `POST /api/save` (PostgreSQL) e cai para
`localStorage` se o backend estiver offline. `deserialize()` reconstrói a simulação
(a geometria da cidade é **determinística pela seed**, então só os agentes precisam ser
restaurados).

---

## ⚙️ Ajustes rápidos

Tudo em `src/simulation/config.ts`: `START_POPULATION`, `MAX_CITIZENS` (capacidade),
velocidade de decaimento das necessidades, preços, impostos, idades do ciclo de vida,
nº de veículos, etc. Para testar 100k habitantes, suba `START_POPULATION` (e garanta
residências/empresas suficientes ou ajuste os multiplicadores).
