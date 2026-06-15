# 🚀 Deploy do Genesis City (cidade rodando 24/7) — sem Docker

A simulação roda num **servidor Node sempre-ligado**; o navegador/celular é só um
**visualizador** que conecta por WebSocket e mostra a **mesma cidade viva**. Feche a
aba, troque de aparelho — a cidade continua evoluindo no servidor.

> **Dev local** (`npm run dev`): a sim roda num Web Worker no navegador, sem servidor.
> **Produção**: o frontend buildado conecta sozinho no WebSocket do mesmo host.

Tudo se resume a **3 comandos**: instalar, buildar, iniciar.

```bash
npm run setup        # instala deps do frontend + do servidor
npm run build:all    # compila o frontend (dist/) e prepara o servidor
npm start            # sobe a cidade 24/7 (serve o dist + WebSocket + simulação)
```

`npm start` escuta na porta `PORT` (padrão 4000). Abra `http://localhost:4000`.

---

## Opção A — VPS simples (Hetzner/DigitalOcean, ~US$5/mês) com PM2

A forma mais direta de manter 24/7 sem Docker. Num Ubuntu com Node 22:

```bash
# 1. Node 22 (se ainda não tiver)
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt install -y nodejs

# 2. Código
git clone <seu-repo> genesis-city && cd genesis-city
npm run setup && npm run build:all

# 3. PM2 mantém o processo vivo (religa após crash/reboot)
sudo npm install -g pm2
PORT=80 pm2 start npm --name genesis -- start
pm2 save && pm2 startup       # auto-iniciar no boot
```

Acesse `http://SEU_IP`. Para atualizar: `git pull && npm run build:all && pm2 restart genesis`.

---

## Opção B — Render / Railway (deploy a partir do GitHub, zero servidor)

Conecte o repositório e configure um **Web Service** Node:

| Campo | Valor |
|---|---|
| Build Command | `npm run setup && npm run build:all` |
| Start Command | `npm start` |
| Runtime | Node 22 |

- O `PORT` é injetado pelo provedor automaticamente (o servidor já o respeita).
- **Atenção ao "dormir":** o plano **grátis** do Render/Railway hiberna por inatividade
  — a cidade congela quando ninguém acessa e "pula no tempo" ao voltar. Para 24/7 de
  verdade, use uma instância **paga** (a mais barata, ~US$5–7/mês, fica sempre ligada).
- Garanta que as **devDependencies** sejam instaladas no build (Render faz por padrão;
  em outros, defina `NPM_CONFIG_PRODUCTION=false`).

---

## Opção C — Fly.io sem escrever Docker

O `flyctl` detecta Node e builda sozinho (buildpack), sem você manter Dockerfile:

```bash
fly auth login
fly launch --no-deploy --build-only=false   # detecta Node; defina start = "npm start"
fly deploy
fly open
```

Mantenha **1 máquina sempre ligada** (não escale > 1: o mundo vive na memória de uma
instância). *(Há um `Dockerfile` no repo se algum dia quiser usar — é totalmente opcional.)*

---

## PostgreSQL (opcional, recomendado para persistir)

Sem banco, a cidade roda só em memória (some se o processo reiniciar). Com banco, o
servidor **autosalva a cada 5 min** e **retoma o último snapshot** ao subir.

- Grátis e gerenciado: **Neon** ou **Supabase** (dão uma `DATABASE_URL`).
- Basta definir **uma** variável de ambiente no host:
  ```
  DATABASE_URL=postgres://usuario:senha@host:5432/banco
  ```
  (O `db.ts` já aceita `DATABASE_URL` com SSL automático; ou use `PG*` separadas.)
- Inicialize o schema uma vez: `cd server && npm run db:init`

---

## Configuração (variáveis de ambiente)

| Variável | Padrão | Para quê |
|---|---|---|
| `PORT` | 4000 | porta HTTP/WebSocket |
| `GENESIS_POP` | 10000 | população inicial |
| `GENESIS_SEED` | 1337 | semente da cidade |
| `AUTOSAVE_MIN` | 5 | intervalo de autosave (min) |
| `DATABASE_URL` | — | Postgres gerenciado (opcional) |

Veja `server/.env.example`.

---

## Limites honestos

- **1 mundo, 1 instância.** Ótimo para uso pessoal. O servidor só envia frames quando
  há alguém conectado (economiza CPU/banda quando ninguém olha).
- **Banda**: ~100 KB por frame a 10 Hz (~1 MB/s por espectador) com 10k habitantes. Em
  rede móvel, reduza `SYNC_HZ` em `src/simulation/config.ts`.
- **100k habitantes** pedem uma VM maior (mais CPU/RAM); 10k roda folgado em 1 vCPU/1 GB.
