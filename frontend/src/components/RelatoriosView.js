"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "./AuthProvider";
import FeedbackBanner from "./FeedbackBanner";
import { fetchGroups, fetchReports } from "../lib/api";
import { useAccessibleFormAria } from "../lib/formAria";
import { formatDatePtBr, formatDateTimePtBr } from "../lib/validation";

const PRIORITY_LABELS = {
  alta: "Alta",
  media: "Média",
  baixa: "Baixa"
};

const ALERT_STATUS_LABELS = {
  novo: "Novo",
  revisado: "Revisado",
  arquivado: "Arquivado"
};

const EMPTY_FILTERS = {
  q: "",
  group_id: "",
  priority: "",
  active: "",
  status: "",
  from: "",
  to: ""
};

export default function RelatoriosView() {
  const { token, loading, isAuthenticated } = useAuth();
  const filterFormRef = useRef(null);
  const fromInputRef = useRef(null);
  const appliedFiltersRef = useRef({ ...EMPTY_FILTERS });
  const requestIdRef = useRef(0);

  useAccessibleFormAria(filterFormRef, !loading && isAuthenticated);

  const [groups, setGroups] = useState([]);
  const [report, setReport] = useState(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [feedback, setFeedback] = useState({ message: "", state: "info" });

  // Draft filter inputs (committed only on explicit form submit / reset)
  const [q, setQ] = useState("");
  const [groupId, setGroupId] = useState("");
  const [priority, setPriority] = useState("");
  const [active, setActive] = useState("");
  const [status, setStatus] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const loadReports = useCallback(
    async (overrideFilters = null) => {
      if (!isAuthenticated || !token) return;
      const requestId = ++requestIdRef.current;
      const activeFilters =
        overrideFilters !== null ? overrideFilters : appliedFiltersRef.current;

      setReportLoading(true);
      setFeedback({ message: "Gerando relatórios filtrados…", state: "loading" });

      try {
        const [grpRes, repRes] = await Promise.all([
          fetchGroups({}, { token }),
          fetchReports(activeFilters, { token })
        ]);
        if (requestId !== requestIdRef.current) return;

        setGroups(Array.isArray(grpRes?.groups) ? grpRes.groups : []);
        setReport(repRes || null);
        setFeedback({ message: "", state: "info" });
      } catch (err) {
        if (requestId !== requestIdRef.current) return;
        setFeedback({
          message: err?.message || "Não foi possível carregar os relatórios.",
          state: "error"
        });
      } finally {
        if (requestId === requestIdRef.current) {
          setReportLoading(false);
        }
      }
    },
    [isAuthenticated, token]
  );

  useEffect(() => {
    if (!loading && isAuthenticated && token) {
      loadReports(appliedFiltersRef.current);
    }
  }, [loading, isAuthenticated, token, loadReports]);

  const handleApplyFilters = (event) => {
    event.preventDefault();
    if (from && to && from > to) {
      const msg = "A data inicial não pode ser posterior à data final.";
      if (fromInputRef.current) {
        fromInputRef.current.setCustomValidity(msg);
        filterFormRef.current?.checkValidity();
        fromInputRef.current.focus();
      }
      setFeedback({ message: msg, state: "error" });
      return;
    }
    if (fromInputRef.current) {
      fromInputRef.current.setCustomValidity("");
    }

    const nextFilters = {
      q,
      group_id: groupId,
      priority,
      active,
      status,
      from,
      to
    };
    appliedFiltersRef.current = nextFilters;
    loadReports(nextFilters);
  };

  const handleResetFilters = () => {
    setQ("");
    setGroupId("");
    setPriority("");
    setActive("");
    setStatus("");
    setFrom("");
    setTo("");
    if (fromInputRef.current) {
      fromInputRef.current.setCustomValidity("");
    }
    const nextFilters = { ...EMPTY_FILTERS };
    appliedFiltersRef.current = nextFilters;
    loadReports(nextFilters);
  };

  if (loading) {
    return (
      <section className="hero-panel">
        <h1 id="conteudo-principal" tabIndex={-1}>
          Relatórios e Consultas
        </h1>
        <div className="feedback is-loading">
          <span className="spinner" aria-hidden="true" />
          <span>Verificando sessão…</span>
        </div>
      </section>
    );
  }

  if (!isAuthenticated) {
    return (
      <section className="hero-panel auth-guard-panel">
        <p className="eyebrow">Área autenticada · RF005 / RF009</p>
        <h1 id="conteudo-principal" tabIndex={-1}>
          Relatórios de Monitoramento
        </h1>
        <p className="lead">
          Entre na sua conta para consultar relatórios por grupo, prioridade, status de alerta e
          período de publicação.
        </p>
        <div className="form-actions">
          <Link href="/login" className="aero-gel-btn">
            Entrar
          </Link>
          <Link href="/cadastro" className="aero-gel-btn aero-gel-btn--eco">
            Criar conta
          </Link>
        </div>
      </section>
    );
  }

  const summary = report?.summary || {};
  const byGroup = Array.isArray(report?.by_group) ? report.by_group : [];
  const byPriority = Array.isArray(report?.by_priority) ? report.by_priority : [];
  const keywords = Array.isArray(report?.keywords) ? report.keywords : [];
  const alerts = Array.isArray(report?.alerts) ? report.alerts : [];
  const totalKeywordsForBar = Math.max(Number(summary.total_keywords || 0), 1);

  return (
    <>
      <section className="hero-panel">
        <p className="eyebrow">Relatórios organizados · RF005</p>
        <h1 id="conteudo-principal" tabIndex={-1}>
          Relatórios e Indicadores de Monitoramento
        </h1>
        <p className="lead">
          Filtre palavras-chave, grupos temáticos, prioridades e ocorrências registradas nos
          Boletins Oficiais.
        </p>

        <search>
          <form
            ref={filterFormRef}
            className="filter-bar"
            style={{ marginBlockStart: "1.25rem" }}
            onSubmit={handleApplyFilters}
            noValidate
          >
            <div className="form-row-3">
              <div className="field">
                <label className="field-label" htmlFor="rep-q">
                  Termo ou descrição
                </label>
                <input
                  id="rep-q"
                  name="q"
                  type="search"
                  className="field-control"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Ex.: pregão, nomeação"
                />
              </div>

              <div className="field">
                <label className="field-label" htmlFor="rep-group">
                  Grupo
                </label>
                <select
                  id="rep-group"
                  name="group_id"
                  className="field-control"
                  value={groupId}
                  onChange={(e) => setGroupId(e.target.value)}
                >
                  <option value="">Todos os grupos</option>
                  {groups.map((grp) => (
                    <option key={grp.id} value={String(grp.id)}>
                      {grp.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="field">
                <label className="field-label" htmlFor="rep-priority">
                  Prioridade
                </label>
                <select
                  id="rep-priority"
                  name="priority"
                  className="field-control"
                  value={priority}
                  onChange={(e) => setPriority(e.target.value)}
                >
                  <option value="">Todas</option>
                  <option value="alta">Alta</option>
                  <option value="media">Média</option>
                  <option value="baixa">Baixa</option>
                </select>
              </div>
            </div>

            <div className="form-row-3">
              <div className="field">
                <label className="field-label" htmlFor="rep-active">
                  Situação da palavra-chave
                </label>
                <select
                  id="rep-active"
                  name="active"
                  className="field-control"
                  value={active}
                  onChange={(e) => setActive(e.target.value)}
                >
                  <option value="">Todas</option>
                  <option value="1">Somente ativas</option>
                  <option value="0">Somente pausadas</option>
                </select>
              </div>

              <div className="field">
                <label className="field-label" htmlFor="rep-status">
                  Status dos alertas
                </label>
                <select
                  id="rep-status"
                  name="status"
                  className="field-control"
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                >
                  <option value="">Todos</option>
                  <option value="novo">Novo</option>
                  <option value="revisado">Revisado</option>
                  <option value="arquivado">Arquivado</option>
                </select>
              </div>

              <div className="form-row-2">
                <div className="field">
                  <label className="field-label" htmlFor="rep-from">
                    De (data)
                  </label>
                  <input
                    ref={fromInputRef}
                    id="rep-from"
                    name="from"
                    type="date"
                    className="field-control"
                    value={from}
                    onChange={(e) => {
                      e.target.setCustomValidity("");
                      setFrom(e.target.value);
                    }}
                    data-error="rep-from-error"
                  />
                  <div id="rep-from-error" className="field-error">
                    <span className="error-badge" role="img" aria-label="Erro">
                      !
                    </span>
                    <span>A data inicial não pode ser posterior à data final.</span>
                  </div>
                </div>
                <div className="field">
                  <label className="field-label" htmlFor="rep-to">
                    Até (data)
                  </label>
                  <input
                    id="rep-to"
                    name="to"
                    type="date"
                    className="field-control"
                    value={to}
                    onChange={(e) => {
                      fromInputRef.current?.setCustomValidity("");
                      setTo(e.target.value);
                    }}
                  />
                </div>
              </div>
            </div>

            <div className="form-actions">
              <button
                type="submit"
                className="aero-gel-btn"
                disabled={reportLoading}
              >
                Aplicar filtros
              </button>
              <button
                type="button"
                className="aero-gel-btn aero-gel-btn--ghost"
                onClick={handleResetFilters}
                disabled={reportLoading}
              >
                Limpar filtros
              </button>
            </div>
          </form>
        </search>
      </section>

      <FeedbackBanner
        id="reports-feedback"
        message={feedback.message}
        state={feedback.state}
      />

      {/* 1. Summary KPIs */}
      <section className="status-grid" aria-label="Resumo quantitativo do relatório">
        <article className="status-card">
          <div className="status-body">
            <span className="status-label">Palavras-chave filtradas</span>
            <strong className="status-value tabular">
              {Number(summary.total_keywords ?? keywords.length).toLocaleString("pt-BR")}
            </strong>
            <span className="status-sub tabular">
              {Number(summary.active_keywords ?? 0)} ativa(s) ·{" "}
              {Number(summary.inactive_keywords ?? 0)} pausada(s)
            </span>
          </div>
        </article>

        <article className="status-card">
          <div className="status-body">
            <span className="status-label">Grupos cadastrados</span>
            <strong className="status-value tabular">
              {Number(summary.total_groups ?? byGroup.length).toLocaleString("pt-BR")}
            </strong>
          </div>
        </article>

        <article className="status-card">
          <div className="status-body">
            <span className="status-label">Alertas no recorte</span>
            <strong className="status-value tabular">
              {Number(summary.total_alerts ?? alerts.length).toLocaleString("pt-BR")}
            </strong>
            <span className="status-sub tabular">
              {Number(summary.new_alerts ?? 0)} novo(s)
            </span>
          </div>
        </article>
      </section>

      {/* 2. Report by Group */}
      <section className="doc-surface" aria-labelledby="rep-group-heading">
        <div className="section-header">
          <h2 id="rep-group-heading">Distribuição por grupo</h2>
        </div>

        {byGroup.length === 0 ? (
          <div className="empty-state">
            <p>Nenhum dado por grupo disponível para os filtros selecionados.</p>
          </div>
        ) : (
          <div className="breakdown-grid">
            {byGroup.map((grp, idx) => {
              const count = Number(grp.keyword_count ?? grp.total_keywords ?? 0);
              const pct = Math.min(100, Math.round((count / totalKeywordsForBar) * 100));
              return (
                <article key={grp.group_id ?? grp.id ?? idx} className="breakdown-card">
                  <div className="keyword-card-top">
                    <strong style={{ display: "flex", alignItems: "center", gap: "0.45rem" }}>
                      <span
                        className="group-swatch"
                        style={{ "--group-color": grp.color || "#0b7aa8" }}
                        aria-hidden="true"
                      />
                      <span>{grp.group_name || grp.name || "Sem grupo"}</span>
                    </strong>
                    <span className="meta-pill tabular">{count} termo(s)</span>
                  </div>
                  <div className="proportion-bar" aria-hidden="true">
                    <div className="proportion-fill" style={{ width: `${pct}%` }} />
                  </div>
                  <span className="field-hint tabular">
                    {Number(grp.alert_count ?? 0)} alerta(s) associado(s)
                  </span>
                </article>
              );
            })}
          </div>
        )}
      </section>

      {/* 3. Report by Priority */}
      <section className="doc-surface" aria-labelledby="rep-priority-heading">
        <div className="section-header">
          <h2 id="rep-priority-heading">Distribuição por prioridade</h2>
        </div>

        {byPriority.length === 0 ? (
          <div className="empty-state">
            <p>Nenhum dado por prioridade para os filtros atuais.</p>
          </div>
        ) : (
          <div className="breakdown-grid">
            {byPriority.map((item, idx) => {
              const prioKey = item.priority || "media";
              const count = Number(item.keyword_count ?? item.total ?? 0);
              const pct = Math.min(100, Math.round((count / totalKeywordsForBar) * 100));
              return (
                <article key={`${prioKey}-${idx}`} className="breakdown-card">
                  <div className="keyword-card-top">
                    <span className={`badge badge--${prioKey}`}>
                      {PRIORITY_LABELS[prioKey] || prioKey}
                    </span>
                    <span className="meta-pill tabular">{count} palavra(s)-chave</span>
                  </div>
                  <div className="proportion-bar" aria-hidden="true">
                    <div className="proportion-fill" style={{ width: `${pct}%` }} />
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      {/* 4. Filtered Keywords Table */}
      <section className="doc-surface" aria-labelledby="rep-keywords-heading">
        <div className="section-header">
          <h2 id="rep-keywords-heading">Palavras-chave filtradas</h2>
          <span className="badge badge--neutral tabular">{keywords.length} registro(s)</span>
        </div>

        {keywords.length === 0 ? (
          <div className="empty-state">
            <p>Nenhuma palavra-chave corresponde aos filtros aplicados.</p>
          </div>
        ) : (
          <div
            tabIndex={0}
            role="region"
            aria-labelledby="rep-keywords-table-caption"
            className="table-wrapper"
          >
            <table
              className="aero-table"
              style={{
                "--label-1": '"Palavra-chave"',
                "--label-2": '"Grupo"',
                "--label-3": '"Prioridade"',
                "--label-4": '"Seção"',
                "--label-5": '"Status"',
                "--label-6": '"Atualização"'
              }}
            >
              <caption id="rep-keywords-table-caption">
                Relatório detalhado de palavras-chave monitoradas
              </caption>
              <thead>
                <tr>
                  <th scope="col">Palavra-chave</th>
                  <th scope="col">Grupo</th>
                  <th scope="col">Prioridade</th>
                  <th scope="col">Seção</th>
                  <th scope="col">Status</th>
                  <th scope="col">Atualização</th>
                </tr>
              </thead>
              <tbody>
                {keywords.map((kw) => {
                  const isActive = Number(kw.is_active) === 1;
                  return (
                    <tr key={kw.id}>
                      <th scope="row">{kw.keyword}</th>
                      <td>{kw.group_name || "Sem grupo"}</td>
                      <td>
                        <span className={`badge badge--${kw.priority || "media"}`}>
                          {PRIORITY_LABELS[kw.priority] || kw.priority}
                        </span>
                      </td>
                      <td>{kw.target_section || "geral"}</td>
                      <td>
                        <span
                          className={`badge ${isActive ? "badge--active" : "badge--inactive"}`}
                        >
                          {isActive ? "Ativa" : "Pausada"}
                        </span>
                      </td>
                      <td className="tabular">{formatDateTimePtBr(kw.updated_at)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* 5. Filtered Alerts Table */}
      <section className="doc-surface" aria-labelledby="rep-alerts-heading">
        <div className="section-header">
          <h2 id="rep-alerts-heading">Alertas e ocorrências</h2>
          <span className="badge badge--neutral tabular">{alerts.length} registro(s)</span>
        </div>

        {alerts.length === 0 ? (
          <div className="empty-state">
            <p>Nenhum alerta encontrado para os filtros aplicados.</p>
          </div>
        ) : (
          <div
            tabIndex={0}
            role="region"
            aria-labelledby="rep-alerts-table-caption"
            className="table-wrapper"
          >
            <table
              className="aero-table"
              style={{
                "--label-1": '"Palavra-chave"',
                "--label-2": '"Status"',
                "--label-3": '"Edição"',
                "--label-4": '"Publicação"',
                "--label-5": '"Observações"'
              }}
            >
              <caption id="rep-alerts-table-caption">
                Relatório de alertas gerados nos Boletins Oficiais
              </caption>
              <thead>
                <tr>
                  <th scope="col">Palavra-chave</th>
                  <th scope="col">Status</th>
                  <th scope="col">Edição</th>
                  <th scope="col">Publicação</th>
                  <th scope="col">Observações</th>
                </tr>
              </thead>
              <tbody>
                {alerts.map((al) => (
                  <tr key={al.id}>
                    <th scope="row">{al.keyword || `#${al.keyword_id}`}</th>
                    <td>
                      <span className={`badge badge--status-${al.status || "novo"}`}>
                        {ALERT_STATUS_LABELS[al.status] || al.status}
                      </span>
                    </td>
                    <td className="tabular">
                      {al.document_edition ? `Edição ${al.document_edition}` : "Manual"}
                    </td>
                    <td className="tabular">
                      {al.document_published_at
                        ? formatDatePtBr(al.document_published_at)
                        : formatDateTimePtBr(al.created_at)}
                    </td>
                    <td>{al.notes || al.matched_excerpt || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
