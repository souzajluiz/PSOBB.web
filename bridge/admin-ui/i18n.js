// PSOBB.web admin panel: translations (docs/ADMIN.md, "Languages").
//
// English is the source language. Translation is a lookup by the exact English
// source string, so admin.js keeps its English literals and only a few central
// places call tr() (the h() helper, toast, table empty text, confirmDialog,
// document.title). A string with no entry falls back to English, which means
// text added to the panel later keeps working untranslated until it is added here.
//
// Not translated on purpose: text the person must type to confirm (account id /
// config key), account and file names, config keys, newserv command names, quest
// names, class / section id / technique names (they come from the server data),
// and anything inside an element with the `mono` class (see admin.js h()).
//
// No browser-only API is used at import time without a guard, so the module can
// be imported by the Node tests (tests/admin.i18n.test.ts).

export const LANGS = [
  { code: 'en', label: 'English', htmlLang: 'en' },
  { code: 'pt-BR', label: 'Português (Brasil)', htmlLang: 'pt-BR' },
  { code: 'es', label: 'Español', htmlLang: 'es' },
];
const CODES = LANGS.map((l) => l.code);
const STORAGE_KEY = 'psobb-admin-lang';

// [English, pt-BR, es]. The English text must match the literal in admin.js /
// admin.mjs exactly (including a trailing space where the code has one).
export const DICT = [
  // shell, login, tabs
  ['Language', 'Idioma', 'Idioma'],
  ['PSOBB.web Admin', 'Administração do PSOBB.web', 'Administración de PSOBB.web'],
  ['Username', 'Usuário', 'Usuario'],
  ['Password', 'Senha', 'Contraseña'],
  ['Log in', 'Entrar', 'Iniciar sesión'],
  ['Log out', 'Sair', 'Cerrar sesión'],
  ['Show password', 'Mostrar senha', 'Mostrar contraseña'],
  ['Hide password', 'Ocultar senha', 'Ocultar contraseña'],
  ['Dashboard', 'Painel', 'Panel'],
  ['Accounts', 'Contas', 'Cuentas'],
  ['Characters', 'Personagens', 'Personajes'],
  ['Online', 'Conectados', 'En línea'],
  ['Quests', 'Missões', 'Misiones'],
  ['Teams', 'Equipes', 'Equipos'],
  ['Data', 'Dados', 'Datos'],
  ['Config', 'Configuração', 'Configuración'],
  ['Audit log', 'Registro de auditoria', 'Registro de auditoría'],
  ['Loading...', 'Carregando...', 'Cargando...'],
  ['Could not load this tab.', 'Não foi possível carregar esta aba.', 'No se pudo cargar esta pestaña.'],
  ['Nothing to show.', 'Nada para mostrar.', 'Nada que mostrar.'],
  ['Session expired: log in again', 'Sessão expirada: entre novamente', 'Sesión expirada: inicia sesión de nuevo'],

  // confirmation dialog
  ['Confirm', 'Confirmar', 'Confirmar'],
  ['Cancel', 'Cancelar', 'Cancelar'],
  ['confirmation text', 'texto de confirmação', 'texto de confirmación'],
  ['Type ', 'Digite ', 'Escribe '],
  [' to confirm.', ' para confirmar.', ' para confirmar.'],

  // table headers and cells
  ['ID', 'ID', 'ID'],
  ['Account', 'Conta', 'Cuenta'],
  ['Name', 'Nome', 'Nombre'],
  ['Level', 'Nível', 'Nivel'],
  ['Class', 'Classe', 'Clase'],
  ['Section', 'Section ID', 'Section ID'],
  ['Version', 'Versão', 'Versión'],
  ['Lobby', 'Lobby', 'Lobby'],
  ['Players', 'Jogadores', 'Jugadores'],
  ['Episode', 'Episódio', 'Episodio'],
  ['Mode', 'Modo', 'Modo'],
  ['Difficulty', 'Dificuldade', 'Dificultad'],
  ['Quest', 'Missão', 'Misión'],
  ['Cheats', 'Cheats', 'Cheats'],
  ['yes', 'sim', 'sí'],
  ['no', 'não', 'no'],

  // dashboard
  ['Server', 'Servidor', 'Servidor'],
  ['Uptime', 'Tempo ativo', 'Tiempo activo'],
  ['Players online', 'Jogadores online', 'Jugadores en línea'],
  ['Games', 'Jogos', 'Partidas'],
  ['Lobbies', 'Lobbies', 'Lobbies'],
  ['Banned', 'Banidos', 'Baneados'],
  ['Admin sessions', 'Sessões de admin', 'Sesiones de admin'],
  ['Connected players', 'Jogadores conectados', 'Jugadores conectados'],
  ['Nobody is online.', 'Ninguém está online.', 'Nadie está en línea.'],
  ['No games.', 'Nenhum jogo.', 'No hay partidas.'],
  ['Refreshes every 10 seconds.', 'Atualiza a cada 10 segundos.', 'Se actualiza cada 10 segundos.'],

  // accounts
  ['BB username', 'Usuário BB', 'Usuario BB'],
  ['Password (1-16)', 'Senha (1-16)', 'Contraseña (1-16)'],
  ['Create account', 'Criar conta', 'Crear cuenta'],
  ['Create', 'Criar', 'Crear'],
  ['Permission flags (optional)', 'Flags de permissão (opcional)', 'Flags de permiso (opcional)'],
  ['Username: letters, digits, _ . - (16 max). Password: 16 characters max, no spaces or quotes.',
    'Usuário: letras, dígitos, _ . - (máx. 16). Senha: máx. 16 caracteres, sem espaços nem aspas.',
    'Usuario: letras, dígitos, _ . - (máx. 16). Contraseña: máx. 16 caracteres, sin espacios ni comillas.'],
  ['no BB license', 'sem licença BB', 'sin licencia BB'],
  ['online', 'online', 'en línea'],
  ['Last character', 'Último personagem', 'Último personaje'],
  ['Status', 'Status', 'Estado'],
  ['Actions', 'Ações', 'Acciones'],
  ['Flags', 'Flags', 'Flags'],
  ['Unban', 'Desbanir', 'Desbanear'],
  ['Unbanned', 'Banimento removido', 'Baneo eliminado'],
  ['Ban', 'Banir', 'Banear'],
  ['Kick', 'Expulsar', 'Expulsar'],
  ['Delete', 'Excluir', 'Eliminar'],
  ['No accounts yet.', 'Nenhuma conta ainda.', 'Aún no hay cuentas.'],
  ['Passwords are never shown. Other license types (DC, PC, GC, XB) are not managed here.',
    'As senhas nunca são exibidas. Outros tipos de licença (DC, PC, GC, XB) não são gerenciados aqui.',
    'Las contraseñas nunca se muestran. Los otros tipos de licencia (DC, PC, GC, XB) no se administran aquí.'],
  ['MODERATOR, ADMINISTRATOR and ROOT are presets that include the flags above them (ROOT = everything).',
    'MODERATOR, ADMINISTRATOR e ROOT são predefinições que incluem as flags acima delas (ROOT = tudo).',
    'MODERATOR, ADMINISTRATOR y ROOT son preajustes que incluyen las flags anteriores (ROOT = todo).'],
  ['Save', 'Salvar', 'Guardar'],
  ['no flags', 'nenhuma flag', 'ninguna flag'],
  ['Change permission flags', 'Alterar flags de permissão', 'Cambiar flags de permiso'],
  ['Flags updated', 'Flags atualizadas', 'Flags actualizadas'],
  ['The BB license is removed and added again with the new password.',
    'A licença BB é removida e adicionada novamente com a nova senha.',
    'La licencia BB se elimina y se vuelve a agregar con la nueva contraseña.'],
  ['Change', 'Alterar', 'Cambiar'],
  ['Password changed', 'Senha alterada', 'Contraseña cambiada'],
  ['Duration: ', 'Duração: ', 'Duración: '],
  ['30m', '30 min', '30 min'],
  ['12h', '12 h', '12 h'],
  ['1d', '1 dia', '1 día'],
  ['3d', '3 dias', '3 días'],
  ['1w', '1 semana', '1 semana'],
  ['1mo', '1 mês', '1 mes'],
  ['1y', '1 ano', '1 año'],
  ['permanent', 'permanente', 'permanente'],
  ['A connected player is disconnected at once.', 'Um jogador conectado é desconectado imediatamente.', 'Un jugador conectado se desconecta de inmediato.'],
  ['Ban account', 'Banir conta', 'Banear cuenta'],
  ['Delete account', 'Excluir conta', 'Eliminar cuenta'],
  ['Account deleted', 'Conta excluída', 'Cuenta eliminada'],
  ['Kick player', 'Expulsar jogador', 'Expulsar jugador'],
  ['Kicked', 'Jogador expulso', 'Jugador expulsado'],

  // characters
  ['Select an account...', 'Selecione uma conta...', 'Selecciona una cuenta...'],
  ['Account: ', 'Conta: ', 'Cuenta: '],
  ['This account is online. Characters can only be edited while it is offline: kick the player first.',
    'Esta conta está online. Os personagens só podem ser editados com a conta offline: expulse o jogador antes.',
    'Esta cuenta está en línea. Los personajes solo se pueden editar con la cuenta desconectada: expulsa primero al jugador.'],
  ['Shared bank', 'Banco compartilhado', 'Banco compartido'],
  ['Slot', 'Slot', 'Ranura'],
  ['EXP', 'EXP', 'EXP'],
  ['Meseta', 'Meseta', 'Meseta'],
  ['Items', 'Itens', 'Ítems'],
  ['Open', 'Abrir', 'Abrir'],
  ['No character files found for this username.', 'Nenhum arquivo de personagem encontrado para este usuário.', 'No se encontraron archivos de personaje para este usuario.'],
  ['Section ID', 'Section ID', 'Section ID'],
  ['Stats', 'Atributos', 'Atributos'],
  ['Technique levels (0 = none)', 'Níveis de técnicas (0 = nenhuma)', 'Niveles de técnicas (0 = ninguna)'],
  ['0 = not learned', '0 = não aprendida', '0 = no aprendida'],
  ['equipped', 'equipado', 'equipado'],
  ['remove', 'remover', 'quitar'],
  ['Kind', 'Tipo', 'Tipo'],
  ['Empty.', 'Vazio.', 'Vacío.'],
  ['data1 (24 hex)', 'data1 (24 hex)', 'data1 (24 hex)'],
  ['data2 (8 hex)', 'data2 (8 hex)', 'data2 (8 hex)'],
  ['Save changes...', 'Salvar alterações...', 'Guardar cambios...'],
  ['Account is online.', 'A conta está online.', 'La cuenta está en línea.'],
  ['(unnamed)', '(sem nome)', '(sin nombre)'],
  ['Nothing changed', 'Nada foi alterado', 'No hay cambios'],
  ['The character file is changed on disk after a backup copy. The account must stay offline until it is saved.',
    'O arquivo do personagem é alterado no disco após uma cópia de backup. A conta deve ficar offline até salvar.',
    'El archivo del personaje se modifica en disco tras una copia de seguridad. La cuenta debe seguir desconectada hasta guardar.'],
  ['Save changes', 'Salvar alterações', 'Guardar cambios'],
  ['Bank', 'Banco', 'Banco'],
  ['Edit bank...', 'Editar banco...', 'Editar banco...'],
  ['Amount', 'Quantidade', 'Cantidad'],
  ['The bank file is rewritten after a backup copy.', 'O arquivo do banco é reescrito após uma cópia de backup.', 'El archivo del banco se reescribe tras una copia de seguridad.'],
  ['Save bank', 'Salvar banco', 'Guardar banco'],
  ['Save bank...', 'Salvar banco...', 'Guardar banco...'],

  // character editor: level, techniques, item picker, mag editor
  ['Changing the level or class recomputes EXP (the threshold of that level) and the base stats of the class from newserv\'s level table; used materials stay on top. You can still adjust a value by hand after that.',
    'Mudar o nível ou a classe recalcula o EXP (o mínimo daquele nível) e os atributos base da classe pela tabela de níveis do newserv; os materiais usados continuam somados. Depois disso ainda dá para ajustar um valor à mão.',
    'Cambiar el nivel o la clase recalcula el EXP (el mínimo de ese nivel) y los atributos base de la clase con la tabla de niveles de newserv; los materiales usados se siguen sumando. Después aún puedes ajustar un valor a mano.'],
  ['Level table not found on the server: the level is written alone (EXP and stats are not recomputed).',
    'Tabela de níveis não encontrada no servidor: só o nível é gravado (EXP e atributos não são recalculados).',
    'No se encontró la tabla de niveles en el servidor: solo se escribe el nivel (EXP y atributos no se recalculan).'],
  ['This class cannot learn techniques.', 'Esta classe não aprende técnicas.', 'Esta clase no aprende técnicas.'],
  ['Item', 'Item', 'Ítem'],
  ['Give items', 'Dar itens', 'Dar ítems'],
  ['Item kind', 'Tipo de item', 'Tipo de ítem'],
  ['Weapon', 'Arma', 'Arma'],
  ['Armor', 'Armadura', 'Armadura'],
  ['Shield', 'Escudo', 'Escudo'],
  ['Unit', 'Unidade', 'Unidad'],
  ['Mag', 'Mag', 'Mag'],
  ['Tool', 'Ferramenta', 'Herramienta'],
  ['Technique disk', 'Disco de técnica', 'Disco de técnica'],
  ['Search by name', 'Buscar pelo nome', 'Buscar por nombre'],
  ['Special', 'Especial', 'Especial'],
  ['Attribute', 'Atributo', 'Atributo'],
  ['Percent', 'Porcentagem', 'Porcentaje'],
  ['(none)', '(nenhum)', '(ninguno)'],
  ['Grind', 'Grind', 'Grind'],
  ['Grind (max from the item table)', 'Grind (máximo da tabela de itens)', 'Grind (máximo de la tabla de ítems)'],
  ['Slots', 'Slots', 'Ranuras'],
  ['DFP bonus', 'Bônus de DFP', 'Bono de DFP'],
  ['EVP bonus', 'Bônus de EVP', 'Bono de EVP'],
  ['Modifier', 'Modificador', 'Modificador'],
  ['(normal)', '(normal)', '(normal)'],
  ['Count', 'Quantidade', 'Cantidad'],
  ['Technique', 'Técnica', 'Técnica'],
  ['A new mag starts as newserv makes one (DEF 5, synchro 40); edit it with "Edit mag" after saving.',
    'Um mag novo começa como o newserv cria (DEF 5, synchro 40); edite-o com "Editar mag" depois de salvar.',
    'Un mag nuevo empieza como lo crea newserv (DEF 5, synchro 40); edítalo con "Editar mag" después de guardar.'],
  ['Pick an item first', 'Escolha um item primeiro', 'Elige un ítem primero'],
  ['Add to list', 'Adicionar à lista', 'Agregar a la lista'],
  ['Remove', 'Remover', 'Quitar'],
  ['To add when saving:', 'Para adicionar ao salvar:', 'Para agregar al guardar:'],
  ['Advanced: raw item bytes', 'Avançado: bytes brutos do item', 'Avanzado: bytes sin procesar del ítem'],
  ['Raw items: data1 is the 12 item bytes, data2 the 4 trailing bytes. They are not checked against the item tables; wrong data can make the client reject the character.',
    'Itens brutos: data1 são os 12 bytes do item e data2 os 4 bytes finais. Eles não são conferidos com as tabelas de itens; dados incorretos podem fazer o cliente rejeitar o personagem.',
    'Ítems sin procesar: data1 son los 12 bytes del ítem y data2 los 4 bytes finales. No se comprueban con las tablas de ítems; datos incorrectos pueden hacer que el cliente rechace al personaje.'],
  ['Item names not found on the server (newserv system/tables/names-v4.json): only raw items can be added.',
    'Nomes de itens não encontrados no servidor (newserv system/tables/names-v4.json): só itens brutos podem ser adicionados.',
    'No se encontraron nombres de ítems en el servidor (newserv system/tables/names-v4.json): solo se pueden agregar ítems sin procesar.'],
  ['data1 must be 24 hex digits and data2 8', 'data1 deve ter 24 dígitos hex e data2 8', 'data1 debe tener 24 dígitos hex y data2 8'],
  ['Edit mag', 'Editar mag', 'Editar mag'],
  ['Keep mag changes', 'Manter alterações do mag', 'Conservar cambios del mag'],
  ['Close', 'Fechar', 'Cerrar'],
  ['A mag being edited is also marked for removal', 'Um mag em edição também está marcado para remoção', 'Un mag en edición también está marcado para quitar'],
  ['Mag type', 'Tipo de mag', 'Tipo de mag'],
  ['Synchro (0-120)', 'Synchro (0-120)', 'Synchro (0-120)'],
  ['IQ (0-200)', 'IQ (0-200)', 'IQ (0-200)'],
  ['Colour', 'Cor', 'Color'],
  ['Synchro', 'Synchro', 'Synchro'],
  ['charClass must be 0-11', 'charClass deve ser de 0 a 11', 'charClass debe ser de 0 a 11'],
  ['Level (DEF + POW + DEX + MIND, max 200): ', 'Nível (DEF + POW + DEX + MIND, máx. 200): ', 'Nivel (DEF + POW + DEX + MIND, máx. 200): '],
  ['. Progress is kept in steps of 2 (newserv stores it that way).', '. O progresso é guardado em passos de 2 (o newserv grava assim).', '. El progreso se guarda en pasos de 2 (newserv lo guarda así).'],
  ['Photon blast slots fill in order: center, then right, then left; each blast once.',
    'Os slots de photon blast são preenchidos em ordem: centro, depois direita, depois esquerda; cada blast uma vez.',
    'Las ranuras de photon blast se llenan en orden: centro, luego derecha, luego izquierda; cada blast una vez.'],

  // online
  ['Announcement to all players', 'Anúncio para todos os jogadores', 'Anuncio para todos los jugadores'],
  ['Announcement', 'Anúncio', 'Anuncio'],
  ['Send', 'Enviar', 'Enviar'],
  ['Announcement sent', 'Anúncio enviado', 'Anuncio enviado'],
  ['Printable ASCII only, no quotes, backslash or ; | & < >. newserv can only announce to everyone; there is no per-player message command.',
    'Somente ASCII imprimível, sem aspas, barra invertida nem ; | & < >. O newserv só consegue anunciar para todos; não existe comando de mensagem para um jogador específico.',
    'Solo ASCII imprimible, sin comillas, barra invertida ni ; | & < >. newserv solo puede anunciar a todos; no existe un comando de mensaje por jugador.'],
  ['Client', 'Cliente', 'Cliente'],
  ['Address', 'Endereço', 'Dirección'],

  // quests
  ['Open in editor', 'Abrir no editor', 'Abrir en el editor'],
  ['no BB file', 'sem arquivo BB', 'sin archivo BB'],
  ['New quest (editor)', 'Nova missão (editor)', 'Nueva misión (editor)'],
  ['Reload quests', 'Recarregar missões', 'Recargar misiones'],
  ['Quests reloaded', 'Missões recarregadas', 'Misiones recargadas'],
  ['listed in menus', 'listada nos menus', 'listada en los menús'],
  ['hidden', 'oculta', 'oculta'],
  ['Enabled when', 'Habilitada quando', 'Habilitada cuando'],
  ['Drops', 'Drops', 'Drops'],
  ['Versions', 'Versões', 'Versiones'],
  ['always', 'sempre', 'siempre'],
  ['No quests.', 'Nenhuma missão.', 'No hay misiones.'],

  // teams
  ['Members', 'Membros', 'Miembros'],
  ['Points', 'Pontos', 'Puntos'],
  ['Spent points', 'Pontos gastos', 'Puntos gastados'],
  ['No teams.', 'Nenhuma equipe.', 'No hay equipos.'],
  ['newserv has no team commands: teams are read-only here. After editing team files by hand, reload them.',
    'O newserv não tem comandos de equipe: aqui as equipes são somente leitura. Depois de editar os arquivos de equipe manualmente, recarregue-os.',
    'newserv no tiene comandos de equipo: aquí los equipos son de solo lectura. Después de editar los archivos de equipo a mano, recárgalos.'],
  ['Reload teams', 'Recarregar equipes', 'Recargar equipos'],
  ['Teams reloaded', 'Equipes recarregadas', 'Equipos recargados'],
  ['Raw team data', 'Dados brutos das equipes', 'Datos sin procesar de los equipos'],

  // data
  ['Common item tables (list)', 'Tabelas de itens comuns (lista)', 'Tablas de ítems comunes (lista)'],
  ['Rare drop tables (list)', 'Tabelas de drops raros (lista)', 'Tablas de drops raros (lista)'],
  ['Tekker table', 'Tabela do Tekker', 'Tabla del Tekker'],
  ['Armor shop', 'Loja de armaduras', 'Tienda de armaduras'],
  ['Tool shop', 'Loja de ferramentas', 'Tienda de herramientas'],
  ['Weapon shop (Normal)', 'Loja de armas (Normal)', 'Tienda de armas (Normal)'],
  ['Weapon shop (Hard)', 'Loja de armas (Hard)', 'Tienda de armas (Hard)'],
  ['Weapon shop (Very Hard)', 'Loja de armas (Very Hard)', 'Tienda de armas (Very Hard)'],
  ['Weapon shop (Ultimate)', 'Loja de armas (Ultimate)', 'Tienda de armas (Ultimate)'],
  ['Level table (BB)', 'Tabela de níveis (BB)', 'Tabla de niveles (BB)'],
  ['Mag table (BB)', 'Tabela de Mag (BB)', 'Tabla de Mag (BB)'],
  ['Stack limits (BB)', 'Limites de pilha (BB)', 'Límites de pila (BB)'],
  ['or a path such as rare-table/rare-table-v4', 'ou um caminho como rare-table/rare-table-v4', 'o una ruta como rare-table/rare-table-v4'],
  ['Choose a table.', 'Escolha uma tabela.', 'Elige una tabla.'],
  ['Server data tables', 'Tabelas de dados do servidor', 'Tablas de datos del servidor'],
  ['Read-only views of newserv tables. Drop rates and EXP are changed in Config; the tables themselves are files on the server (reload them from here).',
    'Visualizações somente leitura das tabelas do newserv. As taxas de drop e a EXP são alteradas em Configuração; as tabelas em si são arquivos no servidor (recarregue-as por aqui).',
    'Vistas de solo lectura de las tablas de newserv. Las tasas de drop y la EXP se cambian en Configuración; las tablas son archivos en el servidor (recárgalas desde aquí).'],
  ['Show', 'Mostrar', 'Mostrar'],
  ['Show path', 'Mostrar caminho', 'Mostrar ruta'],
  ['Reload tables', 'Recarregar tabelas', 'Recargar tablas'],
  ['Reloaded drop tables, level tables and item definitions',
    'Tabelas de drop, tabelas de nível e definições de itens recarregadas',
    'Tablas de drop, tablas de nivel y definiciones de ítems recargadas'],

  // config
  ['Key', 'Chave', 'Clave'],
  ['Value', 'Valor', 'Valor'],
  ['Note', 'Nota', 'Nota'],
  ['Apply...', 'Aplicar...', 'Aplicar...'],
  ['Apply', 'Aplicar', 'Aplicar'],
  ['Editable settings', 'Configurações editáveis', 'Ajustes editables'],
  ['Only these keys can be changed from the panel. Everything else (ports, addresses, drop tables, item lists) is edited in config.json on the server.',
    'Somente estas chaves podem ser alteradas pelo painel. O resto (portas, endereços, tabelas de drop, listas de itens) é editado no config.json do servidor.',
    'Solo estas claves se pueden cambiar desde el panel. Todo lo demás (puertos, direcciones, tablas de drop, listas de ítems) se edita en config.json en el servidor.'],
  ['Effective configuration (read-only)', 'Configuração efetiva (somente leitura)', 'Configuración efectiva (solo lectura)'],

  // audit
  ['Refresh', 'Atualizar', 'Actualizar'],
  ['Time (UTC)', 'Hora (UTC)', 'Hora (UTC)'],
  ['Who', 'Quem', 'Quién'],
  ['Action', 'Ação', 'Acción'],
  ['Detail', 'Detalhe', 'Detalle'],
  ['Result', 'Resultado', 'Resultado'],
  ['No entries.', 'Nenhuma entrada.', 'No hay entradas.'],

  // server messages (bridge/admin.mjs, bridge/admin-chars.mjs)
  ['wrong username or password', 'usuário ou senha incorretos', 'usuario o contraseña incorrectos'],
  ['too many failed logins; try again later', 'muitas tentativas de login falhas; tente novamente mais tarde', 'demasiados intentos de inicio de sesión fallidos; vuelve a intentarlo más tarde'],
  ['HTTPS is required for the admin login (set ADMIN_TRUST_PROXY=1 behind a TLS proxy)',
    'É necessário HTTPS para o login de administração (defina ADMIN_TRUST_PROXY=1 atrás de um proxy TLS)',
    'Se requiere HTTPS para el inicio de sesión de administración (define ADMIN_TRUST_PROXY=1 detrás de un proxy TLS)'],
  ['newserv is not reachable (is HTTPListen set in its config.json?)',
    'newserv inacessível (HTTPListen está definido no config.json dele?)',
    'No se puede conectar con newserv (¿está definido HTTPListen en su config.json?)'],
  ['newserv is not reachable', 'newserv inacessível', 'No se puede conectar con newserv'],
  ['login required', 'login necessário', 'se requiere iniciar sesión'],
  ['bad CSRF token', 'token CSRF inválido', 'token CSRF no válido'],
  ['bad Origin', 'Origin inválido', 'Origin no válido'],
  ['Origin header required', 'cabeçalho Origin obrigatório', 'se requiere el encabezado Origin'],
  ['origin does not match host', 'a origem não corresponde ao host', 'el origen no coincide con el host'],
  ['origin not allowed', 'origem não permitida', 'origen no permitido'],
  ['cross-site request refused', 'requisição entre sites recusada', 'solicitud entre sitios rechazada'],
  ['Content-Type must be application/json', 'Content-Type deve ser application/json', 'Content-Type debe ser application/json'],
  ['body too large', 'corpo da requisição grande demais', 'cuerpo de la solicitud demasiado grande'],
  ['invalid JSON', 'JSON inválido', 'JSON no válido'],
  ['request aborted', 'requisição abortada', 'solicitud cancelada'],
  ['not found', 'não encontrado', 'no encontrado'],
  ['method not allowed', 'método não permitido', 'método no permitido'],
  ['bad url', 'URL inválida', 'URL no válida'],
  ['internal error', 'erro interno', 'error interno'],
  ['unknown data table', 'tabela de dados desconhecida', 'tabla de datos desconocida'],
  ['account not found', 'conta não encontrada', 'cuenta no encontrada'],
  ['invalid account id', 'ID de conta inválido', 'ID de cuenta no válido'],
  ['invalid clientId', 'clientId inválido', 'clientId no válido'],
  ['command rejected by the input filter', 'comando rejeitado pelo filtro de entrada', 'comando rechazado por el filtro de entrada'],
  ['config.json not found', 'config.json não encontrado', 'config.json no encontrado'],
  ['could not read the current license', 'não foi possível ler a licença atual', 'no se pudo leer la licencia actual'],
  ['duration must look like 30m, 12h, 3d, 2w, 1mo, 1y or permanent',
    'a duração deve ser como 30m, 12h, 3d, 2w, 1mo, 1y ou permanent',
    'la duración debe ser como 30m, 12h, 3d, 2w, 1mo, 1y o permanent'],
  ['flag names must be strings', 'os nomes das flags devem ser textos', 'los nombres de las flags deben ser cadenas de texto'],
  ['flags must be a list of names', 'flags deve ser uma lista de nomes', 'flags debe ser una lista de nombres'],
  ['items must be a list', 'items deve ser uma lista', 'items debe ser una lista'],
  ['message must be 1-200 characters', 'a mensagem deve ter de 1 a 200 caracteres', 'el mensaje debe tener de 1 a 200 caracteres'],
  ['newserv did not report the new account id', 'o newserv não informou o ID da nova conta', 'newserv no informó el ID de la nueva cuenta'],
  ['nothing to change', 'nada para alterar', 'nada que cambiar'],
  ['that BB username already exists', 'este usuário BB já existe', 'ese usuario BB ya existe'],
  ['the account has no BB license', 'a conta não tem licença BB', 'la cuenta no tiene licencia BB'],
  ['the account is online: kick the player first (characters are edited offline only)',
    'a conta está online: expulse o jogador antes (os personagens só são editados offline)',
    'la cuenta está en línea: expulsa primero al jugador (los personajes solo se editan sin conexión)'],
  ['this key cannot be changed from the panel', 'esta chave não pode ser alterada pelo painel', 'esta clave no se puede cambiar desde el panel'],
  ['username is not a BB license of this account', 'o usuário não é uma licença BB desta conta', 'el usuario no es una licencia BB de esta cuenta'],
  ['maximum 16 characters', 'máximo de 16 caracteres', 'máximo 16 caracteres'],
  ['shown to GameCube players only', 'exibida somente para jogadores de GameCube', 'se muestra solo a los jugadores de GameCube'],
  ['true lets anyone create an account by logging in', 'true permite que qualquer pessoa crie uma conta ao fazer login', 'true permite que cualquiera cree una cuenta al iniciar sesión'],
  ['the account has several BB licenses; pass username', 'a conta tem várias licenças BB; informe o usuário', 'la cuenta tiene varias licencias BB; indica el usuario'],
  ['message may use printable ASCII only, without quotes, backslash, ; | & < >',
    'a mensagem só pode usar ASCII imprimível, sem aspas, barra invertida, ; | & < >',
    'el mensaje solo puede usar ASCII imprimible, sin comillas, barra invertida, ; | & < >'],
  ['bad path', 'caminho inválido', 'ruta no válida'],
  ['unsupported BB username for file access', 'usuário BB sem suporte para acesso a arquivos', 'usuario BB no admitido para el acceso a archivos'],
  ['character slot must be 0-15', 'o slot do personagem deve ser de 0 a 15', 'la ranura del personaje debe ser de 0 a 15'],
  ['character file not found', 'arquivo de personagem não encontrado', 'archivo de personaje no encontrado'],
  ['character file has an unexpected size', 'o arquivo de personagem tem um tamanho inesperado', 'el archivo de personaje tiene un tamaño inesperado'],
  ['not a BB character file', 'não é um arquivo de personagem BB', 'no es un archivo de personaje BB'],
  ['patch object expected', 'objeto de alterações esperado', 'se esperaba un objeto de cambios'],
  ['stats must be an object', 'stats deve ser um objeto', 'stats debe ser un objeto'],
  ['techniques must be an object', 'techniques deve ser um objeto', 'techniques debe ser un objeto'],
  ['inventory must be an object', 'inventory deve ser um objeto', 'inventory debe ser un objeto'],
  ['inventory is full (30 items)', 'o inventário está cheio (30 itens)', 'el inventario está lleno (30 ítems)'],
  ['bank is full (200 items)', 'o banco está cheio (200 itens)', 'el banco está lleno (200 ítems)'],
  ['bank file is truncated', 'o arquivo do banco está truncado', 'el archivo del banco está truncado'],
  ['bank file is malformed', 'o arquivo do banco está malformado', 'el archivo del banco está mal formado'],
];

// [regex source, pt-BR template, es template]. $1 inserts the capture as is,
// $t1 inserts it translated (tr), for captures that may themselves be a known
// string (for example "no BB license"). Patterns run in order, first match wins.
export const PATTERNS = [
  // admin.js, dynamic text
  ['^Account (\\S+) created$', 'Conta $1 criada', 'Cuenta $1 creada'],
  ['^banned until (.+)$', 'banido até $1', 'baneado hasta $1'],
  ['^Accounts \\((\\d+)\\)$', 'Contas ($1)', 'Cuentas ($1)'],
  ['^Flags of (\\S+)$', 'Flags de $1', 'Flags de $1'],
  ['^Account (\\S+) will get: (.*)\\.$', 'A conta $1 receberá: $t2.', 'La cuenta $1 recibirá: $t2.'],
  ['^New password for (\\S+)$', 'Nova senha para $1', 'Nueva contraseña para $1'],
  ['^Ban (\\S+)$', 'Banir $1', 'Banear $1'],
  ['^Account (\\S+) \\((.*)\\) will be banned for (.+)\\.$', 'A conta $1 ($t2) será banida por $t3.', 'La cuenta $1 ($t2) será baneada por $t3.'],
  ['^Account (\\S+) \\((.*)\\) will be removed\\. Character files are kept on disk\\. This cannot be undone\\.$',
    'A conta $1 ($t2) será removida. Os arquivos de personagem são mantidos no disco. Isto não pode ser desfeito.',
    'La cuenta $1 ($t2) se eliminará. Los archivos de personaje se conservan en el disco. Esto no se puede deshacer.'],
  ['^account (\\S+)$', 'conta $1', 'cuenta $1'],
  ['^client \\((C-\\w+)\\)$', 'cliente ($1)', 'cliente ($1)'],
  ['^Disconnect (.*)\\. They can reconnect \\(this is not a ban\\)\\.$',
    'Desconectar $t1. O jogador pode se reconectar (isto não é um banimento).',
    'Desconectar a $t1. Puede volver a conectarse (esto no es un baneo).'],
  ['^Characters of (.+)$', 'Personagens de $1', 'Personajes de $1'],
  ['^Edit character (.*) \\(slot (\\d+)\\)$', 'Editar personagem $t1 (slot $2)', 'Editar personaje $t1 (ranura $2)'],
  ['^Changes: (.*)$', 'Alterações: $1', 'Cambios: $1'],
  ['^Saved: (\\d+) change\\(s\\)$', 'Salvo: $1 alteração(ões)', 'Guardado: $1 cambio(s)'],
  ['^(.*) - slot (\\d+)$', '$t1 - slot $2', '$t1 - ranura $2'],
  ['^(.*), (.*), played (.+)\\. Backups go to players/_admin-backups\\.$',
    '$1, $2, jogou por $3. Os backups vão para players/_admin-backups.',
    '$1, $2, jugó durante $3. Las copias de seguridad van a players/_admin-backups.'],
  ['^Inventory \\((\\d+/\\d+)\\)$', 'Inventário ($1)', 'Inventario ($1)'],
  ['^(\\w+) \\(max (\\d+)\\)$', '$1 (máx. $2)', '$1 (máx. $2)'],
  ['^(\\w+) \\(this class cannot learn it: set 0\\)$', '$1 (esta classe não aprende: ponha 0)', '$1 (esta clase no la aprende: pon 0)'],
  ['^Attribute (\\d)$', 'Atributo $1', 'Atributo $1'],
  ['^(DEF|POW|DEX|MIND) level$', 'Nível de $1', 'Nivel de $1'],
  ['^(DEF|POW|DEX|MIND) progress$', 'Progresso de $1', 'Progreso de $1'],
  ['^(Center|Right|Left) photon blast$', 'Photon blast ($t1)', 'Photon blast ($t1)'],
  ['^Center$', 'Centro', 'Centro'],
  ['^Right$', 'Direita', 'Derecha'],
  ['^Left$', 'Esquerda', 'Izquierda'],
  ['^Mag in slot (\\d+): (.*)$', 'Mag no slot $1: $t2', 'Mag en la ranura $1: $t2'],
  ['^changes kept, press Save changes$', 'alterações mantidas, clique em Salvar alterações', 'cambios conservados, pulsa Guardar cambios'],
  ['^Materials used: power (\\d+), mind (\\d+), evade (\\d+), def (\\d+), luck (\\d+), HP (\\d+), TP (\\d+)\\.$',
    'Materiais usados: power $1, mind $2, evade $3, def $4, luck $5, HP $6, TP $7.',
    'Materiales usados: power $1, mind $2, evade $3, def $4, luck $5, HP $6, TP $7.'],
  ['^Source: (.*)\\. Meseta (\\d+), (\\d+) item\\(s\\)\\.$', 'Origem: $1. Meseta $2, $3 item(ns).', 'Origen: $1. Meseta $2, $3 ítem(s).'],
  ['^Source: (.*)\\. Saving writes a \\.psobank file, which newserv prefers over the bank in the character file\\.$',
    'Origem: $1. Ao salvar, é gravado um arquivo .psobank, que o newserv prefere ao banco do arquivo de personagem.',
    'Origen: $1. Al guardar se escribe un archivo .psobank, que newserv prefiere al banco del archivo de personaje.'],
  ['^Edit shared bank$', 'Editar banco compartilhado', 'Editar banco compartido'],
  ['^Edit slot (\\d+) bank$', 'Editar banco do slot $1', 'Editar banco de la ranura $1'],
  ['^Bank \\(shared\\)$', 'Banco (compartilhado)', 'Banco (compartido)'],
  ['^Bank \\(slot (\\d+)\\)$', 'Banco (slot $1)', 'Banco (ranura $1)'],
  ['^Players \\((\\d+)\\)$', 'Jogadores ($1)', 'Jugadores ($1)'],
  ['^Quests \\((\\d+)\\)$', 'Missões ($1)', 'Misiones ($1)'],
  ['^Teams \\((\\d+)\\)$', 'Equipes ($1)', 'Equipos ($1)'],
  ['^Loaded from (.*)\\. Edit a quest in the quest editor and use its Publish to server action, or add or remove the files on the server and reload\\. ENABLED expressions are quest-flag conditions: a quest shows in the menu only when its category is listed and its expression is true for the player\\.$',
    'Carregadas de $1. Edite uma missão no editor de missões e use a ação Publicar no servidor, ou adicione e remova os arquivos no servidor e recarregue. As expressões ENABLED são condições de flags de missão: uma missão só aparece no menu quando sua categoria está listada e sua expressão é verdadeira para o jogador.',
    'Cargadas desde $1. Edita una misión en el editor de misiones y usa la acción Publicar en el servidor, o agrega y elimina los archivos en el servidor y recarga. Las expresiones ENABLED son condiciones de flags de misión: una misión solo aparece en el menú cuando su categoría está listada y su expresión es verdadera para el jugador.'],
  ['^Loaded from (.*)\\. Add or remove quest files on the server, then reload\\. ENABLED expressions are quest-flag conditions: a quest shows in the menu only when its category is listed and its expression is true for the player\\.$',
    'Carregadas de $1. Adicione ou remova arquivos de missão no servidor e depois recarregue. As expressões ENABLED são condições de flags de missão: uma missão só aparece no menu quando sua categoria está listada e sua expressão é verdadeira para o jogador.',
    'Cargadas desde $1. Agrega o elimina archivos de misión en el servidor y luego recarga. Las expresiones ENABLED son condiciones de flags de misión: una misión solo aparece en el menú cuando su categoría está listada y su expresión es verdadera para el jugador.'],
  ['^(\\d+) quests$', '$1 missões', '$1 misiones'],
  ['^\\.\\.\\. \\(truncated; (\\d+) bytes\\)$', '... (truncado; $1 bytes)', '... (truncado; $1 bytes)'],
  ['^Change (\\S+)$', 'Alterar $1', 'Cambiar $1'],
  ['^(\\S+) = (.*)\\. config\\.json is edited \\(backup kept\\) and reloaded\\.$',
    '$1 = $2. O config.json é editado (backup mantido) e recarregado.',
    '$1 = $2. Se edita config.json (se conserva una copia de seguridad) y se recarga.'],
  ['^(\\S+) updated$', '$1 atualizado', '$1 actualizado'],

  // server messages
  ['^config\\.json has (\\d+) matching lines for (\\S+); edit it by hand$', 'o config.json tem $1 linhas correspondentes a $2; edite-o manualmente', 'config.json tiene $1 líneas que coinciden con $2; edítalo a mano'],
  ['^newserv answered (\\d+)$', 'newserv respondeu $1', 'newserv respondió $1'],
  ['^HTTP (\\d+)$', 'HTTP $1', 'HTTP $1'],
  ['^newserv: (.*)$', 'newserv: $1', 'newserv: $1'],
  ['^confirmation required: send confirm="(.*)"$', 'confirmação necessária: envie confirm="$1"', 'se requiere confirmación: envía confirm="$1"'],
  ['^unknown flag: (.*)$', 'flag desconhecida: $1', 'flag desconocida: $1'],
  ['^(\\S+) must be a number from (\\S+) to (\\S+)$', '$1 deve ser um número de $2 a $3', '$1 debe ser un número de $2 a $3'],
  ['^(\\S+) must be one of (.*)$', '$1 deve ser um destes: $2', '$1 debe ser uno de estos: $2'],
  ['^(\\S+) must be true or false$', '$1 deve ser true ou false', '$1 debe ser true o false'],
  ['^(.+) must be a JSON object$', '$1 deve ser um objeto JSON', '$1 debe ser un objeto JSON'],
  ['^cannot reload: (.*)$', 'não é possível recarregar: $1', 'no se puede recargar: $1'],
  ['^invalid value for (\\S+)$', 'valor inválido para $1', 'valor no válido para $1'],
  ['^invalid (.+)$', '$1 inválido', '$1 no válido'],
  ['^(.+): item object expected$', '$1: objeto de item esperado', '$1: se esperaba un objeto de ítem'],
  ['^(.+): data1 must be 24 hex digits \\(12 bytes\\)$', '$1: data1 deve ter 24 dígitos hexadecimais (12 bytes)', '$1: data1 debe tener 24 dígitos hexadecimales (12 bytes)'],
  ['^(.+): data2 must be 8 hex digits \\(4 bytes\\)$', '$1: data2 deve ter 8 dígitos hexadecimais (4 bytes)', '$1: data2 debe tener 8 dígitos hexadecimales (4 bytes)'],
  ['^(.+): item class \\(first byte\\) must be 00-04$', '$1: a classe do item (primeiro byte) deve ser 00-04', '$1: la clase del ítem (primer byte) debe ser 00-04'],
  ['^(.+) must be an integer from (\\S+) to (\\S+)$', '$1 deve ser um inteiro de $2 a $3', '$1 debe ser un entero de $2 a $3'],
  ['^unknown field: (.*)$', 'campo desconhecido: $1', 'campo desconocido: $1'],
  ['^unknown stat: (.*)$', 'atributo desconhecido: $1', 'atributo desconocido: $1'],
  ['^unknown technique: (.*)$', 'técnica desconhecida: $1', 'técnica desconocida: $1'],
];

// ---- engine ------------------------------------------------------------------------------

const DICT_BY_LANG = { en: new Map(), 'pt-BR': new Map(), es: new Map() };
for (const [en, pt, es] of DICT) {
  if (!DICT_BY_LANG['pt-BR'].has(en)) DICT_BY_LANG['pt-BR'].set(en, pt);
  if (!DICT_BY_LANG.es.has(en)) DICT_BY_LANG.es.set(en, es);
}
const COMPILED = PATTERNS.map(([src, pt, es]) => ({ re: new RegExp(src), 'pt-BR': pt, es }));

// Which language to start in: a saved choice wins, then the browser language.
export function pickLang(saved, navigatorLang) {
  if (typeof saved === 'string' && CODES.includes(saved)) return saved;
  const n = String(navigatorLang ?? '').toLowerCase();
  if (n.startsWith('pt')) return 'pt-BR';
  if (n.startsWith('es')) return 'es';
  return 'en';
}

function readSaved() {
  try {
    return globalThis.localStorage?.getItem(STORAGE_KEY) ?? null;
  } catch {
    return null;
  }
}

let lang = pickLang(readSaved(), globalThis.navigator?.language);

function applyHtmlLang() {
  const root = globalThis.document?.documentElement;
  if (root) root.lang = LANGS.find((l) => l.code === lang).htmlLang;
}
applyHtmlLang();

export const getLang = () => lang;

export function setLang(code) {
  if (!CODES.includes(code)) return false;
  lang = code;
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, code);
  } catch { /* private mode: the choice just is not remembered */ }
  applyHtmlLang();
  return true;
}

// Translate `text` into `code` (default: the current language). Unknown text and
// non-strings come back unchanged.
export function trIn(code, text) {
  if (code === 'en' || typeof text !== 'string' || text === '') return text;
  const hit = DICT_BY_LANG[code]?.get(text);
  if (hit !== undefined) return hit;
  for (const p of COMPILED) {
    const m = p.re.exec(text);
    if (!m) continue;
    return p[code].replace(/\$(t?)(\d)/g, (_all, t, i) => (t ? trIn(code, m[Number(i)] ?? '') : (m[Number(i)] ?? '')));
  }
  return text;
}

export const tr = (text) => trIn(lang, text);

// The language <select>. `onChange` re-renders the current view (admin.js).
export function langSelect(onChange) {
  const sel = globalThis.document.createElement('select');
  sel.className = 'lang';
  sel.setAttribute('aria-label', tr('Language'));
  sel.title = tr('Language');
  for (const l of LANGS) {
    const o = globalThis.document.createElement('option');
    o.value = l.code;
    o.textContent = l.label;
    o.selected = l.code === lang;
    sel.append(o);
  }
  sel.addEventListener('change', () => {
    if (setLang(sel.value)) onChange?.();
  });
  return sel;
}
