# Notas legais

- **Phantasy Star Online** e todos os assets do jogo (modelos, texturas, sons, textos e executáveis) pertencem à SEGA. Este repositório **não contém nem distribui** nenhum desses arquivos. O `.gitignore` bloqueia as extensões do cliente (`.gsl`, `.afs`, `.xvm`, `.nj`, `.xj`, `.rel`, `.prs`, `.exe`).
- O cliente web lê os arquivos da **instalação do próprio usuário**, localmente no navegador.
- O código portado do **newserv** segue a licença MIT, e cada arquivo indica a origem.
- As decompilações são usadas como **referência de comportamento** para interoperabilidade. Nenhum pseudo-código ou binário delas é copiado para cá.
- **Não exponha o newserv nem a ponte na internet sem revisar a segurança:**
  - A API HTTP do newserv tem `POST /y/shell-exec`.
  - A ponte precisa da allowlist de portas.
