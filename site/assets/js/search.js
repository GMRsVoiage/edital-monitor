const api = (window.EDITAL_API_URL || "").replace(/\/$/, "");
const form = document.querySelector("#search-form");
const input = document.querySelector("#search-input");
const submitBtn = document.querySelector("#search-submit");
const feedback = document.querySelector("#feedback");
const results = document.querySelector("#results");

function msg(text, state = "info") {
  if (!feedback) return;
  feedback.textContent = text || "";
  feedback.classList.remove("is-ok", "is-error", "is-loading");
  if (text && (state === "ok" || state === "error" || state === "loading")) {
    feedback.classList.add(`is-${state}`);
  }
}

function formatDate(value) {
  if (!value) return "Data não identificada";
  const d = new Date(`${value}T12:00:00`);
  return Number.isNaN(d.getTime()) ? value : new Intl.DateTimeFormat("pt-BR").format(d);
}

function isHttpUrl(value) {
  try {
    const u = new URL(String(value || ""));
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}

function renderSafeExcerpt(container, html) {
  const raw = String(html || "");
  if ("setHTML" in Element.prototype) {
    container.setHTML(raw, { sanitizer: { elements: ["mark"], attributes: [] } });
    return;
  }

  const template = document.createElement("template");
  template.innerHTML = raw;
  const fragment = document.createDocumentFragment();

  const walk = (sourceNode, target) => {
    for (const child of sourceNode.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) {
        target.append(document.createTextNode(child.textContent || ""));
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        if (child.tagName === "MARK") {
          const mark = document.createElement("mark");
          mark.textContent = child.textContent || "";
          target.append(mark);
        } else {
          walk(child, target);
        }
      }
    }
  };

  walk(template.content, fragment);
  container.replaceChildren(fragment);
}

function render(data) {
  if (!results) return;
  results.replaceChildren();

  const items = Array.isArray(data?.results) ? data.results : [];
  if (!items.length) {
    msg("Nenhuma ocorrência encontrada nas publicações indexadas.");
    return;
  }

  const total = Number(data.total ?? items.length);
  const usageText = data.usage && typeof data.usage.remaining === "number" && typeof data.usage.limit === "number"
    ? ` Pesquisas restantes hoje: ${data.usage.remaining}/${data.usage.limit}.`
    : "";
  msg(`${total} resultado(s) encontrado(s).${usageText}`, "ok");

  const fragment = document.createDocumentFragment();

  for (const item of items) {
    const article = document.createElement("article");
    article.className = "result-card";

    const meta = document.createElement("div");
    meta.className = "result-meta";

    if (item.edition) {
      const edition = document.createElement("span");
      edition.className = "meta-pill meta-pill--edition";
      edition.textContent = `Edição ${item.edition}`;
      meta.append(edition);
    }

    const published = document.createElement("span");
    published.className = "meta-pill";
    published.textContent = formatDate(item.published_at);

    const page = document.createElement("span");
    page.className = "meta-pill";
    page.textContent = `Página ${item.page_number}`;
    meta.append(published, page);

    const title = document.createElement("h2");
    title.textContent = item.title || "Boletim Oficial";

    const excerpt = document.createElement("div");
    excerpt.className = "excerpt";
    renderSafeExcerpt(excerpt, item.excerpt);

    const actions = document.createElement("div");
    actions.className = "result-actions";

    if (isHttpUrl(item.pdf_url)) {
      const pdfLink = document.createElement("a");
      pdfLink.className = "aero-gel-btn aero-gel-btn--sky";
      pdfLink.href = item.pdf_url;
      pdfLink.target = "_blank";
      pdfLink.rel = "noopener noreferrer";
      pdfLink.textContent = "Abrir PDF oficial ↗";
      actions.append(pdfLink);
    }

    if (isHttpUrl(item.source_page_url) && item.source_page_url !== item.pdf_url) {
      const sourceLink = document.createElement("a");
      sourceLink.className = "doc-link-secondary";
      sourceLink.href = item.source_page_url;
      sourceLink.target = "_blank";
      sourceLink.rel = "noopener noreferrer";
      sourceLink.textContent = "Página da edição ↗";
      actions.append(sourceLink);
    }

    article.append(meta, title, excerpt);
    if (actions.childElementCount > 0) article.append(actions);
    fragment.append(article);
  }

  results.append(fragment);
}

async function search(query) {
  if (!api || api.includes("SEU-WORKER")) {
    msg("A API ainda não foi configurada em site/config.js.", "error");
    return;
  }

  msg("Pesquisando nas publicações indexadas…", "loading");
  if (results) {
    results.replaceChildren();
    results.setAttribute("aria-busy", "true");
  }
  if (submitBtn) submitBtn.disabled = true;

  try {
    const response = await fetch(`${api}/search?q=${encodeURIComponent(query)}`, {
      headers: { accept: "application/json" }
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Falha na pesquisa.");
    render(data);
  } catch (error) {
    const fallback = "Não foi possível conectar à API de pesquisa no momento.";
    const text = error instanceof TypeError ? fallback : (error?.message || "Não foi possível pesquisar.");
    msg(text, "error");
  } finally {
    if (results) results.removeAttribute("aria-busy");
    if (submitBtn) submitBtn.disabled = false;
  }
}

async function stats() {
  if (!api || api.includes("SEU-WORKER")) return;
  try {
    const response = await fetch(`${api}/stats`);
    if (!response.ok) return;
    const data = await response.json();
    const docsEl = document.querySelector("#stat-documents");
    const pagesEl = document.querySelector("#stat-pages");
    const latestEl = document.querySelector("#stat-latest");
    const latestMetaEl = document.querySelector("#stat-latest-meta");

    if (docsEl) docsEl.textContent = Number(data.documents || 0).toLocaleString("pt-BR");
    if (pagesEl) pagesEl.textContent = Number(data.pages || 0).toLocaleString("pt-BR");
    if (latestEl) latestEl.textContent = data.latest?.published_at ? formatDate(data.latest.published_at) : "—";
    if (latestMetaEl) {
      latestMetaEl.textContent = data.latest?.edition ? `Edição ${data.latest.edition}` : "";
    }
  } catch {}
}

// Validação acessível pós-interação + sincronização de ARIA
(() => {
  if (!form || !input) return;

  const announcer = document.createElement("div");
  announcer.setAttribute("aria-live", "polite");
  announcer.classList.add("visually-hidden");
  document.body.append(announcer);

  let announceTimer;
  let announced = false;
  let touched = false;
  let blurred = false;
  const supportsUserInvalid = CSS.supports("selector(:user-invalid)");

  const linkError = (el, shown) => {
    const errorId = el.dataset.error;
    if (!errorId) return;
    const ids = (el.getAttribute("aria-describedby") || "").split(/\s+/).filter((id) => id && id !== errorId);
    if (shown) ids.push(errorId);
    if (ids.length) el.setAttribute("aria-describedby", ids.join(" "));
    else el.removeAttribute("aria-describedby");
  };

  const announceError = () => {
    const error = document.getElementById(input.dataset.error || "");
    if (!error) return;
    clearTimeout(announceTimer);
    announcer.textContent = "";
    announceTimer = setTimeout(() => {
      announcer.textContent = error.textContent.replace(/\s+/g, " ").trim();
    }, 500);
  };

  const syncAria = (announce = false, forceFallbackState = false) => {
    const trimmedLength = input.value.trim().length;
    if (input.value.length > 0 && trimmedLength < 3) {
      input.setCustomValidity("Digite pelo menos 3 caracteres.");
    } else {
      input.setCustomValidity("");
    }

    const invalid = supportsUserInvalid
      ? input.matches(":user-invalid")
      : (forceFallbackState && !input.validity.valid);

    if (!supportsUserInvalid && forceFallbackState) {
      input.classList.toggle("user-invalid-fallback", !input.validity.valid);
      input.classList.toggle("user-valid-fallback", input.validity.valid);
    }

    if (invalid) {
      if (announce && !announced) {
        announceError();
        announced = true;
      }
      input.setAttribute("aria-invalid", "true");
      linkError(input, true);
    } else {
      input.setAttribute("aria-invalid", "false");
      linkError(input, false);
      announced = false;
      clearTimeout(announceTimer);
      announcer.textContent = "";
    }
  };

  syncAria();

  input.addEventListener("blur", () => {
    blurred = true;
    syncAria(true, touched);
  });

  input.addEventListener("input", () => {
    touched = true;
    if (input.getAttribute("aria-invalid") === "true" || !supportsUserInvalid) {
      syncAria(false, blurred);
    } else {
      input.setCustomValidity("");
    }
  });

  input.addEventListener("invalid", (e) => {
    e.preventDefault();
    touched = true;
    blurred = true;
    announced = true;
    syncAria(false, true);
    input.focus();
  });

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const query = input.value.trim();
    if (query.length < 3) {
      input.setCustomValidity("Digite pelo menos 3 caracteres.");
    } else {
      input.setCustomValidity("");
    }

    if (!form.checkValidity()) {
      syncAria(false, true);
      input.focus();
      return;
    }

    syncAria(false, true);
    search(query);
  });
})();

stats();
