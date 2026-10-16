# Referências

## 1. newserv (fuzziqersoftware/newserv): MIT

https://github.com/fuzziqersoftware/newserv

- **Servidor** usado pelo projeto. É compilado em `vendor/` por `scripts/setup-newserv.sh`.
- **Especificação:** `src/CommandFormats.hh` (comandos), `src/PSOEncryption.cc` (cifras), `src/Compression.cc` (PRS), `src/GSLArchive.cc` e `src/AFSArchive.cc`, `src/Map.cc` (mapas).
- **Oráculo de testes:** a CLI (`encrypt-data`, `decompress-prs`, `extract-gsl`...) gera as saídas esperadas para os testes em `tests/oracle.test.ts`.
- **Código portado:** `BBCrypt`, `prsDecompress`, `GSLArchive` e `AFSArchive`. Cada arquivo cita a origem. O MIT permite o porte desde que o aviso seja mantido.

## 2. original-psobb-client-source (gitlab.psobb.io)

https://gitlab.psobb.io/psobb/original-psobb-client-source

Dump Ghidra do `psobb.exe`, acompanhado de headers e notas curadas pela comunidade:
- `headers/network.h`: formatos dos subcomandos 6x (movimento `6x40/42/3E`, ataques `6x43-45`...)
- `notes/quest_opcodes_*.md`: semântica dos opcodes de quest
- `notes/_wiki_combat_formulas.md`, `notes/_wiki_item_tables.md`
- `headers/rendering.h`: mapeamento da renderização

Esse repositório é usado como **especificação**. O pseudo-código do Ghidra não é copiado.

## 3. Decompilação matching do PsoBB.exe (repositório privado)

Decompilação que gera código C byte a byte idêntico ao binário original, compilado com o mesmo VC7.1. A meta declarada é recuperar a lógica de jogo legível para um porte. Uso aqui:
- **Fonte de verdade da lógica de jogo:** regras, máquinas de estado, entidades e matemática do ninja/shinobi.
- **Só como referência.** O README do projeto diz que ele é privado e inclui o binário da Sega e o toolchain proprietário, então **nada dele é copiado ou linkado neste repositório público**.

## Outras

- **Tethealla** (servidor antigo, GPL-3): os arquivos `map/`, `quest/` e `drop/` da pasta original têm os mesmos formatos de dados.
- **Ephinea PSOBB client:** a fonte dos arquivos `data/` usados localmente nos testes. Não é versionado.
