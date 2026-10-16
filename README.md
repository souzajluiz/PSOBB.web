# PSOBB.web

Cliente de **Phantasy Star Online: Blue Burst** rodando no navegador, conectando num servidor [newserv](https://github.com/fuzziqersoftware/newserv).

> Projeto pessoal/educacional de engenharia reversa e interoperabilidade. Nenhum arquivo do jogo (Sega) é distribuído aqui: cada usuário aponta o navegador para a própria instalação do PSOBB. Veja [docs/LEGAL.md](docs/LEGAL.md).

## Status

| Etapa | Estado |
|---|---|
| Cifra BB (Blowfish variante) em TypeScript | ✅ testada byte a byte contra newserv |
| PRS, GSL, AFS em TypeScript | ✅ testados contra newserv com arquivos reais do cliente |
| Ponte WebSocket ↔ TCP | ✅ |
| Login BB (03 → 93 → E6) via ponte | ✅ testado ao vivo contra newserv |
| Cliente web (Vite + three.js) | 🚧 em andamento |
| Viewer de mapas (`.rel` / `.xvm`) | ⏳ |
| Lobby, movimentação, outros jogadores | ⏳ |

Detalhes e próximos passos: [docs/ROADMAP.md](docs/ROADMAP.md). Diário de desenvolvimento: [docs/DEVLOG.md](docs/DEVLOG.md).

## Arquitetura

```
 Chrome ──WebSocket──> bridge (Node) ──TCP──> newserv
   │                                            (servidor PSO, C++)
   └─ lê a pasta data/ do PSOBB do usuário (File System Access API)
```

Explicação completa em [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). Protocolo e formatos em [docs/PROTOCOL.md](docs/PROTOCOL.md).

## Rodando localmente

Requisitos: macOS ou Linux, Node ≥ 23.6 (testado com 24.18), CMake, Git, Chrome.

```bash
# 1. Compilar o newserv (clona em vendor/, não versionado)
./scripts/setup-newserv.sh

# 2. Subir o servidor
(cd vendor/newserv && ./build/newserv)

# 3. Subir a ponte WebSocket
(cd bridge && npm install && npm start)

# 4. Testes
node tests/oracle.test.ts        # TS vs newserv (precisa dos arquivos do cliente)
node tests/login.live.ts         # login real via ponte
```

Os testes de formato procuram o cliente em `~/Downloads/psobb-client/data` (mude com `PSOBB_DATA=...`).

## Referências

O projeto se apoia em três fontes, descritas em [docs/REFERENCES.md](docs/REFERENCES.md):

1. **newserv**: servidor, formatos e protocolo (MIT).
2. **original-psobb-client-source**: dump Ghidra do `psobb.exe` com notas de protocolo, opcodes e fórmulas.
3. **Decompilação matching do PsoBB.exe**: lógica de jogo comprovada byte a byte (repositório privado, usado só como referência).

## Estrutura

```
bridge/          ponte WebSocket ↔ TCP
client/src/net/  cifra BB e conexão/protocolo
client/src/formats/  PRS, GSL, AFS (e em breve REL/XJ/XVM)
tests/           testes contra newserv (oráculo) e testes ao vivo
scripts/         setup do newserv
docs/            documentação
```
