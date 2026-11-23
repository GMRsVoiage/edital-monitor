PRAGMA foreign_keys = ON;

INSERT OR IGNORE INTO sources (name, listing_url, city, state)
VALUES (
    'Boletim Oficial de Telêmaco Borba',
    'https://telemacoborba.pr.gov.br/index.php/informacoes/boletim-oficial',
    'Telêmaco Borba',
    'PR'
);

INSERT OR IGNORE INTO documents (
    source_id,
    source_page_url,
    pdf_url,
    edition,
    title,
    published_at,
    sha256,
    page_count,
    extraction_method
) VALUES
(
    (SELECT id FROM sources WHERE listing_url = 'https://telemacoborba.pr.gov.br/index.php/informacoes/boletim-oficial' LIMIT 1),
    'https://telemacoborba.pr.gov.br/index.php/informacoes/boletim-oficial/2510-edicao-2510',
    'https://telemacoborba.pr.gov.br/images/boletim/Edicao2510.pdf',
    '2510',
    'Edição 2510',
    '2026-10-15',
    '1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f708192a3b4c5d6e7f801',
    3,
    'native'
),
(
    (SELECT id FROM sources WHERE listing_url = 'https://telemacoborba.pr.gov.br/index.php/informacoes/boletim-oficial' LIMIT 1),
    'https://telemacoborba.pr.gov.br/index.php/informacoes/boletim-oficial/2511-edicao-2511',
    'https://telemacoborba.pr.gov.br/images/boletim/Edicao2511.pdf',
    '2511',
    'Edição 2511',
    '2026-10-28',
    '2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f708192a3b4c5d6e7f802',
    2,
    'native'
),
(
    (SELECT id FROM sources WHERE listing_url = 'https://telemacoborba.pr.gov.br/index.php/informacoes/boletim-oficial' LIMIT 1),
    'https://telemacoborba.pr.gov.br/index.php/informacoes/boletim-oficial/2512-edicao-2512',
    'https://telemacoborba.pr.gov.br/images/boletim/Edicao2512.pdf',
    '2512',
    'Edição 2512',
    '2026-11-09',
    '3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f708192a3b4c5d6e7f803',
    2,
    'native'
),
(
    (SELECT id FROM sources WHERE listing_url = 'https://telemacoborba.pr.gov.br/index.php/informacoes/boletim-oficial' LIMIT 1),
    'https://telemacoborba.pr.gov.br/index.php/informacoes/boletim-oficial/2513-edicao-2513-suplementar',
    'https://telemacoborba.pr.gov.br/images/boletim/Edicao2513.pdf',
    '2513',
    'Edição 2513 - Suplementar',
    '2026-11-18',
    '4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f708192a3b4c5d6e7f804',
    2,
    'native'
);

INSERT OR IGNORE INTO pages (document_id, page_number, text) VALUES
(
    (SELECT id FROM documents WHERE source_page_url = 'https://telemacoborba.pr.gov.br/index.php/informacoes/boletim-oficial/2510-edicao-2510' LIMIT 1),
    1,
    'PREFEITURA MUNICIPAL DE TELÊMACO BORBA — BOLETIM OFICIAL Nº 2510. AVISO DE LICITAÇÃO — PREGÃO ELETRÔNICO Nº 045/2026. Objeto: contratação de empresa especializada para fornecimento de insumos hospitalares e material médico destinados à Secretaria Municipal de Saúde. Abertura das propostas às 09h00.'
),
(
    (SELECT id FROM documents WHERE source_page_url = 'https://telemacoborba.pr.gov.br/index.php/informacoes/boletim-oficial/2510-edicao-2510' LIMIT 1),
    2,
    'EXTRATO DE CONTRATO Nº 118/2026 — CONTRATAÇÃO DE SERVIÇOS MÉDICOS. Contratante: Município de Telêmaco Borba, através do Fundo Municipal de Saúde. Atendimento nas Unidades Básicas de Saúde e Unidade de Pronto Atendimento (UPA).'
),
(
    (SELECT id FROM documents WHERE source_page_url = 'https://telemacoborba.pr.gov.br/index.php/informacoes/boletim-oficial/2510-edicao-2510' LIMIT 1),
    3,
    'EDITAL DE CONVOCAÇÃO Nº 012/2026 — CONCURSO PÚBLICO. A Secretaria Municipal de Administração convoca os candidatos aprovados no concurso público para os cargos de professor e pedagogo da rede municipal de educação básica.'
),
(
    (SELECT id FROM documents WHERE source_page_url = 'https://telemacoborba.pr.gov.br/index.php/informacoes/boletim-oficial/2511-edicao-2511' LIMIT 1),
    1,
    'PREFEITURA MUNICIPAL DE TELÊMACO BORBA — BOLETIM OFICIAL Nº 2511. EDITAL DE LICITAÇÃO — TOMADA DE PREÇOS Nº 008/2026. Objeto: contratação de obras e serviços de engenharia para reforma de escolas municipais vinculadas à Secretaria Municipal de Educação.'
),
(
    (SELECT id FROM documents WHERE source_page_url = 'https://telemacoborba.pr.gov.br/index.php/informacoes/boletim-oficial/2511-edicao-2511' LIMIT 1),
    2,
    'TERMO DE HOMOLOGAÇÃO — PREGÃO PRESENCIAL Nº 031/2026. Fica homologado o procedimento licitatório destinado à aquisição de gêneros alimentícios para merenda escolar e transporte de alunos da educação infantil e ensino fundamental.'
),
(
    (SELECT id FROM documents WHERE source_page_url = 'https://telemacoborba.pr.gov.br/index.php/informacoes/boletim-oficial/2512-edicao-2512' LIMIT 1),
    1,
    'PREFEITURA MUNICIPAL DE TELÊMACO BORBA — BOLETIM OFICIAL Nº 2512. AVISO DE PREGÃO ELETRÔNICO Nº 052/2026 — SISTEMA DE REGISTRO DE PREÇOS. Aquisição parcelada de medicamentos da atenção básica para farmácias da Secretaria Municipal de Saúde.'
),
(
    (SELECT id FROM documents WHERE source_page_url = 'https://telemacoborba.pr.gov.br/index.php/informacoes/boletim-oficial/2512-edicao-2512' LIMIT 1),
    2,
    'EDITAL DE CHAMAMENTO PÚBLICO Nº 004/2026. Credenciamento e contratação de clínicas e laboratórios para realização de exames laboratoriais e diagnósticos por imagem aos usuários do Sistema Único de Saúde no município de Telêmaco Borba.'
),
(
    (SELECT id FROM documents WHERE source_page_url = 'https://telemacoborba.pr.gov.br/index.php/informacoes/boletim-oficial/2513-edicao-2513-suplementar' LIMIT 1),
    1,
    'PREFEITURA MUNICIPAL DE TELÊMACO BORBA — BOLETIM OFICIAL Nº 2513 SUPLEMENTAR. EDITAL Nº 019/2026 — PROCESSO SELETIVO SIMPLIFICADO E CONCURSO PÚBLICO. Normas para contratação temporária de profissionais para as áreas de saúde e educação no exercício de 2026.'
),
(
    (SELECT id FROM documents WHERE source_page_url = 'https://telemacoborba.pr.gov.br/index.php/informacoes/boletim-oficial/2513-edicao-2513-suplementar' LIMIT 1),
    2,
    'RESULTADO DE LICITAÇÃO — PREGÃO ELETRÔNICO Nº 055/2026. Julgamento das propostas e contratação de equipamentos de informática, laboratórios digitais e conectividade para escolas da rede municipal de educação.'
);
