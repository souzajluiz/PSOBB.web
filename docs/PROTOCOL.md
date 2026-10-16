# Protocolo e formatos

Notas verificadas na prática contra o newserv. A fonte primária é `newserv/src/CommandFormats.hh`.

## Cabeçalho de comando BB

```
u16 size     tamanho total, incluindo o cabeçalho e excluindo o padding
u16 command
u32 flag
```

- **Comandos cifrados** levam padding com zeros até múltiplo de 8 bytes.
- **O `03` inicial (texto claro) chega sem padding.** O newserv mandou 380 bytes para `size = 0x17C`. Um leitor que espera `(size + 7) & ~7` trava aqui. Foi o primeiro bug encontrado.

## Handshake de login (porta 12000, `bb-data1`)

| # | Direção | Cmd | Conteúdo |
|---|---|---|---|
| 1 | S→C | `03` | `copyright[0x60]`, `server_key[0x30]`, `client_key[0x30]` (+ mensagem extra do newserv). Texto claro. |
| 2 | C→S | `93` | Login (`C_LoginWithoutHardwareInfo_BB_93`, 0xA4 bytes): `player_tag`, `guild_card_number`, `sub_version`, `language`, `character_slot`, `connection_phase`, `security_token`, `username[0x30]`, `password[0x30]`, `menu_id`, `preferred_lobby_id`, `client_config[0x28]` |
| 3 | S→C | `E6` | `error_code`, `player_tag`, `guild_card_number`, `security_token`, `client_config`... (0 = OK) |
| 4 | S→C | `19` | Redirecionamento (IP + porta) para a próxima fase |

A partir do `03`, as duas direções são cifradas:
- **S→C** com `BBCrypt(nsk, server_key)`
- **C→S** com `BBCrypt(nsk, client_key)`

## Cifra BB

Implementação em `client/src/net/bbcrypt.ts`, portada de `PSOBBEncryption` do newserv.

- **Arquivo de chave `.nsk`** (0x1050 bytes): `initial_keys[0x48]`, `private_keys[0x1000]` e `subtype` (u64).
- **Subtipo suportado:** `STANDARD` (0). O newserv aceita várias chaves e detecta qual o cliente usou decifrando os 8 primeiros bytes e comparando com `B4 00 93 00 00 00 00 00`.
- **Seed:** cada byte é XOR com `19 16 18` em ciclo, seguido do key schedule estilo Blowfish.
- **Sem estado entre blocos de 8 bytes.** Por isso dá pra decifrar o cabeçalho antes do corpo.

## PRS

LZ77 com stream de controle bit a bit intercalado ao stream de dados. Implementação em `client/src/formats/prs.ts`, comentários completos em `newserv/src/Compression.cc`.

Nem todo `.prs` é PRS puro: `chatsensor.prs` é rejeitado pelo newserv e também pelo porte, e o teste verifica isso.

## GSL

Tabela de entradas de 0x30 bytes (`name[0x20]`, `u32 page`, `u32 size`, `u64`), terminada por nome vazio. O offset está em páginas de 0x800 bytes. O `data.gsl` do Ephinea tem 1524 arquivos: `.dat` de mapas (inimigos e objetos), `.bml`, `.xvm`, `.evt`, `.rel`...

## AFS

`'AFS\0'`, `u32 count`, depois `{u32 offset, u32 size}` por arquivo.

## Onde estão os mapas no cliente

- `data/scene/map_<área>n.rel`: geometria de render
- `data/scene/map_<área>c.rel`: colisão
- `data/scene/map_<área>.xvm`: texturas
- `data.gsl` → `map_<área>_NNe.dat` / `o.dat`: inimigos e objetos (mesmo formato dos `map/` do Tethealla)
