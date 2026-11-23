PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS sources (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    listing_url TEXT NOT NULL UNIQUE,
    city TEXT,
    state TEXT,
    active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS documents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_id INTEGER,
    source_page_url TEXT NOT NULL UNIQUE,
    pdf_url TEXT NOT NULL,
    edition TEXT,
    title TEXT NOT NULL,
    published_at TEXT,
    sha256 TEXT,
    page_count INTEGER NOT NULL DEFAULT 0,
    extraction_method TEXT NOT NULL DEFAULT 'native'
        CHECK (extraction_method IN ('native', 'needs_ocr', 'ocr', 'vision_ai')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (source_id) REFERENCES sources(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_documents_date ON documents(published_at);
CREATE INDEX IF NOT EXISTS idx_documents_edition ON documents(edition);
CREATE INDEX IF NOT EXISTS idx_documents_sha256 ON documents(sha256);

CREATE TABLE IF NOT EXISTS pages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    document_id INTEGER NOT NULL,
    page_number INTEGER NOT NULL,
    text TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE,
    UNIQUE(document_id, page_number)
);

CREATE INDEX IF NOT EXISTS idx_pages_document ON pages(document_id);

CREATE VIRTUAL TABLE IF NOT EXISTS pages_fts USING fts5(
    text,
    content='pages',
    content_rowid='id',
    tokenize='unicode61 remove_diacritics 2'
);

CREATE TRIGGER IF NOT EXISTS pages_ai AFTER INSERT ON pages BEGIN
    INSERT INTO pages_fts(rowid, text) VALUES (new.id, new.text);
END;

CREATE TRIGGER IF NOT EXISTS pages_ad AFTER DELETE ON pages BEGIN
    INSERT INTO pages_fts(pages_fts, rowid, text)
    VALUES ('delete', old.id, old.text);
END;

CREATE TRIGGER IF NOT EXISTS pages_au AFTER UPDATE OF text ON pages BEGIN
    INSERT INTO pages_fts(pages_fts, rowid, text)
    VALUES ('delete', old.id, old.text);
    INSERT INTO pages_fts(rowid, text) VALUES (new.id, new.text);
END;

CREATE TABLE IF NOT EXISTS visitor_daily (
    visitor_hash TEXT NOT NULL,
    day TEXT NOT NULL,
    searches INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY(visitor_hash, day)
);

CREATE TABLE IF NOT EXISTS ingest_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_page_url TEXT,
    status TEXT NOT NULL,
    detail TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO sources (name, listing_url, city, state)
VALUES (
    'Boletim Oficial de Telêmaco Borba',
    'https://telemacoborba.pr.gov.br/index.php/informacoes/boletim-oficial',
    'Telêmaco Borba',
    'PR'
);

CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL CHECK (length(trim(name)) >= 2),
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS keyword_groups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 2 AND 80),
    description TEXT NOT NULL DEFAULT '',
    color TEXT NOT NULL DEFAULT '#0b7aa8',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE(user_id, name)
);

CREATE INDEX IF NOT EXISTS idx_keyword_groups_user ON keyword_groups(user_id);

CREATE TABLE IF NOT EXISTS saved_keywords (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    group_id INTEGER,
    keyword TEXT NOT NULL UNIQUE CHECK (length(trim(keyword)) BETWEEN 3 AND 100),
    description TEXT NOT NULL DEFAULT '',
    priority TEXT NOT NULL DEFAULT 'media' CHECK (priority IN ('alta', 'media', 'baixa')),
    target_section TEXT NOT NULL DEFAULT 'geral',
    is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
    last_searched_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (group_id) REFERENCES keyword_groups(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_saved_keywords_user ON saved_keywords(user_id);
CREATE INDEX IF NOT EXISTS idx_saved_keywords_group ON saved_keywords(group_id);
CREATE INDEX IF NOT EXISTS idx_saved_keywords_active_priority ON saved_keywords(is_active, priority);

CREATE TABLE IF NOT EXISTS keyword_alerts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    keyword_id INTEGER NOT NULL,
    document_id INTEGER,
    status TEXT NOT NULL DEFAULT 'novo' CHECK (status IN ('novo', 'revisado', 'arquivado')),
    matched_excerpt TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (keyword_id) REFERENCES saved_keywords(id) ON DELETE CASCADE,
    FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_keyword_alerts_user ON keyword_alerts(user_id);
CREATE INDEX IF NOT EXISTS idx_keyword_alerts_keyword_doc ON keyword_alerts(keyword_id, document_id);
CREATE INDEX IF NOT EXISTS idx_keyword_alerts_document ON keyword_alerts(document_id);
CREATE INDEX IF NOT EXISTS idx_keyword_alerts_status ON keyword_alerts(status);
