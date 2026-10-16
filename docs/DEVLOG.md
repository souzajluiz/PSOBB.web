# Devlog

## 2026-10-16: fundação

**Ponto de partida:** a pasta `psobb-master` era o servidor Tethealla de 2015 (só binários Windows e dados de servidor), sem cliente. O plano foi trocar o servidor pelo newserv e reimplementar o cliente para o navegador.

**Ambiente:**
- **MCP REA:** falhava porque o Node padrão era o v16 e o `rea-agents@6.4.0` exige ≥ 22.19. Corrigido apontando a config do MCP para o Node v24.18.
- **newserv:** `phosg`, `resource_dasm` e `newserv` compilados em `vendor/` com prefixo local, sem instalar nada no sistema (fora `brew install asio libiconv`).
- **Cliente:** o instalador Ephinea foi extraído com `7zz`, sem executar. Os mapas ficam em `data/scene/` e os `.dat` de spawn em `data.gsl`.

**Portes para TS, todos validados contra a CLI do newserv:**
- `BBCrypt`: a saída cifrada bate byte a byte com `newserv encrypt-data --bb` (chaves `default` e `default4`).
- `prsDecompress`: 19 arquivos reais idênticos. `chatsensor.prs` é rejeitado tanto pelo newserv quanto pelo porte.
- `GSLArchive`: 1524 entradas, o mesmo número do `newserv extract-gsl`. Conteúdo idêntico.

**Login ao vivo pela ponte:**
- **Bug 1, condição de corrida:** o `03` chegava antes do `BBConnection` registrar o handler. O transporte agora guarda os dados que chegam cedo.
- **Bug 2, framing:** o `03` em texto claro vem sem padding até 8 bytes. Só comandos cifrados têm padding.
- **Resultado:** `E6 error_code=0` e depois `19` (redirecionamento). Login OK.
