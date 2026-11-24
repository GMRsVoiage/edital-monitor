const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const TOKEN_RE = /[\p{L}\p{N}_-]+/gu;

export const PRIORITY_VALUES = ["alta", "media", "baixa"];
export const ALERT_STATUS_VALUES = ["novo", "revisado", "arquivado"];

function normalizeEmail(value) {
  return String(value ?? "").normalize("NFKC").trim().toLowerCase();
}

export function cleanQuery(value) {
  return typeof value === "string"
    ? value.normalize("NFKC").replace(/\s+/g, " ").trim()
    : "";
}

export function isHttpUrl(value) {
  try {
    const parsed = new URL(String(value || ""));
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

export function formatDatePtBr(value) {
  if (!value) return "Data não identificada";
  const str = String(value).trim();
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(str)
    ? `${str}T12:00:00`
    : /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(str)
      ? `${str.replace(" ", "T")}Z`
      : str;
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return str;
  return new Intl.DateTimeFormat("pt-BR").format(date);
}

export const formatDateBr = formatDatePtBr;

export function formatDateTimePtBr(value) {
  if (!value) return "—";
  const str = String(value).trim();
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(str)
    ? `${str.replace(" ", "T")}Z`
    : /^\d{4}-\d{2}-\d{2}$/.test(str)
      ? `${str}T12:00:00`
      : str;
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return str;
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short"
  }).format(date);
}

function stripUnsafeTags(text) {
  return String(text || "")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<\/?[a-zA-Z][^>]*>/g, "");
}

export function parseSafeExcerpt(rawHtml) {
  const raw = String(rawHtml ?? "")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "");

  if (!raw) return [];

  const segments = [];
  const pushSegment = (text, mark) => {
    const clean = stripUnsafeTags(text);
    if (!clean) return;
    if (segments.length > 0 && segments[segments.length - 1].mark === mark) {
      segments[segments.length - 1].text += clean;
    } else {
      segments.push({ text: clean, mark });
    }
  };

  const markTagRe = /<\/?mark\b[^>]*>/gi;
  let lastIndex = 0;
  let depth = 0;
  let markStart = -1;
  let match;

  while ((match = markTagRe.exec(raw)) !== null) {
    const isClosing = match[0].startsWith("</");
    if (!isClosing) {
      if (depth === 0) {
        if (match.index > lastIndex) {
          pushSegment(raw.slice(lastIndex, match.index), false);
        }
        markStart = markTagRe.lastIndex;
      }
      depth += 1;
    } else if (depth > 0) {
      depth -= 1;
      if (depth === 0) {
        pushSegment(raw.slice(markStart, match.index), true);
        markStart = -1;
        lastIndex = markTagRe.lastIndex;
      }
    } else {
      if (match.index > lastIndex) {
        pushSegment(raw.slice(lastIndex, match.index), false);
      }
      lastIndex = markTagRe.lastIndex;
    }
  }

  if (depth > 0 && markStart >= 0) {
    pushSegment(raw.slice(markStart), false);
  } else if (lastIndex < raw.length) {
    pushSegment(raw.slice(lastIndex), false);
  }

  return segments;
}

export function validateSearchQuery(raw) {
  const q = cleanQuery(raw);
  if (q.length < 3) {
    return {
      valid: false,
      error: "Digite pelo menos 3 caracteres para iniciar a pesquisa.",
      value: q
    };
  }
  if (q.length > 100) {
    return {
      valid: false,
      error: "A pesquisa deve ter no máximo 100 caracteres.",
      value: q
    };
  }
  const tokens = q.match(TOKEN_RE) || [];
  if (!tokens.some((token) => token.length >= 2)) {
    return {
      valid: false,
      error: "Digite um termo com pelo menos 2 letras ou números.",
      value: q
    };
  }
  return { valid: true, error: "", value: q };
}

export function validateKeywordInput(input = {}, { partial = false } = {}) {
  const result = {};

  if (!partial || input.keyword !== undefined) {
    const keyword = cleanQuery(input.keyword);
    if (keyword.length < 3 || keyword.length > 100) {
      return {
        valid: false,
        field: "keyword",
        error: "A palavra-chave deve ter entre 3 e 100 caracteres.",
        value: null
      };
    }
    const tokens = keyword.match(TOKEN_RE) || [];
    if (!tokens.some((token) => token.length >= 2)) {
      return {
        valid: false,
        field: "keyword",
        error: "A palavra-chave deve conter ao menos um termo com 2 letras ou números.",
        value: null
      };
    }
    result.keyword = keyword;
  }

  if (!partial || input.priority !== undefined) {
    const priority = String(input.priority ?? "media").trim().toLowerCase();
    if (!PRIORITY_VALUES.includes(priority)) {
      return {
        valid: false,
        field: "priority",
        error: "Prioridade inválida. Escolha alta, média ou baixa.",
        value: null
      };
    }
    result.priority = priority;
  }

  if (!partial || input.target_section !== undefined) {
    const targetSection = cleanQuery(input.target_section ?? "geral") || "geral";
    if (targetSection.length > 80) {
      return {
        valid: false,
        field: "target_section",
        error: "A seção de destino deve ter no máximo 80 caracteres.",
        value: null
      };
    }
    result.target_section = targetSection;
  }

  if (!partial || input.description !== undefined) {
    const description = typeof input.description === "string" ? input.description.trim() : "";
    if (description.length > 500) {
      return {
        valid: false,
        field: "description",
        error: "Descrição deve ter no máximo 500 caracteres.",
        value: null
      };
    }
    result.description = description;
  }

  if (!partial || input.group_id !== undefined) {
    if (input.group_id === "" || input.group_id === null || input.group_id === undefined) {
      result.group_id = null;
    } else {
      const parsedGroup = Number(input.group_id);
      if (!Number.isInteger(parsedGroup) || parsedGroup <= 0) {
        return {
          valid: false,
          field: "group_id",
          error: "Selecione um grupo válido.",
          value: null
        };
      }
      result.group_id = parsedGroup;
    }
  }

  if (!partial || input.is_active !== undefined) {
    if (input.is_active === undefined) {
      result.is_active = 1;
    } else {
      const activeStr =
        typeof input.is_active === "string" ? input.is_active.trim().toLowerCase() : null;
      result.is_active =
        input.is_active === false ||
        input.is_active === 0 ||
        activeStr === "0" ||
        activeStr === "false"
          ? 0
          : 1;
    }
  }

  return { valid: true, error: "", value: result };
}

export function validateRegisterInput(input = {}) {
  const name = cleanQuery(input.name);
  if (name.length < 2) {
    return {
      valid: false,
      field: "name",
      error: "Informe um nome com pelo menos 2 caracteres.",
      value: null
    };
  }
  if (name.length > 80) {
    return {
      valid: false,
      field: "name",
      error: "O nome deve ter no máximo 80 caracteres.",
      value: null
    };
  }

  const email = normalizeEmail(input.email);
  if (!email || email.length > 254 || !EMAIL_RE.test(email)) {
    return { valid: false, field: "email", error: "Informe um e-mail válido.", value: null };
  }

  const password = String(input.password ?? "");
  if (password.length < 6 || password.length > 128 || password.trim().length === 0) {
    return {
      valid: false,
      field: "password",
      error: "A senha deve ter entre 6 e 128 caracteres.",
      value: null
    };
  }

  return { valid: true, error: "", value: { name, email, password } };
}

export function validateLoginInput(input = {}) {
  const email = normalizeEmail(input.email);
  if (!email || email.length > 254 || !EMAIL_RE.test(email)) {
    return { valid: false, field: "email", error: "Informe um e-mail válido.", value: null };
  }

  const password = String(input.password ?? "");
  if (password.length < 1 || password.length > 1024) {
    return { valid: false, field: "password", error: "Informe sua senha.", value: null };
  }

  return { valid: true, error: "", value: { email, password } };
}

export function validateProfileInput(input = {}) {
  const value = {};

  if (input.name !== undefined) {
    const name = cleanQuery(input.name);
    if (name.length < 2) {
      return {
        valid: false,
        field: "name",
        error: "Informe um nome com pelo menos 2 caracteres.",
        value: null
      };
    }
    if (name.length > 80) {
      return {
        valid: false,
        field: "name",
        error: "O nome deve ter no máximo 80 caracteres.",
        value: null
      };
    }
    value.name = name;
  }

  if (input.email !== undefined) {
    const email = normalizeEmail(input.email);
    if (!email || email.length > 254 || !EMAIL_RE.test(email)) {
      return { valid: false, field: "email", error: "Informe um e-mail válido.", value: null };
    }
    value.email = email;
  }

  if (input.password !== undefined && String(input.password) !== "") {
    const password = String(input.password);
    if (password.length < 6 || password.length > 128 || password.trim().length === 0) {
      return {
        valid: false,
        field: "password",
        error: "A senha deve ter entre 6 e 128 caracteres.",
        value: null
      };
    }
    const currentPassword = String(input.current_password ?? "");
    if (currentPassword.trim().length === 0) {
      return {
        valid: false,
        field: "current_password",
        error: "Informe sua senha atual para definir uma nova senha.",
        value: null
      };
    }
    value.password = password;
    value.current_password = currentPassword;
  }

  if (Object.keys(value).length === 0) {
    return {
      valid: false,
      field: input.password !== undefined ? "password" : "name",
      error: "Informe ao menos um campo para atualizar.",
      value: null
    };
  }

  return { valid: true, error: "", value };
}

export function validateGroupInput(input = {}) {
  const name = cleanQuery(input.name);
  if (name.length < 2 || name.length > 80) {
    return {
      valid: false,
      field: "name",
      error: "O nome do grupo deve ter entre 2 e 80 caracteres.",
      value: null
    };
  }

  const description = typeof input.description === "string" ? input.description.trim() : "";
  if (description.length > 500) {
    return {
      valid: false,
      field: "description",
      error: "A descrição do grupo deve ter no máximo 500 caracteres.",
      value: null
    };
  }

  const color = String(input.color ?? "#0b7aa8").trim() || "#0b7aa8";
  if (!HEX_COLOR_RE.test(color)) {
    return {
      valid: false,
      field: "color",
      error: "Informe uma cor hexadecimal válida (ex.: #0b7aa8).",
      value: null
    };
  }

  return { valid: true, error: "", value: { name, description, color } };
}

export function validateAlertInput(input = {}, { requireKeywordId = false } = {}) {
  const value = {};

  if (requireKeywordId || input.keyword_id !== undefined) {
    const keywordId = Number(input.keyword_id);
    if (!Number.isInteger(keywordId) || keywordId <= 0) {
      return {
        valid: false,
        field: "keyword_id",
        error: "Selecione uma palavra-chave válida.",
        value: null
      };
    }
    value.keyword_id = keywordId;
  }

  if (input.document_id !== undefined && input.document_id !== "" && input.document_id !== null) {
    const docId = Number(input.document_id);
    if (!Number.isInteger(docId) || docId <= 0) {
      return { valid: false, field: "document_id", error: "Documento inválido.", value: null };
    }
    value.document_id = docId;
  }

  if (input.status !== undefined) {
    const status = String(input.status).trim().toLowerCase();
    if (!ALERT_STATUS_VALUES.includes(status)) {
      return { valid: false, field: "status", error: "Status de alerta inválido.", value: null };
    }
    value.status = status;
  }

  if (input.notes !== undefined) {
    const notes = typeof input.notes === "string" ? input.notes.trim() : "";
    if (notes.length > 1000) {
      return {
        valid: false,
        field: "notes",
        error: "Observações devem ter no máximo 1000 caracteres.",
        value: null
      };
    }
    value.notes = notes;
  }

  if (input.matched_excerpt !== undefined) {
    const matchedExcerpt =
      typeof input.matched_excerpt === "string" ? input.matched_excerpt.trim() : "";
    if (matchedExcerpt.length > 1000) {
      return {
        valid: false,
        field: "matched_excerpt",
        error: "O trecho encontrado deve ter no máximo 1000 caracteres.",
        value: null
      };
    }
    value.matched_excerpt = matchedExcerpt;
  }

  return { valid: true, error: "", value };
}
