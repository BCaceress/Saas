// Banco local do PDV desktop (SQLite) — base do offline 100%.
//
// ⚠️ SCAFFOLD. Este módulo é o coração do servidor local: espelha o catálogo,
// guarda a fila de vendas offline e o estado de sincronização. Roda no processo
// NATIVO (Electron main), exposto ao renderer por IPC (como window.tef).
//
// Por que SQLite e não a fila IndexedDB da Fase 3: no Electron, o main é o dono
// dos dados (durável, consultável, compartilhável entre janelas) e é ele que vai
// SERVIR a tela offline quando a Fase de "servidor local" fechar. A IndexedDB do
// navegador continua valendo para o PDV web puro; no desktop, esta é a verdade.
//
// Dependência: better-sqlite3 (síncrono, rápido). Precisa recompilar para o ABI
// do Electron: `npx electron-rebuild -f -w better-sqlite3` após instalar.

let Database;
try {
  Database = require("better-sqlite3");
} catch {
  Database = null;
}

let db = null;

function init(dbPath) {
  if (!Database) throw new Error("better-sqlite3 não instalado (ver electron-rebuild).");
  db = new Database(dbPath);
  db.pragma("journal_mode = WAL"); // concorrência leitura/escrita
  db.exec(SCHEMA);
  return db;
}

const SCHEMA = `
-- Catálogo espelhado do servidor central. Fonte de verdade OFFLINE para montar
-- o carrinho e resolver preço sem rede. Ressincronizado quando online.
CREATE TABLE IF NOT EXISTS catalog_produtos (
  id             TEXT PRIMARY KEY,
  nome           TEXT NOT NULL,
  sku            TEXT,
  ean            TEXT,
  preco          REAL NOT NULL,
  estoque_fechado REAL,
  restricao_idade INTEGER DEFAULT 0,
  imagem_url     TEXT,
  atualizado_em  TEXT
);
CREATE INDEX IF NOT EXISTS idx_produtos_ean ON catalog_produtos(ean);

-- Snapshot do caixa aberto (para anexar as vendas offline).
CREATE TABLE IF NOT EXISTS cash_session (
  id            TEXT PRIMARY KEY,
  site_id       TEXT NOT NULL,
  operador      TEXT,
  aberta_em     TEXT,
  valor_abertura REAL
);

-- Fila de vendas fechadas offline. payload_json é o mesmo shape que
-- sincronizarVendaOfflineAction espera. client_id = idempotência.
CREATE TABLE IF NOT EXISTS pending_sales (
  client_id   TEXT PRIMARY KEY,
  payload_json TEXT NOT NULL,
  criada_em   TEXT NOT NULL,
  tentativas  INTEGER DEFAULT 0,
  ultimo_erro TEXT
);

-- Estado de sincronização (última sync do catálogo, cursores, etc.).
CREATE TABLE IF NOT EXISTS sync_state (
  chave TEXT PRIMARY KEY,
  valor TEXT
);
`;

// ── Catálogo ──
function upsertProdutos(produtos) {
  const stmt = db.prepare(`
    INSERT INTO catalog_produtos (id, nome, sku, ean, preco, estoque_fechado, restricao_idade, imagem_url, atualizado_em)
    VALUES (@id, @nome, @sku, @ean, @preco, @estoque_fechado, @restricao_idade, @imagem_url, @atualizado_em)
    ON CONFLICT(id) DO UPDATE SET
      nome=excluded.nome, sku=excluded.sku, ean=excluded.ean, preco=excluded.preco,
      estoque_fechado=excluded.estoque_fechado, restricao_idade=excluded.restricao_idade,
      imagem_url=excluded.imagem_url, atualizado_em=excluded.atualizado_em
  `);
  const tx = db.transaction((rows) => rows.forEach((r) => stmt.run(r)));
  tx(produtos);
}

function listarProdutos() {
  return db.prepare("SELECT * FROM catalog_produtos ORDER BY nome").all();
}

// ── Fila de vendas offline ──
function enfileirarVenda(clientId, payload, criadaEm) {
  db.prepare(`
    INSERT INTO pending_sales (client_id, payload_json, criada_em)
    VALUES (?, ?, ?)
    ON CONFLICT(client_id) DO NOTHING
  `).run(clientId, JSON.stringify(payload), criadaEm);
}

function listarPendentes() {
  return db
    .prepare("SELECT client_id, payload_json, criada_em, tentativas FROM pending_sales ORDER BY criada_em")
    .all()
    .map((r) => ({ ...r, payload: JSON.parse(r.payload_json) }));
}

function removerPendente(clientId) {
  db.prepare("DELETE FROM pending_sales WHERE client_id = ?").run(clientId);
}

function registrarFalha(clientId, erro) {
  db.prepare(
    "UPDATE pending_sales SET tentativas = tentativas + 1, ultimo_erro = ? WHERE client_id = ?",
  ).run(String(erro).slice(0, 500), clientId);
}

// ── Estado de sync ──
function setState(chave, valor) {
  db.prepare(
    "INSERT INTO sync_state (chave, valor) VALUES (?, ?) ON CONFLICT(chave) DO UPDATE SET valor=excluded.valor",
  ).run(chave, valor);
}
function getState(chave) {
  return db.prepare("SELECT valor FROM sync_state WHERE chave = ?").get(chave)?.valor ?? null;
}

module.exports = {
  init,
  upsertProdutos,
  listarProdutos,
  enfileirarVenda,
  listarPendentes,
  removerPendente,
  registrarFalha,
  setState,
  getState,
};
