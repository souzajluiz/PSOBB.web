# Arquitetura

## Visão geral

```
┌──────────────────────── Chrome ────────────────────────┐
│  client/ (TypeScript, Vite, three.js)                  │
│   ├─ formats/  PRS, GSL, AFS, REL/XJ, XVM  ◄── pasta data/ do usuário
│   ├─ net/      BBCrypt + BBConnection                   │
│   └─ render/   cena three.js (mapas, modelos)           │
└──────────────┬─────────────────────────────────────────┘
               │ WebSocket (binário, cifrado ponta a ponta)
┌──────────────▼──────────────┐
│ bridge/ (Node + ws)         │  relay de bytes puro, allowlist de portas
└──────────────┬──────────────┘
               │ TCP
┌──────────────▼──────────────┐
│ newserv (C++)               │  login, lobby, jogos, quests, drops
└─────────────────────────────┘
```

## Decisões

### Reescrever o cliente na web, não emular o `.exe`

O `PsoBB.exe` é Win32 com Direct3D 8, DirectInput, DirectSound e WinSock. Emular x86 e Direct3D no navegador seria lento e frágil. Por isso o cliente é **reimplementado** em TypeScript, e as duas decompilações servem de especificação (veja [REFERENCES.md](REFERENCES.md)).

### three.js em vez de Godot

A decompilação matching mira um porte em Godot. Para um alvo **web-first**, three.js tem três vantagens:
- Não precisa dos export templates do Godot, que ocupam mais de 1 GB.
- Não exige COOP/COEP nem SharedArrayBuffer.
- Os parsers dos formatos do PSO (PRS, NJ/XJ, XVM) rodam em JS/TS direto no navegador, que é onde os dados do usuário já estão.

A lógica de jogo extraída da decompilação é portável para qualquer engine, então dá pra rever essa escolha depois.

### Ponte burra (relay) em vez de gateway com protocolo

O navegador não abre TCP. A ponte só copia bytes entre o WebSocket e o TCP. A criptografia e todo o protocolo ficam no navegador. Vantagens:
- A ponte é trivial e genérica, com cerca de 60 linhas.
- O cliente web fala exatamente o mesmo protocolo do cliente original, então o newserv não precisa de nenhuma mudança.
- O redirecionamento BB (comando `19`) vira apenas "reconectar pela ponte em outra porta".

**Segurança:** a ponte só aceita portas da allowlist (`ALLOWED_PORTS`) e escuta só em `127.0.0.1`. Sem a allowlist ela seria um proxy TCP aberto.

### Assets do usuário, não do repositório

O navegador lê a pasta `data/` da instalação do PSOBB do próprio usuário. Nada da Sega entra no repositório nem no deploy.

## Testes

- `tests/oracle.test.ts`: compara cada porte TS com o binário do newserv usando dados reais (cifra BB com chaves `default` e `default4`, PRS de 20 arquivos do `data.gsl`, e as 1524 entradas do GSL).
- `tests/login.live.ts`: login BB real pela ponte contra o newserv rodando.
- Chrome: toda funcionalidade de UI é verificada no Chrome (claude-in-chrome) antes do commit.
