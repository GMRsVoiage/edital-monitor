"use client";

import Link from "next/link";
import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "./AuthProvider";
import ConfirmDialog from "./ConfirmDialog";
import FeedbackBanner from "./FeedbackBanner";
import {
  createAlert,
  createGroup,
  deleteAlert,
  deleteGroup,
  fetchAlerts,
  fetchGroups,
  fetchKeywords,
  scanKeyword,
  updateAlert,
  updateGroup
} from "../lib/api";
import { useAccessibleFormAria } from "../lib/formAria";
import {
  formatDateTimePtBr,
  isHttpUrl,
  parseSafeExcerpt,
  validateAlertInput,
  validateGroupInput
} from "../lib/validation";

const ALERT_STATUS_LABELS = {
  novo: "Novo",
  revisado: "Revisado",
  arquivado: "Arquivado"
};

function applyCustomValidity(form, fieldName, message) {
  const target = fieldName ? form?.elements?.namedItem?.(fieldName) : null;
  if (target && typeof target.setCustomValidity === "function") {
    target.setCustomValidity(message);
  }
}

function InlineGroupEditForm({ group, initialValues, onSave, onCancel }) {
  const formRef = useRef(null);
  useAccessibleFormAria(formRef);
  const [values, setValues] = useState(initialValues);
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (event) => {
    event.preventDefault();
    const form = formRef.current || event.currentTarget;
    const check = validateGroupInput(values);
    if (!check.valid) {
      applyCustomValidity(form, check.field, check.error);
      form?.checkValidity();
      form?.querySelector(":invalid")?.focus();
      onSave(null, check.error);
      return;
    }

    setSaving(true);
    try {
      await onSave(check.value, null);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form
      ref={formRef}
      className="keyword-edit-form"
      onSubmit={handleSubmit}
      noValidate
    >
      <div className="field">
        <label className="field-label" htmlFor={`edit-grp-name-${group.id}`}>
          Nome <span aria-hidden="true">*</span>
        </label>
        <input
          id={`edit-grp-name-${group.id}`}
          name="name"
          type="text"
          className="field-control"
          value={values.name}
          onChange={(e) => {
            e.target.setCustomValidity("");
            setValues((prev) => ({ ...prev, name: e.target.value }));
          }}
          minLength={2}
          maxLength={80}
          data-error={`edit-grp-name-error-${group.id}`}
          required
        />
        <div id={`edit-grp-name-error-${group.id}`} className="field-error">
          <span className="error-badge" role="img" aria-label="Erro">
            !
          </span>
          <span>O nome do grupo deve ter entre 2 e 80 caracteres.</span>
        </div>
      </div>

      <div className="field">
        <label className="field-label" htmlFor={`edit-grp-desc-${group.id}`}>
          Descrição
        </label>
        <input
          id={`edit-grp-desc-${group.id}`}
          name="description"
          type="text"
          className="field-control"
          value={values.description}
          onChange={(e) => {
            e.target.setCustomValidity("");
            setValues((prev) => ({ ...prev, description: e.target.value }));
          }}
          maxLength={500}
          data-error={`edit-grp-desc-error-${group.id}`}
        />
        <div id={`edit-grp-desc-error-${group.id}`} className="field-error">
          <span className="error-badge" role="img" aria-label="Erro">
            !
          </span>
          <span>A descrição do grupo deve ter no máximo 500 caracteres.</span>
        </div>
      </div>

      <div className="field">
        <label className="field-label" htmlFor={`edit-grp-color-${group.id}`}>
          Cor
        </label>
        <input
          id={`edit-grp-color-${group.id}`}
          name="color"
          type="color"
          className="field-control"
          value={values.color}
          onChange={(e) => {
            e.target.setCustomValidity("");
            setValues((prev) => ({ ...prev, color: e.target.value }));
          }}
          data-error={`edit-grp-color-error-${group.id}`}
        />
        <div id={`edit-grp-color-error-${group.id}`} className="field-error">
          <span className="error-badge" role="img" aria-label="Erro">
            !
          </span>
          <span>Informe uma cor hexadecimal válida.</span>
        </div>
      </div>

      <div className="keyword-actions">
        <button
          type="button"
          className="aero-gel-btn aero-gel-btn--ghost aero-gel-btn--sm"
          onClick={onCancel}
          disabled={saving}
        >
          Cancelar
        </button>
        <button
          type="submit"
          className="aero-gel-btn aero-gel-btn--eco aero-gel-btn--sm"
          disabled={saving}
        >
          Salvar
        </button>
      </div>
    </form>
  );
}

function AlertTriageForm({ alertItem, draft, onDraftChange, onSave, onDelete }) {
  const formRef = useRef(null);
  useAccessibleFormAria(formRef);
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (event) => {
    event.preventDefault();
    const form = formRef.current || event.currentTarget;
    const check = validateAlertInput({ status: draft.status, notes: draft.notes });
    if (!check.valid) {
      applyCustomValidity(form, check.field, check.error);
      form?.checkValidity();
      form?.querySelector(":invalid")?.focus();
      onSave(alertItem.id, null, check.error);
      return;
    }

    setSaving(true);
    try {
      await onSave(alertItem.id, check.value, null);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form
      ref={formRef}
      className="alert-notes-form"
      onSubmit={handleSubmit}
      noValidate
    >
      <div className="form-row-2">
        <div className="field">
          <label className="field-label" htmlFor={`al-status-${alertItem.id}`}>
            Status de triagem
          </label>
          <select
            id={`al-status-${alertItem.id}`}
            name="status"
            className="field-control"
            value={draft.status}
            onChange={(e) => {
              e.target.setCustomValidity("");
              onDraftChange(alertItem.id, { ...draft, status: e.target.value });
            }}
            data-error={`al-status-error-${alertItem.id}`}
          >
            <option value="novo">Novo</option>
            <option value="revisado">Revisado</option>
            <option value="arquivado">Arquivado</option>
          </select>
          <div id={`al-status-error-${alertItem.id}`} className="field-error">
            <span className="error-badge" role="img" aria-label="Erro">
              !
            </span>
            <span>Status de alerta inválido.</span>
          </div>
        </div>

        <div className="field">
          <label className="field-label" htmlFor={`al-notes-${alertItem.id}`}>
            Observações
          </label>
          <input
            id={`al-notes-${alertItem.id}`}
            name="notes"
            type="text"
            className="field-control"
            value={draft.notes}
            onChange={(e) => {
              e.target.setCustomValidity("");
              onDraftChange(alertItem.id, { ...draft, notes: e.target.value });
            }}
            maxLength={1000}
            data-error={`al-notes-error-${alertItem.id}`}
          />
          <div id={`al-notes-error-${alertItem.id}`} className="field-error">
            <span className="error-badge" role="img" aria-label="Erro">
              !
            </span>
            <span>Observações devem ter no máximo 1000 caracteres.</span>
          </div>
        </div>
      </div>

      <div className="keyword-actions">
        <button
          type="submit"
          className="aero-gel-btn aero-gel-btn--eco aero-gel-btn--sm"
          disabled={saving}
        >
          Salvar triagem
        </button>
        <button
          type="button"
          className="aero-gel-btn aero-gel-btn--danger aero-gel-btn--sm"
          onClick={() => onDelete(alertItem)}
          disabled={saving}
        >
          Excluir alerta
        </button>
      </div>
    </form>
  );
}

export default function GruposView() {
  const { token, loading, isAuthenticated } = useAuth();
  const groupFormRef = useRef(null);
  const alertFormRef = useRef(null);

  const formsActive = !loading && isAuthenticated;
  useAccessibleFormAria(groupFormRef, formsActive);
  useAccessibleFormAria(alertFormRef, formsActive);

  const appliedFiltersRef = useRef({ status: "", keyword_id: "", q: "" });
  const requestIdRef = useRef(0);

  const [groups, setGroups] = useState([]);
  const [keywords, setKeywords] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [dataLoading, setDataLoading] = useState(false);

  const [groupFeedback, setGroupFeedback] = useState({ message: "", state: "info" });
  const [alertFeedback, setAlertFeedback] = useState({ message: "", state: "info" });

  // New group form
  const [groupName, setGroupName] = useState("");
  const [groupDescription, setGroupDescription] = useState("");
  const [groupColor, setGroupColor] = useState("#0b7aa8");
  const [creatingGroup, setCreatingGroup] = useState(false);

  // Edit group state
  const [editingGroupId, setEditingGroupId] = useState(null);
  const [editGroupValues, setEditGroupValues] = useState({
    name: "",
    description: "",
    color: "#0b7aa8"
  });

  // Draft alert filters & scan
  const [filterStatus, setFilterStatus] = useState("");
  const [filterKeywordId, setFilterKeywordId] = useState("");
  const [filterQuery, setFilterQuery] = useState("");
  const [scanKeywordId, setScanKeywordId] = useState("");

  // New alert form
  const [alertKeywordId, setAlertKeywordId] = useState("");
  const [alertStatus, setAlertStatus] = useState("novo");
  const [alertExcerpt, setAlertExcerpt] = useState("");
  const [alertNotes, setAlertNotes] = useState("");
  const [creatingAlert, setCreatingAlert] = useState(false);

  // Alert note/status drafts keyed by alert id (preserved across reloads/filtering)
  const [alertDrafts, setAlertDrafts] = useState({});

  // Confirm delete dialog
  const [deleteTarget, setDeleteTarget] = useState(null);

  const loadData = useCallback(
    async (overrideFilters = null, { resetDraftIds = null } = {}) => {
      if (!isAuthenticated || !token) return;
      const requestId = ++requestIdRef.current;
      const activeFilters =
        overrideFilters !== null ? overrideFilters : appliedFiltersRef.current;

      setDataLoading(true);
      try {
        const [grpRes, kwRes, altRes] = await Promise.all([
          fetchGroups({}, { token }),
          fetchKeywords({}, { token }),
          fetchAlerts(activeFilters, { token })
        ]);
        if (requestId !== requestIdRef.current) return;

        const nextGroups = Array.isArray(grpRes?.groups) ? grpRes.groups : [];
        const nextKeywords = Array.isArray(kwRes?.keywords) ? kwRes.keywords : [];
        const nextAlerts = Array.isArray(altRes?.alerts) ? altRes.alerts : [];

        setGroups(nextGroups);
        setKeywords(nextKeywords);
        setAlerts(nextAlerts);

        if (nextKeywords.length > 0) {
          setAlertKeywordId((prev) => prev || String(nextKeywords[0].id));
          setScanKeywordId((prev) => prev || String(nextKeywords[0].id));
        }

        const resetSet = new Set(Array.isArray(resetDraftIds) ? resetDraftIds : []);
        setAlertDrafts((prev) => {
          const next = { ...prev };
          for (const a of nextAlerts) {
            if (resetSet.has(a.id) || !(a.id in next)) {
              next[a.id] = {
                status: a.status || "novo",
                notes: a.notes || ""
              };
            }
          }
          return next;
        });
      } catch (err) {
        if (requestId !== requestIdRef.current) return;
        setGroupFeedback({
          message: err?.message || "Erro ao carregar grupos e alertas.",
          state: "error"
        });
      } finally {
        if (requestId === requestIdRef.current) {
          setDataLoading(false);
        }
      }
    },
    [isAuthenticated, token]
  );

  useEffect(() => {
    if (!loading && isAuthenticated && token) {
      loadData(appliedFiltersRef.current);
    }
  }, [loading, isAuthenticated, token, loadData]);

  const handleCreateGroup = async (event) => {
    event.preventDefault();
    const check = validateGroupInput({
      name: groupName,
      description: groupDescription,
      color: groupColor
    });
    if (!check.valid) {
      applyCustomValidity(groupFormRef.current, check.field, check.error);
      groupFormRef.current?.checkValidity();
      const firstInvalid = groupFormRef.current?.querySelector(":invalid");
      firstInvalid?.focus();
      setGroupFeedback({ message: check.error, state: "error" });
      return;
    }

    setCreatingGroup(true);
    setGroupFeedback({ message: "Criando grupo…", state: "loading" });
    try {
      await createGroup(check.value, { token });
      setGroupName("");
      setGroupDescription("");
      setGroupColor("#0b7aa8");
      setGroupFeedback({
        message: `Grupo "${check.value.name}" criado com sucesso.`,
        state: "ok"
      });
      await loadData();
    } catch (err) {
      setGroupFeedback({
        message: err?.message || "Erro ao criar grupo.",
        state: "error"
      });
    } finally {
      setCreatingGroup(false);
    }
  };

  const handleSaveGroupEdit = async (id, validatedValue, validationError) => {
    if (validationError || !validatedValue) {
      setGroupFeedback({
        message: validationError || "Dados inválidos para atualização do grupo.",
        state: "error"
      });
      return;
    }

    try {
      await updateGroup(id, validatedValue, { token, method: "PUT" });
      setEditingGroupId(null);
      setGroupFeedback({
        message: `Grupo "${validatedValue.name}" atualizado com sucesso.`,
        state: "ok"
      });
      await loadData();
    } catch (err) {
      setGroupFeedback({
        message: err?.message || "Erro ao atualizar grupo.",
        state: "error"
      });
    }
  };

  const handleScanSelectedKeyword = async () => {
    if (!scanKeywordId) {
      setAlertFeedback({
        message: "Selecione uma palavra-chave para varrer os boletins.",
        state: "error"
      });
      return;
    }

    setAlertFeedback({ message: "Varrendo boletins oficiais…", state: "loading" });
    try {
      const res = await scanKeyword(scanKeywordId, { token });
      setAlertFeedback({
        message: `Varredura concluída: ${Number(res?.matched_documents || 0)} documento(s) encontrado(s) e ${Number(res?.created_alerts || 0)} alerta(s) criado(s).`,
        state: "ok"
      });
      await loadData();
    } catch (err) {
      setAlertFeedback({
        message: err?.message || "Erro ao executar varredura.",
        state: "error"
      });
    }
  };

  const handleCreateAlert = async (event) => {
    event.preventDefault();
    const check = validateAlertInput(
      {
        keyword_id: alertKeywordId,
        status: alertStatus,
        matched_excerpt: alertExcerpt,
        notes: alertNotes
      },
      { requireKeywordId: true }
    );
    if (!check.valid) {
      applyCustomValidity(alertFormRef.current, check.field, check.error);
      alertFormRef.current?.checkValidity();
      const firstInvalid = alertFormRef.current?.querySelector(":invalid");
      firstInvalid?.focus();
      setAlertFeedback({ message: check.error, state: "error" });
      return;
    }

    setCreatingAlert(true);
    setAlertFeedback({ message: "Registrando alerta…", state: "loading" });
    try {
      await createAlert(check.value, { token });
      setAlertExcerpt("");
      setAlertNotes("");
      setAlertStatus("novo");
      setAlertFeedback({
        message: "Alerta registrado com sucesso.",
        state: "ok"
      });
      await loadData();
    } catch (err) {
      setAlertFeedback({
        message: err?.message || "Erro ao registrar alerta.",
        state: "error"
      });
    } finally {
      setCreatingAlert(false);
    }
  };

  const handleUpdateAlert = async (alertId, validatedValue, validationError) => {
    if (validationError || !validatedValue) {
      setAlertFeedback({
        message: validationError || "Dados inválidos para atualizar o alerta.",
        state: "error"
      });
      return;
    }

    try {
      await updateAlert(alertId, validatedValue, { token, method: "PATCH" });
      setAlertFeedback({
        message: "Alerta atualizado com sucesso.",
        state: "ok"
      });
      await loadData(appliedFiltersRef.current, { resetDraftIds: [alertId] });
    } catch (err) {
      setAlertFeedback({
        message: err?.message || "Erro ao atualizar alerta.",
        state: "error"
      });
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    const target = deleteTarget;
    setDeleteTarget(null);

    if (target.type === "group") {
      try {
        await deleteGroup(target.item.id, { token });
        setGroupFeedback({
          message: `Grupo "${target.item.name}" excluído com sucesso.`,
          state: "ok"
        });
        await loadData();
      } catch (err) {
        if (err?.status === 409) {
          setGroupFeedback({
            message:
              err.message ||
              "Não é possível excluir este grupo porque existem palavras-chave vinculadas a ele. Reatribua ou exclua essas palavras-chave primeiro.",
            state: "error"
          });
        } else {
          setGroupFeedback({
            message: err?.message || "Erro ao excluir grupo.",
            state: "error"
          });
        }
      }
    } else if (target.type === "alert") {
      try {
        await deleteAlert(target.item.id, { token });
        setAlertDrafts((prev) => {
          const next = { ...prev };
          delete next[target.item.id];
          return next;
        });
        setAlertFeedback({
          message: "Alerta excluído com sucesso.",
          state: "ok"
        });
        await loadData();
      } catch (err) {
        setAlertFeedback({
          message: err?.message || "Erro ao excluir alerta.",
          state: "error"
        });
      }
    }
  };

  const handleFilterAlerts = (event) => {
    event.preventDefault();
    const nextFilters = {
      status: filterStatus,
      keyword_id: filterKeywordId,
      q: filterQuery
    };
    appliedFiltersRef.current = nextFilters;
    loadData(nextFilters);
  };

  const handleResetAlertFilters = () => {
    setFilterQuery("");
    setFilterStatus("");
    setFilterKeywordId("");
    const emptyFilters = { status: "", keyword_id: "", q: "" };
    appliedFiltersRef.current = emptyFilters;
    loadData(emptyFilters);
  };

  const handleDraftChange = useCallback((alertId, nextDraft) => {
    setAlertDrafts((prev) => ({
      ...prev,
      [alertId]: nextDraft
    }));
  }, []);

  if (loading) {
    return (
      <section className="hero-panel">
        <h1 id="conteudo-principal" tabIndex={-1}>
          Grupos e Alertas
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
        <p className="eyebrow">Área autenticada · RF008 / RF009</p>
        <h1 id="conteudo-principal" tabIndex={-1}>
          Grupos Temáticos e Alertas de Ocorrência
        </h1>
        <p className="lead">
          Entre na sua conta para organizar suas palavras-chave em grupos e acompanhar alertas
          gerados nos Boletins Oficiais.
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

  return (
    <div className="dual-panels">
      <section className="hero-panel">
        <p className="eyebrow">Entidades relacionadas · RF008</p>
        <h1 id="conteudo-principal" tabIndex={-1}>
          Grupos Temáticos e Alertas
        </h1>
        <p className="lead">
          Organize palavras-chave em grupos temáticos (com proteção de integridade na exclusão) e
          faça a triagem de alertas encontrados nos Boletins Oficiais.
        </p>
      </section>

      <section className="doc-surface" aria-labelledby="groups-heading">
        <div className="section-header">
          <div>
            <h2 id="groups-heading">Grupos de palavras-chave</h2>
            <p className="section-subtitle">
              Grupos vinculados a palavras-chave não podem ser excluídos até que os termos sejam
              movidos ou removidos.
            </p>
          </div>
          <span className="badge badge--neutral tabular">{groups.length} grupo(s)</span>
        </div>

        <FeedbackBanner
          id="groups-feedback"
          message={groupFeedback.message}
          state={groupFeedback.state}
        />

        <form
          ref={groupFormRef}
          className="aero-form"
          aria-labelledby="groups-heading"
          onSubmit={handleCreateGroup}
          noValidate
        >
          <div className="form-row-3">
            <div className="field">
              <label className="field-label" htmlFor="group-name">
                Nome do grupo <span aria-hidden="true">*</span>
              </label>
              <input
                id="group-name"
                name="name"
                type="text"
                className="field-control"
                value={groupName}
                onChange={(e) => {
                  e.target.setCustomValidity("");
                  setGroupName(e.target.value);
                }}
                minLength={2}
                maxLength={80}
                data-error="group-name-error"
                placeholder="Ex.: Licitações e Pregões"
                required
              />
              <div id="group-name-error" className="field-error">
                <span className="error-badge" role="img" aria-label="Erro">
                  !
                </span>
                <span>O nome do grupo deve ter entre 2 e 80 caracteres.</span>
              </div>
            </div>

            <div className="field">
              <label className="field-label" htmlFor="group-description">
                Descrição
              </label>
              <input
                id="group-description"
                name="description"
                type="text"
                className="field-control"
                value={groupDescription}
                onChange={(e) => {
                  e.target.setCustomValidity("");
                  setGroupDescription(e.target.value);
                }}
                maxLength={500}
                data-error="group-description-error"
                placeholder="Ex.: Editais e contratos de tecnologia"
              />
              <div id="group-description-error" className="field-error">
                <span className="error-badge" role="img" aria-label="Erro">
                  !
                </span>
                <span>A descrição do grupo deve ter no máximo 500 caracteres.</span>
              </div>
            </div>

            <div className="field">
              <label className="field-label" htmlFor="group-color">
                Cor identificadora
              </label>
              <div className="color-swatch-row">
                <input
                  id="group-color"
                  name="color"
                  type="color"
                  className="field-control"
                  value={groupColor}
                  onChange={(e) => {
                    e.target.setCustomValidity("");
                    setGroupColor(e.target.value);
                  }}
                />
                <span className="meta-pill">{groupColor}</span>
              </div>
            </div>
          </div>

          <div className="form-actions">
            <button
              type="submit"
              className="aero-gel-btn aero-gel-btn--eco"
              disabled={creatingGroup}
            >
              Criar grupo
            </button>
          </div>
        </form>

        <div className="groups-grid" style={{ marginBlockStart: "1.25rem" }}>
          {dataLoading && groups.length === 0 ? (
            <div className="feedback is-loading">
              <span className="spinner" aria-hidden="true" />
              <span>Carregando grupos…</span>
            </div>
          ) : groups.length === 0 ? (
            <div className="empty-state">
              <p>
                <strong>Nenhum grupo cadastrado ainda.</strong>
              </p>
              <p>Crie um grupo acima para categorizar suas palavras-chave monitoradas.</p>
            </div>
          ) : (
            groups.map((grp) => {
              const isEditing = editingGroupId === grp.id;
              return (
                <article
                  key={grp.id}
                  className="group-card"
                  style={{ "--group-color": grp.color || "#0b7aa8" }}
                >
                  <div className="keyword-card-top">
                    <h3 style={{ margin: 0, display: "flex", alignItems: "center", gap: "0.45rem" }}>
                      <span
                        className="group-swatch"
                        style={{ "--group-color": grp.color || "#0b7aa8" }}
                        aria-hidden="true"
                      />
                      <span>{grp.name}</span>
                    </h3>
                    <span className="badge badge--neutral tabular">
                      {Number(grp.keyword_count || 0)} palavra(s)-chave
                    </span>
                  </div>

                  {grp.description ? (
                    <p className="keyword-description">{grp.description}</p>
                  ) : null}

                  <p className="field-hint tabular">
                    Atualizado em: {formatDateTimePtBr(grp.updated_at)}
                  </p>

                  {isEditing ? (
                    <InlineGroupEditForm
                      key={grp.id}
                      group={grp}
                      initialValues={editGroupValues}
                      onSave={(validatedValue, err) =>
                        handleSaveGroupEdit(grp.id, validatedValue, err)
                      }
                      onCancel={() => setEditingGroupId(null)}
                    />
                  ) : (
                    <div className="keyword-actions">
                      <button
                        type="button"
                        className="aero-gel-btn aero-gel-btn--ghost aero-gel-btn--sm"
                        onClick={() => {
                          setEditingGroupId(grp.id);
                          setEditGroupValues({
                            name: grp.name || "",
                            description: grp.description || "",
                            color: grp.color || "#0b7aa8"
                          });
                        }}
                      >
                        Editar
                      </button>
                      <button
                        type="button"
                        className="aero-gel-btn aero-gel-btn--danger aero-gel-btn--sm"
                        onClick={() => setDeleteTarget({ type: "group", item: grp })}
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

      <section className="doc-surface" aria-labelledby="alerts-heading">
        <div className="section-header">
          <div>
            <h2 id="alerts-heading">Alertas e ocorrências</h2>
            <p className="section-subtitle">
              Execute uma varredura nos boletins indexados, registre ocorrências manuais ou
              atualize o status de triagem.
            </p>
          </div>
          <span className="badge badge--neutral tabular">{alerts.length} alerta(s)</span>
        </div>

        <FeedbackBanner
          id="alerts-feedback"
          message={alertFeedback.message}
          state={alertFeedback.state}
        />

        <div className="filter-bar" style={{ marginBlockEnd: "1.1rem" }}>
          <div className="form-row-2">
            <div className="field">
              <label className="field-label" htmlFor="scan-keyword-select">
                Varredura automática nos boletins (FTS5)
              </label>
              <select
                id="scan-keyword-select"
                className="field-control"
                value={scanKeywordId}
                onChange={(e) => setScanKeywordId(e.target.value)}
              >
                {keywords.length === 0 ? (
                  <option value="">Cadastre uma palavra-chave na página inicial</option>
                ) : (
                  keywords.map((kw) => (
                    <option key={kw.id} value={String(kw.id)}>
                      {kw.keyword}
                    </option>
                  ))
                )}
              </select>
            </div>
            <div className="field" style={{ justifyContent: "flex-end" }}>
              <button
                type="button"
                className="aero-gel-btn aero-gel-btn--eco"
                onClick={handleScanSelectedKeyword}
                disabled={keywords.length === 0}
              >
                Varrer boletins agora
              </button>
            </div>
          </div>
        </div>

        <form
          ref={alertFormRef}
          className="aero-form"
          aria-labelledby="create-alert-heading"
          onSubmit={handleCreateAlert}
          noValidate
        >
          <h3 id="create-alert-heading" style={{ margin: 0 }}>
            Registrar alerta manualmente
          </h3>

          <div className="form-row-2">
            <div className="field">
              <label className="field-label" htmlFor="alert-keyword">
                Palavra-chave <span aria-hidden="true">*</span>
              </label>
              <select
                id="alert-keyword"
                name="keyword_id"
                className="field-control"
                value={alertKeywordId}
                onChange={(e) => {
                  e.target.setCustomValidity("");
                  setAlertKeywordId(e.target.value);
                }}
                data-error="alert-keyword-error"
                required
              >
                {keywords.length === 0 ? (
                  <option value="">Nenhuma palavra-chave disponível</option>
                ) : (
                  keywords.map((kw) => (
                    <option key={kw.id} value={String(kw.id)}>
                      {kw.keyword}
                    </option>
                  ))
                )}
              </select>
              <div id="alert-keyword-error" className="field-error">
                <span className="error-badge" role="img" aria-label="Erro">
                  !
                </span>
                <span>Selecione uma palavra-chave válida.</span>
              </div>
            </div>

            <div className="field">
              <label className="field-label" htmlFor="alert-status">
                Status inicial
              </label>
              <select
                id="alert-status"
                name="status"
                className="field-control"
                value={alertStatus}
                onChange={(e) => {
                  e.target.setCustomValidity("");
                  setAlertStatus(e.target.value);
                }}
              >
                <option value="novo">Novo</option>
                <option value="revisado">Revisado</option>
                <option value="arquivado">Arquivado</option>
              </select>
            </div>
          </div>

          <div className="form-row-2">
            <div className="field">
              <label className="field-label" htmlFor="alert-excerpt">
                Trecho encontrado
              </label>
              <input
                id="alert-excerpt"
                name="matched_excerpt"
                type="text"
                className="field-control"
                value={alertExcerpt}
                onChange={(e) => {
                  e.target.setCustomValidity("");
                  setAlertExcerpt(e.target.value);
                }}
                maxLength={1000}
                data-error="alert-excerpt-error"
                placeholder="Ex.: Publicação na edição 2410 sobre licitação"
              />
              <div id="alert-excerpt-error" className="field-error">
                <span className="error-badge" role="img" aria-label="Erro">
                  !
                </span>
                <span>O trecho encontrado deve ter no máximo 1000 caracteres.</span>
              </div>
            </div>

            <div className="field">
              <label className="field-label" htmlFor="alert-notes">
                Observações de triagem
              </label>
              <input
                id="alert-notes"
                name="notes"
                type="text"
                className="field-control"
                value={alertNotes}
                onChange={(e) => {
                  e.target.setCustomValidity("");
                  setAlertNotes(e.target.value);
                }}
                maxLength={1000}
                data-error="alert-notes-error"
                placeholder="Ex.: Verificar anexo II do edital"
              />
              <div id="alert-notes-error" className="field-error">
                <span className="error-badge" role="img" aria-label="Erro">
                  !
                </span>
                <span>Observações devem ter no máximo 1000 caracteres.</span>
              </div>
            </div>
          </div>

          <div className="form-actions">
            <button
              type="submit"
              className="aero-gel-btn"
              disabled={creatingAlert || keywords.length === 0}
            >
              Registrar alerta
            </button>
          </div>
        </form>

        <search>
          <form
            className="filter-bar"
            style={{ marginBlock: "1.25rem" }}
            onSubmit={handleFilterAlerts}
          >
            <div className="form-row-3">
              <div className="field">
                <label className="field-label" htmlFor="filter-alert-q">
                  Filtrar alertas por texto
                </label>
                <input
                  id="filter-alert-q"
                  type="search"
                  className="field-control"
                  value={filterQuery}
                  onChange={(e) => setFilterQuery(e.target.value)}
                  placeholder="Trecho ou observação"
                />
              </div>

              <div className="field">
                <label className="field-label" htmlFor="filter-alert-status">
                  Status
                </label>
                <select
                  id="filter-alert-status"
                  className="field-control"
                  value={filterStatus}
                  onChange={(e) => setFilterStatus(e.target.value)}
                >
                  <option value="">Todos</option>
                  <option value="novo">Novo</option>
                  <option value="revisado">Revisado</option>
                  <option value="arquivado">Arquivado</option>
                </select>
              </div>

              <div className="field">
                <label className="field-label" htmlFor="filter-alert-kw">
                  Palavra-chave
                </label>
                <select
                  id="filter-alert-kw"
                  className="field-control"
                  value={filterKeywordId}
                  onChange={(e) => setFilterKeywordId(e.target.value)}
                >
                  <option value="">Todas</option>
                  {keywords.map((kw) => (
                    <option key={kw.id} value={String(kw.id)}>
                      {kw.keyword}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="form-actions">
              <button
                type="submit"
                className="aero-gel-btn aero-gel-btn--sky aero-gel-btn--sm"
                disabled={dataLoading}
              >
                Filtrar alertas
              </button>
              <button
                type="button"
                className="aero-gel-btn aero-gel-btn--ghost aero-gel-btn--sm"
                onClick={handleResetAlertFilters}
                disabled={dataLoading}
              >
                Limpar filtros
              </button>
            </div>
          </form>
        </search>

        <div className="alerts-list">
          {alerts.length === 0 ? (
            <div className="empty-state">
              <p>
                <strong>Nenhum alerta encontrado.</strong>
              </p>
              <p>
                Execute uma varredura nos boletins acima ou registre um alerta manualmente.
              </p>
            </div>
          ) : (
            alerts.map((al) => {
              const draft = alertDrafts[al.id] || {
                status: al.status || "novo",
                notes: al.notes || ""
              };
              const excerptSegments = parseSafeExcerpt(al.matched_excerpt);

              return (
                <article key={al.id} className="alert-card">
                  <div className="keyword-card-top">
                    <div className="keyword-meta">
                      <span className="meta-pill meta-pill--edition">
                        {al.keyword || `Palavra-chave #${al.keyword_id}`}
                      </span>
                      <span className={`badge badge--status-${al.status || "novo"}`}>
                        {ALERT_STATUS_LABELS[al.status] || al.status}
                      </span>
                      {al.document_edition ? (
                        <span className="meta-pill">Edição {al.document_edition}</span>
                      ) : null}
                    </div>
                    <span className="field-hint tabular">
                      {formatDateTimePtBr(al.created_at)}
                    </span>
                  </div>

                  {al.document_title ? (
                    <p style={{ margin: 0, fontWeight: 700 }}>{al.document_title}</p>
                  ) : null}

                  {excerptSegments.length > 0 ? (
                    <div className="excerpt">
                      {excerptSegments.map((seg, i) =>
                        seg.mark ? (
                          <mark key={i}>{seg.text}</mark>
                        ) : (
                          <Fragment key={i}>{seg.text}</Fragment>
                        )
                      )}
                    </div>
                  ) : null}

                  {isHttpUrl(al.pdf_url) ? (
                    <div>
                      <a
                        className="doc-link-secondary"
                        href={al.pdf_url}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        Abrir PDF da edição ↗
                      </a>
                    </div>
                  ) : null}

                  <AlertTriageForm
                    alertItem={al}
                    draft={draft}
                    onDraftChange={handleDraftChange}
                    onSave={handleUpdateAlert}
                    onDelete={(item) => setDeleteTarget({ type: "alert", item })}
                  />
                </article>
              );
            })
          )}
        </div>
      </section>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title={
          deleteTarget?.type === "group" ? "Excluir grupo?" : "Excluir alerta?"
        }
        message={
          deleteTarget?.type === "group"
            ? `Confirma a exclusão do grupo "${deleteTarget.item.name}"? Se houver palavras-chave vinculadas, a exclusão será bloqueada.`
            : "Tem certeza de que deseja remover este alerta?"
        }
        confirmLabel="Confirmar exclusão"
        cancelLabel="Cancelar"
        onConfirm={handleConfirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
