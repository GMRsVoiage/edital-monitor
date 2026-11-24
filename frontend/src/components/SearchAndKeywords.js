"use client";

import Link from "next/link";
import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import {
  ApiError,
  cleanQuery,
  createKeyword,
  deleteKeyword,
  fetchGroups,
  fetchKeywords,
  fetchStats,
  patchKeyword,
  scanKeyword,
  searchBulletins,
  updateKeyword
} from "../lib/api";
import { useAccessibleFormAria } from "../lib/formAria";
import {
  formatDatePtBr,
  formatDateTimePtBr,
  isHttpUrl,
  parseSafeExcerpt,
  validateKeywordInput,
  validateSearchQuery
} from "../lib/validation";
import { useAuth } from "./AuthProvider";
import ConfirmDialog from "./ConfirmDialog";
import FeedbackBanner from "./FeedbackBanner";

const PRIORITY_LABELS = {
  alta: "Alta",
  media: "Média",
  baixa: "Baixa"
};

function applyCustomValidity(form, fieldName, message) {
  const target = fieldName ? form?.elements?.namedItem?.(fieldName) : null;
  if (target && typeof target.setCustomValidity === "function") {
    target.setCustomValidity(message);
  }
}

function InlineKeywordEditForm({
  item,
  groups,
  editValues,
  setEditValues,
  editSaving,
  onCancel,
  onSave
}) {
  const editFormRef = useRef(null);
  useAccessibleFormAria(editFormRef);

  const handleSubmit = (event) => {
    event.preventDefault();
    onSave(event, item.id, editFormRef.current);
  };

  return (
    <form
      ref={editFormRef}
      className="keyword-edit-form"
      onSubmit={handleSubmit}
      noValidate
    >
      <div className="form-row-2">
        <div className="field">
          <label className="field-label" htmlFor={`edit-kw-${item.id}`}>
            Termo <span aria-hidden="true">*</span>
          </label>
          <input
            id={`edit-kw-${item.id}`}
            name="keyword"
            type="text"
            className="field-control"
            value={editValues.keyword}
            onChange={(e) => {
              e.target.setCustomValidity("");
              setEditValues((prev) => ({ ...prev, keyword: e.target.value }));
            }}
            minLength={3}
            maxLength={100}
            data-error={`edit-kw-error-${item.id}`}
            required
          />
          <div id={`edit-kw-error-${item.id}`} className="field-error">
            <span className="error-badge" role="img" aria-label="Erro">
              !
            </span>
            <span>A palavra-chave deve ter entre 3 e 100 caracteres.</span>
          </div>
        </div>
        <div className="field">
          <label className="field-label" htmlFor={`edit-grp-${item.id}`}>
            Grupo
          </label>
          <select
            id={`edit-grp-${item.id}`}
            name="group_id"
            className="field-control"
            value={editValues.group_id}
            onChange={(e) => {
              e.target.setCustomValidity("");
              setEditValues((prev) => ({ ...prev, group_id: e.target.value }));
            }}
          >
            <option value="">Sem grupo</option>
            {groups.map((grp) => (
              <option key={grp.id} value={String(grp.id)}>
                {grp.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="form-row-3">
        <div className="field">
          <label className="field-label" htmlFor={`edit-prio-${item.id}`}>
            Prioridade
          </label>
          <select
            id={`edit-prio-${item.id}`}
            name="priority"
            className="field-control"
            value={editValues.priority}
            onChange={(e) => {
              e.target.setCustomValidity("");
              setEditValues((prev) => ({ ...prev, priority: e.target.value }));
            }}
          >
            <option value="alta">Alta</option>
            <option value="media">Média</option>
            <option value="baixa">Baixa</option>
          </select>
        </div>
        <div className="field">
          <label className="field-label" htmlFor={`edit-sec-${item.id}`}>
            Seção alvo
          </label>
          <input
            id={`edit-sec-${item.id}`}
            name="target_section"
            type="text"
            className="field-control"
            value={editValues.target_section}
            onChange={(e) => {
              e.target.setCustomValidity("");
              setEditValues((prev) => ({
                ...prev,
                target_section: e.target.value
              }));
            }}
            maxLength={80}
            data-error={`edit-sec-error-${item.id}`}
          />
          <div id={`edit-sec-error-${item.id}`} className="field-error">
            <span className="error-badge" role="img" aria-label="Erro">
              !
            </span>
            <span>A seção de destino deve ter no máximo 80 caracteres.</span>
          </div>
        </div>
        <div className="field">
          <label className="field-label" htmlFor={`edit-desc-${item.id}`}>
            Descrição
          </label>
          <input
            id={`edit-desc-${item.id}`}
            name="description"
            type="text"
            className="field-control"
            value={editValues.description}
            onChange={(e) => {
              e.target.setCustomValidity("");
              setEditValues((prev) => ({ ...prev, description: e.target.value }));
            }}
            maxLength={500}
            data-error={`edit-desc-error-${item.id}`}
          />
          <div id={`edit-desc-error-${item.id}`} className="field-error">
            <span className="error-badge" role="img" aria-label="Erro">
              !
            </span>
            <span>Descrição deve ter no máximo 500 caracteres.</span>
          </div>
        </div>
      </div>

      <div className="keywords-toolbar">
        <label className="checkbox-row" htmlFor={`edit-active-${item.id}`}>
          <input
            id={`edit-active-${item.id}`}
            name="is_active"
            type="checkbox"
            className="checkbox-control"
            checked={editValues.is_active}
            onChange={(e) =>
              setEditValues((prev) => ({ ...prev, is_active: e.target.checked }))
            }
          />
          <span>Monitoramento ativo</span>
        </label>

        <div className="keyword-actions">
          <button
            type="button"
            className="aero-gel-btn aero-gel-btn--ghost aero-gel-btn--sm"
            onClick={onCancel}
          >
            Cancelar
          </button>
          <button
            type="submit"
            className="aero-gel-btn aero-gel-btn--eco aero-gel-btn--sm"
            disabled={editSaving}
          >
            Salvar alterações
          </button>
        </div>
      </div>
    </form>
  );
}

export default function SearchAndKeywords() {
  const { isAuthenticated, token, loading: authLoading } = useAuth();

  const searchFormRef = useRef(null);
  const searchInputRef = useRef(null);
  const keywordFormRef = useRef(null);
  const resultsAnchorRef = useRef(null);

  useAccessibleFormAria(searchFormRef);
  useAccessibleFormAria(keywordFormRef);

  // Stats state
  const [stats, setStats] = useState({
    documents: "—",
    pages: "—",
    latestDate: "—",
    latestMeta: ""
  });

  // Search state
  const [query, setQuery] = useState("");
  const [searchError, setSearchError] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchFeedback, setSearchFeedback] = useState({ message: "", state: "info" });
  const [results, setResults] = useState([]);

  // Saved keywords & groups state
  const [keywords, setKeywords] = useState([]);
  const [groups, setGroups] = useState([]);
  const [kwLoading, setKwLoading] = useState(false);
  const [kwFeedback, setKwFeedback] = useState({ message: "", state: "info" });
  const [kwSubmitting, setKwSubmitting] = useState(false);

  // New keyword form state
  const [newKeyword, setNewKeyword] = useState("");
  const [newGroupId, setNewGroupId] = useState("");
  const [newPriority, setNewPriority] = useState("media");
  const [newSection, setNewSection] = useState("geral");
  const [newDescription, setNewDescription] = useState("");
  const [newActive, setNewActive] = useState(true);

  // Inline edit state
  const [editingId, setEditingId] = useState(null);
  const [editValues, setEditValues] = useState({
    keyword: "",
    group_id: "",
    priority: "media",
    target_section: "geral",
    description: "",
    is_active: true
  });
  const [editSaving, setEditSaving] = useState(false);

  // Delete confirmation dialog state
  const [deleteTarget, setDeleteTarget] = useState(null);

  const loadStats = useCallback(async () => {
    try {
      const data = await fetchStats();
      setStats({
        documents: Number(data?.documents || 0).toLocaleString("pt-BR"),
        pages: Number(data?.pages || 0).toLocaleString("pt-BR"),
        latestDate: data?.latest?.published_at
          ? formatDatePtBr(data.latest.published_at)
          : "—",
        latestMeta: data?.latest?.edition ? `Edição ${data.latest.edition}` : ""
      });
    } catch {
      // Non-blocking: home page stays functional even if stats fail
    }
  }, []);

  const loadKeywordsAndGroups = useCallback(async () => {
    if (!isAuthenticated || !token) {
      setKeywords([]);
      setGroups([]);
      return;
    }

    setKwLoading(true);
    try {
      const [kwRes, grpRes] = await Promise.all([
        fetchKeywords({}, { token }),
        fetchGroups({}, { token })
      ]);
      setKeywords(Array.isArray(kwRes?.keywords) ? kwRes.keywords : []);
      setGroups(Array.isArray(grpRes?.groups) ? grpRes.groups : []);
    } catch (err) {
      setKwFeedback({
        message: err?.message || "Não foi possível carregar suas palavras-chave salvas.",
        state: "error"
      });
    } finally {
      setKwLoading(false);
    }
  }, [isAuthenticated, token]);

  useEffect(() => {
    loadStats();
  }, [loadStats]);

  useEffect(() => {
    if (!authLoading) {
      loadKeywordsAndGroups();
    }
  }, [authLoading, loadKeywordsAndGroups]);

  const runSearch = useCallback(async (rawTerm, { scrollToResults = false } = {}) => {
    const check = validateSearchQuery(rawTerm);
    if (!check.valid) {
      setSearchError(check.error);
      if (searchInputRef.current) {
        searchInputRef.current.setCustomValidity(check.error);
        searchFormRef.current?.checkValidity();
        searchInputRef.current.focus();
      }
      return;
    }

    setSearchError("");
    if (searchInputRef.current) {
      searchInputRef.current.setCustomValidity("");
    }

    setQuery(check.value);
    setSearching(true);
    setResults([]);
    setSearchFeedback({
      message: "Pesquisando nas publicações indexadas…",
      state: "loading"
    });

    if (scrollToResults && resultsAnchorRef.current) {
      const reduceMotion =
        typeof window !== "undefined" &&
        window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      resultsAnchorRef.current.scrollIntoView({
        behavior: reduceMotion ? "auto" : "smooth",
        block: "start"
      });
    }

    try {
      const data = await searchBulletins(check.value);
      const items = Array.isArray(data?.results) ? data.results : [];
      setResults(items);

      if (items.length === 0) {
        setSearchFeedback({
          message: "Nenhuma ocorrência encontrada nas publicações indexadas.",
          state: "info"
        });
      } else {
        const total = Number(data?.total ?? items.length);
        const usageText =
          data?.usage &&
          typeof data.usage.remaining === "number" &&
          typeof data.usage.limit === "number"
            ? ` Pesquisas restantes hoje: ${data.usage.remaining}/${data.usage.limit}.`
            : "";
        setSearchFeedback({
          message: `${total} resultado(s) encontrado(s).${usageText}`,
          state: "ok"
        });
      }
    } catch (err) {
      const message =
        err instanceof ApiError
          ? err.message
          : "Não foi possível conectar à API de pesquisa no momento.";
      setSearchFeedback({ message, state: "error" });
    } finally {
      setSearching(false);
    }
  }, []);

  // Optional ?q= query param initialization (client-side only to avoid Suspense bailout)
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const initialQ = params.get("q");
    if (initialQ) {
      const cleaned = cleanQuery(initialQ);
      setQuery(cleaned);
      if (validateSearchQuery(cleaned).valid) {
        runSearch(cleaned);
      }
    }
  }, [runSearch]);

  const handleSearchSubmit = (event) => {
    event.preventDefault();
    runSearch(query);
  };

  const handleSaveCurrentSearch = async () => {
    const check = validateKeywordInput({
      keyword: query,
      priority: "media",
      target_section: "geral",
      description: "",
      is_active: 1
    });

    if (!check.valid) {
      setSearchError(check.error);
      if (searchInputRef.current) {
        searchInputRef.current.setCustomValidity(check.error);
        searchFormRef.current?.checkValidity();
        searchInputRef.current.focus();
      }
      return;
    }

    if (!isAuthenticated) {
      setNewKeyword(check.value.keyword);
      setKwFeedback({
        message: "Entre ou cadastre-se para salvar esta palavra-chave na sua conta.",
        state: "error"
      });
      return;
    }

    setKwSubmitting(true);
    setKwFeedback({ message: "Salvando termo atual…", state: "loading" });
    try {
      await createKeyword(check.value, { token });
      setKwFeedback({
        message: `Palavra-chave "${check.value.keyword}" salva com sucesso.`,
        state: "ok"
      });
      await loadKeywordsAndGroups();
    } catch (err) {
      setKwFeedback({
        message: err?.message || "Não foi possível salvar o termo atual.",
        state: "error"
      });
    } finally {
      setKwSubmitting(false);
    }
  };

  const handleCreateKeyword = async (event) => {
    event.preventDefault();

    if (!isAuthenticated) {
      setKwFeedback({
        message: "Autenticação necessária: entre na sua conta para cadastrar palavras-chave.",
        state: "error"
      });
      return;
    }

    const check = validateKeywordInput({
      keyword: newKeyword,
      group_id: newGroupId,
      priority: newPriority,
      target_section: newSection,
      description: newDescription,
      is_active: newActive
    });

    if (!check.valid) {
      applyCustomValidity(keywordFormRef.current, check.field, check.error);
      keywordFormRef.current?.checkValidity();
      const firstInvalid = keywordFormRef.current?.querySelector(":invalid");
      firstInvalid?.focus();
      setKwFeedback({ message: check.error, state: "error" });
      return;
    }

    setKwSubmitting(true);
    setKwFeedback({ message: "Cadastrando palavra-chave…", state: "loading" });
    try {
      await createKeyword(check.value, { token });
      setNewKeyword("");
      setNewDescription("");
      setNewSection("geral");
      setNewPriority("media");
      setNewGroupId("");
      setNewActive(true);
      setKwFeedback({
        message: `Palavra-chave "${check.value.keyword}" cadastrada com sucesso.`,
        state: "ok"
      });
      await loadKeywordsAndGroups();
    } catch (err) {
      setKwFeedback({
        message: err?.message || "Erro ao cadastrar palavra-chave.",
        state: "error"
      });
    } finally {
      setKwSubmitting(false);
    }
  };

  const handleKeywordClick = (item) => {
    setQuery(item.keyword);
    runSearch(item.keyword, { scrollToResults: true });
  };

  const startEditing = (item) => {
    setEditingId(item.id);
    setEditValues({
      keyword: item.keyword || "",
      group_id: item.group_id ? String(item.group_id) : "",
      priority: item.priority || "media",
      target_section: item.target_section || "geral",
      description: item.description || "",
      is_active: Number(item.is_active) === 1
    });
  };

  const handleSaveEdit = async (event, id, formNode = null) => {
    event.preventDefault();
    const form = formNode || event.currentTarget;
    const check = validateKeywordInput(editValues);
    if (!check.valid) {
      applyCustomValidity(form, check.field, check.error);
      form?.checkValidity();
      form?.querySelector(":invalid")?.focus();
      setKwFeedback({ message: check.error, state: "error" });
      return;
    }

    setEditSaving(true);
    try {
      await updateKeyword(id, check.value, { token });
      setEditingId(null);
      setKwFeedback({
        message: `Palavra-chave "${check.value.keyword}" atualizada com sucesso.`,
        state: "ok"
      });
      await loadKeywordsAndGroups();
    } catch (err) {
      setKwFeedback({
        message: err?.message || "Erro ao atualizar palavra-chave.",
        state: "error"
      });
    } finally {
      setEditSaving(false);
    }
  };

  const handleToggleActive = async (item) => {
    const nextActive = Number(item.is_active) === 1 ? 0 : 1;
    try {
      await patchKeyword(item.id, { is_active: nextActive }, { token });
      setKwFeedback({
        message: `Palavra-chave "${item.keyword}" ${nextActive ? "ativada" : "pausada"}.`,
        state: "ok"
      });
      await loadKeywordsAndGroups();
    } catch (err) {
      setKwFeedback({
        message: err?.message || "Erro ao alterar status da palavra-chave.",
        state: "error"
      });
    }
  };

  const handleScanKeyword = async (item) => {
    setKwFeedback({
      message: `Varrendo boletins para "${item.keyword}"…`,
      state: "loading"
    });
    try {
      const res = await scanKeyword(item.id, { token });
      const matched = Number(res?.matched_documents || 0);
      const created = Number(res?.created_alerts || 0);
      setKwFeedback({
        message: `Varredura concluída para "${item.keyword}": ${matched} documento(s) encontrado(s), ${created} novo(s) alerta(s) gerado(s).`,
        state: "ok"
      });
      await loadKeywordsAndGroups();
    } catch (err) {
      setKwFeedback({
        message: err?.message || "Não foi possível varrer os boletins.",
        state: "error"
      });
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    const target = deleteTarget;
    setDeleteTarget(null);
    try {
      await deleteKeyword(target.id, { token });
      if (editingId === target.id) setEditingId(null);
      setKwFeedback({
        message: `Palavra-chave "${target.keyword}" excluída com sucesso.`,
        state: "ok"
      });
      await loadKeywordsAndGroups();
    } catch (err) {
      setKwFeedback({
        message: err?.message || "Não foi possível excluir a palavra-chave.",
        state: "error"
      });
    }
  };

  return (
    <>
      <section className="hero-panel">
        <p className="eyebrow">Acesso público à informação · Monitoramento de editais</p>
        <h1 id="conteudo-principal" tabIndex={-1}>
          Pesquise nos Boletins Oficiais de Telêmaco Borba
        </h1>
        <p className="lead">
          Consulte nomes, portarias, licitações e termos publicados nas edições indexadas de forma
          rápida, gratuita e aberta — ou entre para salvar palavras-chave e acompanhar alertas.
        </p>

        <search>
          <form
            id="search-form"
            ref={searchFormRef}
            className="search-form"
            onSubmit={handleSearchSubmit}
            noValidate
          >
            <label className="search-label" htmlFor="search-input">
              Nome ou termo publicado
            </label>
            <p id="search-hint" className="search-hint">
              Digite de 3 a 100 caracteres (ex.: João da Silva, pregão, nomeação). Os trechos
              indicam ocorrências encontradas; confirme sempre no PDF oficial.
            </p>
            <div className="search-row">
              <input
                ref={searchInputRef}
                id="search-input"
                name="q"
                type="search"
                value={query}
                onChange={(e) => {
                  const val = e.target.value;
                  e.target.setCustomValidity("");
                  setQuery(val);
                  if (searchError) {
                    setSearchError("");
                  }
                }}
                minLength={3}
                maxLength={100}
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="none"
                spellCheck={false}
                enterKeyHint="search"
                aria-describedby="search-hint"
                data-error="search-error"
                placeholder="Ex.: João da Silva"
                required
              />
              <button
                id="search-submit"
                className="aero-gel-btn"
                type="submit"
                disabled={searching}
              >
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <circle cx="11" cy="11" r="7" />
                  <path d="m20 20-3.5-3.5" />
                </svg>
                <span>Pesquisar</span>
              </button>
              <button
                id="save-current-search-btn"
                type="button"
                className="aero-gel-btn aero-gel-btn--eco"
                onClick={handleSaveCurrentSearch}
                disabled={kwSubmitting}
              >
                Salvar termo atual
              </button>
            </div>
            <div
              id="search-error"
              className={`field-error${searchError ? " is-visible" : ""}`}
            >
              <span className="error-badge" role="img" aria-label="Erro">
                !
              </span>
              <span>
                {searchError || "Digite pelo menos 3 caracteres para iniciar a pesquisa."}
              </span>
            </div>
          </form>
        </search>
      </section>

      <section className="status-grid" aria-label="Estatísticas do índice">
        <article className="status-card">
          <span className="status-icon" aria-hidden="true">
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <path d="M14 2v6h6" />
              <path d="M8 13h8M8 17h5" />
            </svg>
          </span>
          <div className="status-body">
            <span className="status-label">Documentos indexados</span>
            <strong className="status-value tabular" id="stat-documents">
              {stats.documents}
            </strong>
          </div>
        </article>

        <article className="status-card">
          <span className="status-icon status-icon--eco" aria-hidden="true">
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
              <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
            </svg>
          </span>
          <div className="status-body">
            <span className="status-label">Páginas processadas</span>
            <strong className="status-value tabular" id="stat-pages">
              {stats.pages}
            </strong>
          </div>
        </article>

        <article className="status-card">
          <span className="status-icon" aria-hidden="true">
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect x="3" y="4" width="18" height="18" rx="2" />
              <path d="M16 2v4M8 2v4M3 10h18" />
            </svg>
          </span>
          <div className="status-body">
            <span className="status-label">Última publicação</span>
            <strong className="status-value tabular" id="stat-latest">
              {stats.latestDate}
            </strong>
            <span className="status-sub tabular" id="stat-latest-meta">
              {stats.latestMeta}
            </span>
          </div>
        </article>
      </section>

      <section
        ref={resultsAnchorRef}
        className="results-section"
        aria-label="Resultados da pesquisa"
      >
        <FeedbackBanner
          id="feedback"
          message={searchFeedback.message}
          state={searchFeedback.state}
        />
        <div
          id="results"
          className="results"
          aria-busy={searching ? "true" : undefined}
        >
          {results.map((item, idx) => {
            const excerptSegments = parseSafeExcerpt(item.excerpt);
            const hasPdf = isHttpUrl(item.pdf_url);
            const hasSource =
              isHttpUrl(item.source_page_url) && item.source_page_url !== item.pdf_url;

            return (
              <article
                key={`${item.edition || "doc"}-${item.page_number}-${idx}`}
                className="result-card"
              >
                <div className="result-meta">
                  {item.edition ? (
                    <span className="meta-pill meta-pill--edition">
                      Edição {item.edition}
                    </span>
                  ) : null}
                  <span className="meta-pill">{formatDatePtBr(item.published_at)}</span>
                  <span className="meta-pill">Página {item.page_number}</span>
                </div>

                <h2>{item.title || "Boletim Oficial"}</h2>

                <div className="excerpt">
                  {excerptSegments.map((seg, segIdx) =>
                    seg.mark ? (
                      <mark key={segIdx}>{seg.text}</mark>
                    ) : (
                      <Fragment key={segIdx}>{seg.text}</Fragment>
                    )
                  )}
                </div>

                {hasPdf || hasSource ? (
                  <div className="result-actions">
                    {hasPdf ? (
                      <a
                        className="aero-gel-btn aero-gel-btn--sky"
                        href={item.pdf_url}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        Abrir PDF oficial ↗
                      </a>
                    ) : null}
                    {hasSource ? (
                      <a
                        className="doc-link-secondary"
                        href={item.source_page_url}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        Página da edição ↗
                      </a>
                    ) : null}
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      </section>

      <section
        id="saved-keywords-section"
        className="doc-surface saved-keywords-section"
        aria-labelledby="saved-keywords-heading"
      >
        <div className="section-header">
          <div>
            <h2 id="saved-keywords-heading">Palavras-chave salvas</h2>
            <p className="section-subtitle">
              Cadastre termos para monitoramento contínuo. Clique em qualquer palavra-chave salva
              para preencher a pesquisa e consultar os Boletins Oficiais.
            </p>
          </div>
          {isAuthenticated ? (
            <div className="section-header-actions">
              <Link
                href="/grupos"
                className="aero-gel-btn aero-gel-btn--sky aero-gel-btn--sm"
              >
                Gerenciar grupos e alertas
              </Link>
              <Link
                href="/relatorios"
                className="aero-gel-btn aero-gel-btn--ghost aero-gel-btn--sm"
              >
                Ver relatórios
              </Link>
            </div>
          ) : null}
        </div>

        {!isAuthenticated ? (
          <div className="auth-cta-banner">
            <div>
              <strong>Monitoramento personalizado por usuário</strong>
              <p className="field-hint">
                A busca pública nos boletins é aberta a todos. Entre ou crie sua conta para salvar
                palavras-chave, organizá-las em grupos e gerar alertas automáticos.
              </p>
            </div>
            <div className="section-header-actions">
              <Link href="/login" className="aero-gel-btn aero-gel-btn--sm">
                Entrar
              </Link>
              <Link
                href="/cadastro"
                className="aero-gel-btn aero-gel-btn--eco aero-gel-btn--sm"
              >
                Criar conta
              </Link>
            </div>
          </div>
        ) : null}

        <FeedbackBanner
          id="keywords-feedback"
          message={kwFeedback.message}
          state={kwFeedback.state}
        />

        <form
          id="keyword-form"
          ref={keywordFormRef}
          className="aero-form"
          aria-labelledby="keyword-form-heading"
          onSubmit={handleCreateKeyword}
          noValidate
        >
          <h3 id="keyword-form-heading" className="visually-hidden">
            Cadastrar nova palavra-chave
          </h3>

          <div className="form-row-2">
            <div className="field">
              <label className="field-label" htmlFor="keyword-input">
                Nova palavra-chave <span aria-hidden="true">*</span>
              </label>
              <p id="keyword-input-hint" className="field-hint">
                Entre 3 e 100 caracteres (espaços extras são normalizados automaticamente).
              </p>
              <input
                id="keyword-input"
                name="keyword"
                type="text"
                className="field-control"
                value={newKeyword}
                onChange={(e) => {
                  e.target.setCustomValidity("");
                  setNewKeyword(e.target.value);
                }}
                minLength={3}
                maxLength={100}
                required
                aria-describedby="keyword-input-hint"
                data-error="keyword-input-error"
                placeholder="Ex.: Pregão Eletrônico"
              />
              <div id="keyword-input-error" className="field-error">
                <span className="error-badge" role="img" aria-label="Erro">
                  !
                </span>
                <span>Informe uma palavra-chave entre 3 e 100 caracteres.</span>
              </div>
            </div>

            <div className="field">
              <label className="field-label" htmlFor="keyword-group">
                Grupo temático
              </label>
              <p id="keyword-group-hint" className="field-hint">
                Opcional. Crie ou edite grupos em <Link href="/grupos">Grupos e Alertas</Link>.
              </p>
              <select
                id="keyword-group"
                name="group_id"
                className="field-control"
                value={newGroupId}
                onChange={(e) => setNewGroupId(e.target.value)}
                aria-describedby="keyword-group-hint"
              >
                <option value="">Sem grupo</option>
                {groups.map((grp) => (
                  <option key={grp.id} value={String(grp.id)}>
                    {grp.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="form-row-3">
            <div className="field">
              <label className="field-label" htmlFor="keyword-priority">
                Prioridade
              </label>
              <select
                id="keyword-priority"
                name="priority"
                className="field-control"
                value={newPriority}
                onChange={(e) => setNewPriority(e.target.value)}
              >
                <option value="alta">Alta</option>
                <option value="media">Média</option>
                <option value="baixa">Baixa</option>
              </select>
            </div>

            <div className="field">
              <label className="field-label" htmlFor="keyword-section">
                Seção alvo
              </label>
              <input
                id="keyword-section"
                name="target_section"
                type="text"
                list="target-section-options"
                className="field-control"
                value={newSection}
                onChange={(e) => {
                  e.target.setCustomValidity("");
                  setNewSection(e.target.value);
                }}
                maxLength={80}
                data-error="keyword-section-error"
                placeholder="Ex.: licitacoes"
              />
              <div id="keyword-section-error" className="field-error">
                <span className="error-badge" role="img" aria-label="Erro">
                  !
                </span>
                <span>A seção de destino deve ter no máximo 80 caracteres.</span>
              </div>
              <datalist id="target-section-options">
                <option value="geral" />
                <option value="licitacoes" />
                <option value="concursos" />
                <option value="portarias" />
                <option value="contratos" />
                <option value="educacao" />
                <option value="saude" />
              </datalist>
            </div>

            <div className="field">
              <label className="field-label" htmlFor="keyword-description">
                Observação / descrição
              </label>
              <input
                id="keyword-description"
                name="description"
                type="text"
                className="field-control"
                value={newDescription}
                onChange={(e) => {
                  e.target.setCustomValidity("");
                  setNewDescription(e.target.value);
                }}
                maxLength={500}
                data-error="keyword-description-error"
                placeholder="Ex.: Acompanhar editais de TI"
              />
              <div id="keyword-description-error" className="field-error">
                <span className="error-badge" role="img" aria-label="Erro">
                  !
                </span>
                <span>Descrição deve ter no máximo 500 caracteres.</span>
              </div>
            </div>
          </div>

          <div className="keywords-toolbar">
            <label className="checkbox-row" htmlFor="keyword-active">
              <input
                id="keyword-active"
                name="is_active"
                type="checkbox"
                className="checkbox-control"
                checked={newActive}
                onChange={(e) => setNewActive(e.target.checked)}
              />
              <span>Monitoramento ativo</span>
            </label>

            <button
              type="submit"
              className="aero-gel-btn aero-gel-btn--eco"
              disabled={kwSubmitting}
            >
              Cadastrar palavra-chave
            </button>
          </div>
        </form>

        <div id="saved-keywords-list" className="keywords-grid">
          {!isAuthenticated ? (
            <div className="empty-state">
              <p>
                <strong>Nenhuma palavra-chave listada.</strong> Faça login para visualizar e
                gerenciar seus termos salvos.
              </p>
            </div>
          ) : kwLoading ? (
            <div className="feedback is-loading">
              <span className="spinner" aria-hidden="true" />
              <span>Carregando palavras-chave salvas…</span>
            </div>
          ) : keywords.length === 0 ? (
            <div className="empty-state">
              <p>
                <strong>Nenhuma palavra-chave salva ainda.</strong>
              </p>
              <p>
                Use o formulário acima ou clique em &ldquo;Salvar termo atual&rdquo; após pesquisar
                nos boletins.
              </p>
            </div>
          ) : (
            keywords.map((item) => {
              const isActive = Number(item.is_active) === 1;
              const isEditing = editingId === item.id;

              return (
                <article key={item.id} className="keyword-card">
                  <div className="keyword-card-top">
                    <button
                      type="button"
                      className="keyword-chip-btn"
                      onClick={() => handleKeywordClick(item)}
                      title="Preencher campo de busca e pesquisar nos Boletins Oficiais"
                    >
                      <span>{item.keyword}</span>
                      <span aria-hidden="true">→</span>
                    </button>

                    <div className="keyword-meta">
                      {item.group_name ? (
                        <span className="badge badge--neutral">
                          <span
                            className="group-swatch"
                            style={{ "--group-color": item.group_color || "#0b7aa8" }}
                            aria-hidden="true"
                          />
                          <span>{item.group_name}</span>
                        </span>
                      ) : null}
                      <span className={`badge badge--${item.priority || "media"}`}>
                        Prioridade: {PRIORITY_LABELS[item.priority] || item.priority}
                      </span>
                      <span className="badge badge--neutral">
                        Seção: {item.target_section || "geral"}
                      </span>
                      <span className={`badge ${isActive ? "badge--active" : "badge--inactive"}`}>
                        {isActive ? "Ativa" : "Pausada"}
                      </span>
                      {typeof item.alert_count === "number" ? (
                        <span className="badge badge--neutral tabular">
                          {item.alert_count} alerta(s)
                        </span>
                      ) : null}
                    </div>
                  </div>

                  {item.description ? (
                    <p className="keyword-description">{item.description}</p>
                  ) : null}

                  <p className="field-hint tabular">
                    Criada em: {formatDateTimePtBr(item.created_at)} · Atualizada em:{" "}
                    {formatDateTimePtBr(item.updated_at)}
                    {item.last_searched_at
                      ? ` · Última varredura: ${formatDateTimePtBr(item.last_searched_at)}`
                      : ""}
                  </p>

                  {isEditing ? (
                    <InlineKeywordEditForm
                      key={item.id}
                      item={item}
                      groups={groups}
                      editValues={editValues}
                      setEditValues={setEditValues}
                      editSaving={editSaving}
                      onCancel={() => setEditingId(null)}
                      onSave={handleSaveEdit}
                    />
                  ) : (
                    <div className="keyword-actions">
                      <button
                        type="button"
                        className="aero-gel-btn aero-gel-btn--sky aero-gel-btn--sm"
                        onClick={() => handleKeywordClick(item)}
                      >
                        Pesquisar nos boletins
                      </button>
                      <button
                        type="button"
                        className="aero-gel-btn aero-gel-btn--eco aero-gel-btn--sm"
                        onClick={() => handleScanKeyword(item)}
                      >
                        Varrer boletins
                      </button>
                      <button
                        type="button"
                        className="aero-gel-btn aero-gel-btn--ghost aero-gel-btn--sm"
                        onClick={() => startEditing(item)}
                      >
                        Editar
                      </button>
                      <button
                        type="button"
                        className="aero-gel-btn aero-gel-btn--ghost aero-gel-btn--sm"
                        onClick={() => handleToggleActive(item)}
                      >
                        {isActive ? "Pausar" : "Ativar"}
                      </button>
                      <button
                        type="button"
                        className="aero-gel-btn aero-gel-btn--danger aero-gel-btn--sm"
                        onClick={() => setDeleteTarget(item)}
                      >
                        Excluir
                      </button>
                    </div>
                  )}
                </article>
              );
            })
          )}
        </div>
      </section>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Excluir palavra-chave?"
        message={
          deleteTarget
            ? `Tem certeza de que deseja excluir "${deleteTarget.keyword}"? Os alertas vinculados também serão removidos.`
            : ""
        }
        confirmLabel="Excluir palavra-chave"
        cancelLabel="Cancelar"
        onConfirm={handleConfirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </>
  );
}
