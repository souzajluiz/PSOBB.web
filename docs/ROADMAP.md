# Roadmap

## Fase 1: fundação ✅
- [x] Compilar o newserv no macOS (Apple Silicon)
- [x] Cifra BB em TS, com teste contra o newserv
- [x] PRS, GSL e AFS em TS, com teste contra o newserv
- [x] Ponte WebSocket ↔ TCP com allowlist
- [x] Login BB real pela ponte (`03` → `93` → `E6`)

## Fase 2: cliente no navegador 🚧
- [ ] Projeto Vite + TypeScript + three.js
- [ ] Seletor da pasta `data/` (File System Access API) e índice dos arquivos
- [ ] Tela de login no Chrome, conectando pela ponte
- [ ] Seguir o redirecionamento `19`, a seleção de personagem (`E3`/`E5`) e a entrada no lobby

## Fase 3: viewer de mapas
- [ ] Parser de REL (tabela de relocação + ponteiro raiz)
- [ ] Parser de XJ (modelos do BB: vertex/index buffers)
- [ ] Decodificação de XVM/XVR (texturas DXT/ARGB) para textura WebGL
- [ ] Render do `map_city00_00n.rel` (Pioneer 2) com câmera livre
- [ ] Marcadores de inimigos e objetos a partir de `map_*e.dat` / `o.dat`

## Fase 4: online
- [ ] Lobby: lista de jogadores, chat
- [ ] Movimento próprio enviado via `6x40/6x42/6x3E` (layouts em `headers/network.h` da decomp)
- [ ] Outros jogadores renderizados a partir dos `6x` recebidos
- [ ] Modelos de personagem (`pl?smp.rel`, `pl?tex.afs`) e animações

## Fase 5: jogo
- [ ] Colisão (`*c.rel`)
- [ ] Inimigos, combate (fórmulas em `notes/_wiki_combat_formulas.md`)
- [ ] Itens e inventário
- [ ] Quests (opcodes já documentados nas notas e no assembler do newserv)
