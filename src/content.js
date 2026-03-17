(() => {
  if (window.__studyAnalyzerLoaded) {
    return;
  }
  window.__studyAnalyzerLoaded = true;

  const PANEL_ID = "study-analyzer-panel-host";
  const MESSAGE_TYPES = {
    TOGGLE: "STUDY_ANALYZER_TOGGLE",
    ANALYZE: "STUDY_ANALYZER_ANALYZE",
    AI_ANALYZE: "STUDY_ANALYZER_AI_ANALYZE",
    CAPTURE_VISIBLE: "STUDY_ANALYZER_CAPTURE_VISIBLE",
    MODEL_STATUS: "STUDY_ANALYZER_MODEL_STATUS",
    START_SELECTION: "STUDY_ANALYZER_START_SELECTION"
  };

  let panelState = {
    visible: false,
    minimized: false,
    lastContext: null,
    lastSelectionRect: null,
    lastSelectionImage: "",
    taskMode: "auto",
    aiStatus: "idle",
    aiResult: null,
    aiError: "",
    copyStatus: "",
    modelStatus: {
      model: "не определена",
      visionCapable: null,
      error: ""
    }
  };

  function cleanText(text) {
    return (text || "").replace(/\s+/g, " ").trim();
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function isElementVisible(element) {
    if (!(element instanceof HTMLElement)) {
      return false;
    }
    const style = window.getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") {
      return false;
    }
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function getElementText(element) {
    if (!element) {
      return "";
    }
    return cleanText(element.textContent || "");
  }

  function getControlKind(control) {
    if (control instanceof HTMLInputElement) {
      return control.type || "input";
    }
    if (control instanceof HTMLSelectElement) {
      return "select";
    }
    if (control instanceof HTMLTextAreaElement) {
      return "textarea";
    }
    return (control.getAttribute("role") || "custom").toLowerCase();
  }

  function getControlLabel(control) {
    const aria = cleanText(control.getAttribute("aria-label") || "");
    if (aria) {
      return aria;
    }

    if ((control instanceof HTMLInputElement || control instanceof HTMLTextAreaElement) && control.placeholder) {
      return cleanText(control.placeholder);
    }

    if ("labels" in control && control.labels?.length) {
      const labelText = Array.from(control.labels).map(getElementText).filter(Boolean).join(" | ");
      if (labelText) {
        return labelText;
      }
    }

    const parentLabel = control.closest("label");
    if (parentLabel) {
      const text = getElementText(parentLabel);
      if (text) {
        return text;
      }
    }

    const id = control.getAttribute("id");
    if (id) {
      const explicit = document.querySelector(`label[for="${CSS.escape(id)}"]`);
      const text = getElementText(explicit);
      if (text) {
        return text;
      }
    }

    const siblings = [control.previousElementSibling, control.nextElementSibling, control.parentElement];
    for (const node of siblings) {
      const text = getElementText(node);
      if (text && text.length > 2) {
        return text.slice(0, 140);
      }
    }

    return "";
  }

  function isRelevantNativeControl(element) {
    if (!(element instanceof HTMLInputElement || element instanceof HTMLSelectElement || element instanceof HTMLTextAreaElement)) {
      return false;
    }
    if (element instanceof HTMLInputElement) {
      const ignored = new Set(["hidden", "submit", "button", "reset", "file", "image"]);
      if (ignored.has(element.type)) {
        return false;
      }
    }
    return isElementVisible(element);
  }

  function isRelevantCustomControl(element) {
    if (!(element instanceof HTMLElement)) {
      return false;
    }
    if (element instanceof HTMLInputElement || element instanceof HTMLSelectElement || element instanceof HTMLTextAreaElement) {
      return false;
    }
    const role = (element.getAttribute("role") || "").toLowerCase();
    const supportedRoles = new Set(["radio", "checkbox", "option", "textbox", "combobox", "switch"]);
    return supportedRoles.has(role) && isElementVisible(element);
  }

  function collectControls() {
    const nativeControls = Array.from(document.querySelectorAll("input, select, textarea")).filter(isRelevantNativeControl);
    const customControls = Array.from(
      document.querySelectorAll("[role='radio'], [role='checkbox'], [role='option'], [role='textbox'], [role='combobox'], [role='switch']")
    ).filter(isRelevantCustomControl);

    return nativeControls.concat(customControls).map((control) => {
      const rect = control.getBoundingClientRect();
      const role = cleanText(control.getAttribute("role") || "");
      const type = control instanceof HTMLInputElement ? control.type || "input" : "";
      const options =
        control instanceof HTMLSelectElement
          ? Array.from(control.options)
              .map((option) => cleanText(option.textContent || option.value))
              .filter(Boolean)
              .slice(0, 20)
          : [];

      return {
        kind: getControlKind(control),
        role,
        type,
        name: cleanText(control.getAttribute("name") || ""),
        id: cleanText(control.getAttribute("id") || ""),
        label: getControlLabel(control),
        nearbyText: getElementText(control.parentElement).slice(0, 180),
        options,
        top: Math.round(rect.top),
        left: Math.round(rect.left)
      };
    });
  }

  function buildFormSignals(controls, textCandidates) {
    const counts = {
      radio: 0,
      checkbox: 0,
      select: 0,
      text: 0,
      textarea: 0,
      option: 0,
      combobox: 0,
      switch: 0
    };

    const radioGroups = new Map();
    const checkboxGroups = new Map();

    for (const control of controls) {
      const kind = String(control.kind || "").toLowerCase();
      if (kind in counts) {
        counts[kind] += 1;
      }

      if (kind === "radio") {
        const key = control.name || `radio-row-${Math.round((control.top || 0) / 30)}`;
        if (!radioGroups.has(key)) {
          radioGroups.set(key, []);
        }
        if (control.label) {
          radioGroups.get(key).push(control.label);
        }
      }

      if (kind === "checkbox") {
        const key = control.name || `checkbox-row-${Math.round((control.top || 0) / 30)}`;
        if (!checkboxGroups.has(key)) {
          checkboxGroups.set(key, []);
        }
        if (control.label) {
          checkboxGroups.get(key).push(control.label);
        }
      }
    }

    const fullText = textCandidates.map((item) => item.text.toLowerCase()).join(" | ");
    const hints = [];

    if (radioGroups.size > 0) {
      hints.push("single_choice_like");
    }
    if (checkboxGroups.size > 0) {
      hints.push("multiple_choice_like");
    }
    if (counts.select > 0 || counts.combobox > 0) {
      hints.push("select_like");
    }
    if (counts.text > 0 || counts.textarea > 0) {
      hints.push("free_text_like");
    }
    if (fullText.includes("соответств") || fullText.includes("match") || fullText.includes("сопостав")) {
      hints.push("matching_like");
    }
    if (fullText.includes("порядк") || fullText.includes("последователь")) {
      hints.push("ordering_like");
    }

    return {
      controlCounts: counts,
      radioGroups: Array.from(radioGroups.entries())
        .map(([name, options]) => ({ name, options: Array.from(new Set(options)).slice(0, 12) }))
        .slice(0, 20),
      checkboxGroups: Array.from(checkboxGroups.entries())
        .map(([name, options]) => ({ name, options: Array.from(new Set(options)).slice(0, 12) }))
        .slice(0, 20),
      interactionHints: hints
    };
  }

  function collectTextCandidates() {
    const candidates = [];
    const selector = "h1, h2, h3, h4, legend, p, li, td, th, span, div";
    const nodes = Array.from(document.querySelectorAll(selector));

    for (const node of nodes) {
      if (!(node instanceof HTMLElement) || !isElementVisible(node)) {
        continue;
      }

      if (node.querySelector("input, select, textarea, button")) {
        continue;
      }

      const text = cleanText(node.textContent || "");
      if (text.length < 6 || text.length > 220) {
        continue;
      }

      const rect = node.getBoundingClientRect();
      candidates.push({
        text,
        top: Math.round(rect.top),
        left: Math.round(rect.left),
        tag: node.tagName.toLowerCase()
      });
    }

    const unique = [];
    const seen = new Set();
    for (const item of candidates.sort((a, b) => a.top - b.top)) {
      if (seen.has(item.text)) {
        continue;
      }
      seen.add(item.text);
      unique.push(item);
      if (unique.length >= 140) {
        break;
      }
    }
    return unique;
  }

  function collectContainerCandidates() {
    const selector = "fieldset, tr, [role='group'], [role='radiogroup'], .question, .question-item, .task, form";
    const containers = Array.from(document.querySelectorAll(selector)).filter(isElementVisible);

    return containers
      .map((container) => {
        const rect = container.getBoundingClientRect();
        const text = cleanText(container.textContent || "").slice(0, 260);
        const controlCount = container.querySelectorAll("input, select, textarea, [role='radio'], [role='checkbox'], [role='option']").length;
        return {
          tag: container.tagName.toLowerCase(),
          classes: cleanText(container.className || ""),
          text,
          controlCount,
          top: Math.round(rect.top)
        };
      })
      .filter((item) => item.controlCount > 0)
      .sort((a, b) => a.top - b.top)
      .slice(0, 60);
  }

  function collectImageAndSvgHints() {
    const imageHints = Array.from(document.querySelectorAll("img"))
      .filter(isElementVisible)
      .map((img) => cleanText([img.getAttribute("alt") || "", img.getAttribute("title") || ""].join(" | ")))
      .filter(Boolean)
      .slice(0, 20);

    const svgHints = Array.from(document.querySelectorAll("svg"))
      .filter(isElementVisible)
      .map((svg) => {
        const textNodes = Array.from(svg.querySelectorAll("text, title, desc"))
          .map((node) => cleanText(node.textContent || ""))
          .filter(Boolean);
        return cleanText(textNodes.join(" | "));
      })
      .filter(Boolean)
      .slice(0, 20);

    return { imageHints, svgHints };
  }

  function collectCodeCandidates(limit = 40) {
    const selectors = ["pre", "code", "textarea", "[data-language]", "[class*='language-']", "[class*='code']"];
    const nodes = Array.from(document.querySelectorAll(selectors.join(", ")));
    const seen = new Set();
    const items = [];

    for (const node of nodes) {
      if (!(node instanceof HTMLElement) || !isElementVisible(node)) {
        continue;
      }

      const text = cleanText(node.textContent || "");
      if (text.length < 8 || text.length > 1200) {
        continue;
      }
      if (seen.has(text)) {
        continue;
      }
      seen.add(text);

      const languageHint = cleanText(
        node.getAttribute("data-language") ||
          node.getAttribute("lang") ||
          node.getAttribute("class") ||
          ""
      );

      items.push({
        text,
        languageHint: languageHint.slice(0, 120),
        tag: node.tagName.toLowerCase()
      });

      if (items.length >= limit) {
        break;
      }
    }

    return items;
  }

  function collectIframeContexts() {
    const frames = Array.from(document.querySelectorAll("iframe")).slice(0, 12);
    const contexts = [];

    for (const frame of frames) {
      const src = cleanText(frame.getAttribute("src") || "");
      const title = cleanText(frame.getAttribute("title") || "");
      const context = {
        src,
        title,
        accessible: false,
        textCandidates: [],
        codeCandidates: [],
        note: ""
      };

      try {
        const frameDoc = frame.contentDocument;
        if (!frameDoc) {
          context.note = "iframe не содержит доступного документа";
          contexts.push(context);
          continue;
        }

        context.accessible = true;

        const textNodes = Array.from(frameDoc.querySelectorAll("h1, h2, h3, h4, p, li, td, th, span, div"));
        const seenText = new Set();
        for (const node of textNodes) {
          const text = cleanText(node.textContent || "");
          if (text.length < 6 || text.length > 220 || seenText.has(text)) {
            continue;
          }
          seenText.add(text);
          context.textCandidates.push(text);
          if (context.textCandidates.length >= 35) {
            break;
          }
        }

        const codeNodes = Array.from(
          frameDoc.querySelectorAll("pre, code, textarea, [data-language], [class*='language-'], [class*='code']")
        );
        const seenCode = new Set();
        for (const node of codeNodes) {
          const text = cleanText(node.textContent || "");
          if (text.length < 8 || text.length > 1200 || seenCode.has(text)) {
            continue;
          }
          seenCode.add(text);
          context.codeCandidates.push(text);
          if (context.codeCandidates.length >= 12) {
            break;
          }
        }

        if (!context.textCandidates.length && !context.codeCandidates.length) {
          context.note = "доступен, но полезный контент не найден";
        }
      } catch (_error) {
        context.note = "недоступен (cross-origin ограничения браузера)";
      }

      contexts.push(context);
    }

    return contexts;
  }

  function collectPageContext() {
    const controls = collectControls();
    const textCandidates = collectTextCandidates();
    const containerCandidates = collectContainerCandidates();
    const { imageHints, svgHints } = collectImageAndSvgHints();
    const codeCandidates = collectCodeCandidates();
    const iframeContexts = collectIframeContexts();
    const formSignals = buildFormSignals(controls, textCandidates);

    return {
      page: {
        url: location.href,
        title: document.title
      },
      controls,
      textCandidates,
      containerCandidates,
      codeCandidates,
      iframeContexts,
      formSignals,
      imageHints,
      svgHints
    };
  }

  function extractJsonFromText(text) {
    const source = (text || "").trim();
    if (!source) {
      return null;
    }
    try {
      return JSON.parse(source);
    } catch (_e) {
      const start = source.indexOf("{");
      const end = source.lastIndexOf("}");
      if (start >= 0 && end > start) {
        try {
          return JSON.parse(source.slice(start, end + 1));
        } catch (_e2) {
          return null;
        }
      }
      return null;
    }
  }

  function normalizeUnknown(value, fallback) {
    const raw = cleanText(String(value ?? ""));
    if (!raw) {
      return fallback;
    }
    const lowered = raw.toLowerCase();
    const unknownTokens = new Set(["unknown", "n/a", "na", "none", "null", "undefined", "неизвестно", "н/д"]);
    if (unknownTokens.has(lowered)) {
      return fallback;
    }
    return raw;
  }

  function parseAiQuestionAnswer(raw) {
    const parsed = extractJsonFromText(raw || "");
    if (!parsed) {
      return null;
    }
    const rawAnswer = parsed.answer ?? parsed.likely_answer;
    return {
      question: normalizeUnknown(parsed.question ?? parsed.detected_question, "Не обнаружен"),
      answer: normalizeUnknownKeepFormatting(rawAnswer, "Не обнаружен")
    };
  }

  function normalizeUnknownKeepFormatting(value, fallback) {
    const raw = String(value ?? "");
    const trimmed = raw.trim();
    if (!trimmed) {
      return fallback;
    }
    const lowered = trimmed.toLowerCase();
    const unknownTokens = new Set(["unknown", "n/a", "na", "none", "null", "undefined", "неизвестно", "н/д"]);
    if (unknownTokens.has(lowered)) {
      return fallback;
    }
    return trimmed;
  }

  function extractCodeFromAnswer(answer) {
    const text = String(answer || "");
    const fencedMatch = text.match(/```(?:[\w+-]+)?\n([\s\S]*?)```/);
    if (fencedMatch?.[1]) {
      return fencedMatch[1].trim();
    }
    return text;
  }

  function shouldRenderAsCode(answer, taskMode) {
    if (taskMode === "code") {
      return true;
    }
    const text = String(answer || "");
    return text.includes("```") || /[{};]|=>|def |class |function |public |private /.test(text);
  }

  function renderAnswerHtml(answer, taskMode) {
    const normalized = normalizeUnknownKeepFormatting(answer, "Не обнаружен");
    if (shouldRenderAsCode(normalized, taskMode)) {
      const code = extractCodeFromAnswer(normalized);
      return `<pre class="sa-code-answer"><code>${escapeHtml(code || "Не обнаружен")}</code></pre>`;
    }
    return `<p><b>Ответ:</b> ${escapeHtml(normalized)}</p>`;
  }

  function getCopyableAnswer(answer, taskMode) {
    const normalized = normalizeUnknownKeepFormatting(answer, "Не обнаружен");
    if (shouldRenderAsCode(normalized, taskMode)) {
      return extractCodeFromAnswer(normalized).replace(/\r\n/g, "\n");
    }
    return normalized;
  }

  function bindCopyAnswerButton(target) {
    const button = target.querySelector(".sa-copy-answer");
    if (!button) {
      return;
    }
    button.addEventListener("click", async () => {
      const answer = panelState.aiResult?.answer || "";
      if (!answer) {
        return;
      }
      try {
        await navigator.clipboard.writeText(getCopyableAnswer(answer, panelState.taskMode));
        panelState.copyStatus = "Скопировано";
      } catch (_error) {
        panelState.copyStatus = "Не удалось скопировать";
      }
      renderSelectionResult(getPanelElements().shadow);
    });
  }

  function renderSelectionResult(root) {
    const target = root.querySelector(".sa-capture-body");
    if (!target) {
      return;
    }

    if (!panelState.lastSelectionImage || !panelState.lastSelectionRect) {
      target.innerHTML = `
        <h4>Выделенная область</h4>
        <p>Пока скриншот не выбран.</p>
      `;
      return;
    }

    const { width, height } = panelState.lastSelectionRect;
    const modelText = escapeHtml(panelState.modelStatus.model || "не определена");
    const visionText =
      panelState.modelStatus.visionCapable === null
        ? "неизвестно"
        : panelState.modelStatus.visionCapable
          ? "да"
          : "нет";
    const modelErrorHtml = panelState.modelStatus.error
      ? `<p>Ошибка статуса модели: ${escapeHtml(panelState.modelStatus.error)}</p>`
      : "";
    let aiBlock = `<p>Скриншот подготовлен. Отправка в ИИ произойдет автоматически после выделения.</p>`;
    if (panelState.aiStatus === "loading") {
      aiBlock = "<p>Отправка в ИИ... Ожидание ответа.</p>";
    } else if (panelState.aiStatus === "error") {
      aiBlock = `<p>Ошибка ИИ: ${escapeHtml(panelState.aiError || "Неизвестная ошибка")}</p>`;
    } else if (panelState.aiStatus === "done" && panelState.aiResult) {
      const answerHtml = renderAnswerHtml(panelState.aiResult.answer, panelState.taskMode);
      const copyStatusHtml = panelState.copyStatus ? `<span class="sa-copy-status">${escapeHtml(panelState.copyStatus)}</span>` : "";
      aiBlock = `
        <h4>Результат ИИ</h4>
        <p><b>Вопрос:</b> ${escapeHtml(panelState.aiResult.question)}</p>
        ${answerHtml}
        <div class="sa-copy-row">
          <button class="sa-copy-answer">Скопировать ответ</button>
          ${copyStatusHtml}
        </div>
      `;
    }

    target.innerHTML = `
      <h4>Выделенная область</h4>
      <p><b>Модель:</b> ${modelText}</p>
      <p><b>Поддержка изображений:</b> ${visionText}</p>
      ${modelErrorHtml}
      <p><b>Размер:</b> ${width} x ${height}px</p>
      <img class="sa-preview" src="${panelState.lastSelectionImage}" alt="Выделенная область" />
      ${aiBlock}
    `;
    bindCopyAnswerButton(target);
  }

  function renderPanel(root, _context) {
    const content = root.querySelector(".sa-content");
    if (!content) {
      return;
    }

    content.innerHTML = `
      <section class="sa-section sa-capture-result">
        <div class="sa-mode-row">
          <span>Тип задачи:</span>
          <button class="sa-mode-btn ${panelState.taskMode === "auto" ? "is-active" : ""}" data-mode="auto">Авто</button>
          <button class="sa-mode-btn ${panelState.taskMode === "code" ? "is-active" : ""}" data-mode="code">Кодинг</button>
          <button class="sa-mode-btn ${panelState.taskMode === "forms" ? "is-active" : ""}" data-mode="forms">Тест-формы</button>
        </div>
        <div class="sa-capture-body">
          <h4>Выделенная область</h4>
          <p>Нажмите «Выделить область», затем выделите нужный фрагмент страницы.</p>
        </div>
      </section>
    `;

    renderSelectionResult(root);
    bindModeButtons(root);
  }

  function bindModeButtons(root) {
    const buttons = Array.from(root.querySelectorAll(".sa-mode-btn"));
    for (const button of buttons) {
      button.addEventListener("click", () => {
        const nextMode = button.getAttribute("data-mode");
        if (!nextMode || !["auto", "code", "forms"].includes(nextMode)) {
          return;
        }
        panelState.taskMode = nextMode;
        renderPanel(root, panelState.lastContext);
      });
    }
  }

  function buildPanel() {
    let host = document.getElementById(PANEL_ID);
    if (host) {
      return host;
    }

    host = document.createElement("div");
    host.id = PANEL_ID;
    document.documentElement.appendChild(host);
    const shadow = host.attachShadow({ mode: "open" });

    shadow.innerHTML = `
      <style>
        :host { all: initial; }
        .sa-panel {
          position: fixed;
          top: 20px;
          right: 20px;
          width: 430px;
          max-height: 76vh;
          border-radius: 14px;
          border: 1px solid #2f3e56;
          background: #0b1321;
          color: #dbe7ff;
          box-shadow: 0 18px 42px rgba(0, 0, 0, 0.35);
          z-index: 2147483647;
          overflow: hidden;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          display: none;
        }
        .sa-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
          padding: 10px 12px;
          background: #111d31;
          border-bottom: 1px solid #2f3e56;
          cursor: move;
        }
        .sa-header h3 {
          margin: 0;
          font-size: 14px;
        }
        .sa-actions {
          display: flex;
          gap: 6px;
        }
        .sa-actions button {
          border: 1px solid #3f557a;
          border-radius: 8px;
          color: #f0f6ff;
          background: #0d1729;
          font-size: 12px;
          padding: 4px 8px;
          cursor: pointer;
        }
        .sa-actions button:hover {
          background: #13213a;
        }
        .sa-content {
          max-height: calc(76vh - 48px);
          overflow: auto;
          padding: 12px;
          font-size: 12px;
          line-height: 1.45;
        }
        .sa-section {
          border: none;
          background: transparent;
          border-radius: 0;
          padding: 0;
          margin-bottom: 0;
        }
        .sa-section h4 {
          margin: 0 0 6px;
          font-size: 12px;
        }
        .sa-mode-row {
          display: flex;
          align-items: center;
          gap: 6px;
          margin-bottom: 8px;
          font-size: 12px;
        }
        .sa-mode-btn {
          border: 1px solid #3f557a;
          border-radius: 7px;
          color: #cfe3ff;
          background: #0d1729;
          padding: 2px 8px;
          cursor: pointer;
          font-size: 11px;
        }
        .sa-mode-btn.is-active {
          background: #1e3a62;
          border-color: #60a5fa;
          color: #ffffff;
        }
        .sa-preview {
          display: block;
          max-width: 100%;
          border-radius: 8px;
          border: 1px solid #2f3e56;
          margin: 8px 0;
        }
        .sa-code-answer {
          margin: 6px 0 8px;
          white-space: pre-wrap;
          word-break: break-word;
          border: 1px solid #2f3e56;
          border-radius: 8px;
          padding: 8px;
          background: #08101d;
          font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
          font-size: 12px;
          line-height: 1.45;
        }
        .sa-copy-row {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .sa-copy-answer {
          border: 1px solid #3f557a;
          border-radius: 8px;
          color: #f0f6ff;
          background: #0d1729;
          font-size: 12px;
          padding: 4px 8px;
          cursor: pointer;
        }
        .sa-copy-answer:hover {
          background: #13213a;
        }
        .sa-copy-status {
          color: #9ae6b4;
          font-size: 12px;
        }
        .sa-meta {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          margin-bottom: 6px;
          color: #9fb3d4;
        }
        details {
          margin-bottom: 6px;
        }
        summary {
          cursor: pointer;
          color: #c6d8ff;
        }
        ul {
          margin: 6px 0;
          padding-left: 16px;
        }
        li {
          margin-bottom: 4px;
        }
        pre {
          margin: 0;
          white-space: pre-wrap;
          word-break: break-word;
          border: 1px solid #2f3e56;
          border-radius: 8px;
          padding: 8px;
          background: #08101d;
        }
        .sa-panel.minimized .sa-content {
          display: none;
        }
      </style>
      <div class="sa-panel">
        <div class="sa-header">
          <h3>Анализатор заданий</h3>
          <div class="sa-actions">
            <button class="sa-select-run">Выделить область</button>
            <button class="sa-min">_</button>
            <button class="sa-close">X</button>
          </div>
        </div>
        <div class="sa-content">
          Нажмите «Выделить область», чтобы подготовить скриншот.
        </div>
      </div>
    `;

    const panel = shadow.querySelector(".sa-panel");
    const header = shadow.querySelector(".sa-header");
    const selectButton = shadow.querySelector(".sa-select-run");
    const minButton = shadow.querySelector(".sa-min");
    const closeButton = shadow.querySelector(".sa-close");

    let dragState = { active: false, startX: 0, startY: 0, left: 0, top: 0 };

    header.addEventListener("mousedown", (event) => {
      if (event.target instanceof Element && event.target.closest("button")) {
        return;
      }

      dragState.active = true;
      const rect = panel.getBoundingClientRect();
      dragState.startX = event.clientX;
      dragState.startY = event.clientY;
      dragState.left = rect.left;
      dragState.top = rect.top;
      panel.style.left = `${rect.left}px`;
      panel.style.top = `${rect.top}px`;
      panel.style.right = "auto";
      event.preventDefault();
    });

    window.addEventListener("mousemove", (event) => {
      if (!dragState.active) {
        return;
      }
      const dx = event.clientX - dragState.startX;
      const dy = event.clientY - dragState.startY;
      panel.style.left = `${Math.max(0, dragState.left + dx)}px`;
      panel.style.top = `${Math.max(0, dragState.top + dy)}px`;
    });

    window.addEventListener("mouseup", () => {
      dragState.active = false;
    });

    selectButton.addEventListener("click", async () => {
      await startAreaSelection();
    });

    minButton.addEventListener("click", () => {
      panelState.minimized = !panelState.minimized;
      panel.classList.toggle("minimized", panelState.minimized);
    });

    closeButton.addEventListener("click", () => {
      panelState.visible = false;
      panel.style.display = "none";
    });

    return host;
  }

  function getPanelElements() {
    const host = buildPanel();
    return {
      host,
      shadow: host.shadowRoot,
      panel: host.shadowRoot.querySelector(".sa-panel")
    };
  }

  function setPanelVisible(visible) {
    const { panel } = getPanelElements();
    panelState.visible = visible;
    panel.style.display = visible ? "block" : "none";
    if (visible) {
      panel.style.top = panel.style.top || "20px";
      panel.style.left = panel.style.left || "auto";
    }
  }

  function runAnalysis() {
    const { shadow } = getPanelElements();
    const context = collectPageContext();
    panelState.lastContext = context;
    renderPanel(shadow, context);
    refreshModelStatus();
  }

  async function refreshModelStatus() {
    try {
      const response = await chrome.runtime.sendMessage({ type: MESSAGE_TYPES.MODEL_STATUS });
      if (!response?.ok || !response?.status) {
        throw new Error(response?.error || "Не удалось получить статус модели");
      }
      panelState.modelStatus = {
        model: response.status.model || "не определена",
        visionCapable: Boolean(response.status.visionCapable),
        error: ""
      };
    } catch (error) {
      panelState.modelStatus = {
        model: panelState.modelStatus.model || "не определена",
        visionCapable: panelState.modelStatus.visionCapable,
        error: String(error?.message || error)
      };
    } finally {
      const { shadow } = getPanelElements();
      renderSelectionResult(shadow);
    }
  }

  function activateSelectionOverlay() {
    return new Promise((resolve) => {
      const overlay = document.createElement("div");
      overlay.style.position = "fixed";
      overlay.style.inset = "0";
      overlay.style.cursor = "crosshair";
      overlay.style.zIndex = "2147483646";
      overlay.style.background = "rgba(0,0,0,0.15)";

      const selectionBox = document.createElement("div");
      selectionBox.style.position = "fixed";
      selectionBox.style.border = "2px solid #60a5fa";
      selectionBox.style.background = "rgba(96,165,250,0.2)";
      selectionBox.style.pointerEvents = "none";
      selectionBox.style.display = "none";

      overlay.appendChild(selectionBox);
      document.documentElement.appendChild(overlay);

      let startX = 0;
      let startY = 0;
      let isDragging = false;

      const cleanup = (result) => {
        window.removeEventListener("keydown", onKeydown, true);
        overlay.remove();
        resolve(result);
      };

      const onKeydown = (event) => {
        if (event.key === "Escape") {
          cleanup(null);
        }
      };

      overlay.addEventListener("mousedown", (event) => {
        isDragging = true;
        startX = event.clientX;
        startY = event.clientY;
        selectionBox.style.display = "block";
        selectionBox.style.left = `${startX}px`;
        selectionBox.style.top = `${startY}px`;
        selectionBox.style.width = "0px";
        selectionBox.style.height = "0px";
      });

      overlay.addEventListener("mousemove", (event) => {
        if (!isDragging) {
          return;
        }
        const left = Math.min(startX, event.clientX);
        const top = Math.min(startY, event.clientY);
        const width = Math.abs(event.clientX - startX);
        const height = Math.abs(event.clientY - startY);
        selectionBox.style.left = `${left}px`;
        selectionBox.style.top = `${top}px`;
        selectionBox.style.width = `${width}px`;
        selectionBox.style.height = `${height}px`;
      });

      overlay.addEventListener("mouseup", (event) => {
        if (!isDragging) {
          cleanup(null);
          return;
        }
        isDragging = false;
        const left = Math.min(startX, event.clientX);
        const top = Math.min(startY, event.clientY);
        const width = Math.abs(event.clientX - startX);
        const height = Math.abs(event.clientY - startY);

        if (width < 8 || height < 8) {
          cleanup(null);
          return;
        }
        cleanup({ left, top, width, height });
      });

      window.addEventListener("keydown", onKeydown, true);
    });
  }

  function cropImageByRect(dataUrl, rect) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => {
        const dpr = window.devicePixelRatio || 1;
        const sx = Math.max(0, Math.round(rect.left * dpr));
        const sy = Math.max(0, Math.round(rect.top * dpr));
        const sw = Math.max(1, Math.round(rect.width * dpr));
        const sh = Math.max(1, Math.round(rect.height * dpr));
        const canvas = document.createElement("canvas");
        canvas.width = sw;
        canvas.height = sh;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          reject(new Error("Canvas context unavailable"));
          return;
        }
        ctx.drawImage(image, sx, sy, sw, sh, 0, 0, sw, sh);
        resolve(canvas.toDataURL("image/png"));
      };
      image.onerror = () => reject(new Error("Unable to decode screenshot image"));
      image.src = dataUrl;
    });
  }

  async function startAreaSelection() {
    const { shadow, panel } = getPanelElements();
    panel.style.display = "none";
    let shouldAutoSend = false;

    try {
      const rect = await activateSelectionOverlay();
      if (!rect) {
        panel.style.display = panelState.visible ? "block" : "none";
        return;
      }

      const capture = await chrome.runtime.sendMessage({ type: MESSAGE_TYPES.CAPTURE_VISIBLE });
      if (!capture?.ok || !capture?.dataUrl) {
        throw new Error(capture?.error || "Не удалось захватить скриншот вкладки");
      }

      const croppedDataUrl = await cropImageByRect(capture.dataUrl, rect);
      panelState.lastSelectionRect = rect;
      panelState.lastSelectionImage = croppedDataUrl;
      panelState.aiStatus = "idle";
      panelState.aiResult = null;
      panelState.aiError = "";
      panelState.copyStatus = "";
      shouldAutoSend = true;
    } catch (error) {
      panelState.lastSelectionRect = null;
      panelState.lastSelectionImage = "";
      panelState.aiStatus = "error";
      panelState.aiError = String(error?.message || error);
      const target = shadow.querySelector(".sa-capture-body");
      if (target) {
        target.innerHTML = `
          <h4>Выделенная область</h4>
          <p>Ошибка выделения: ${escapeHtml(String(error?.message || error))}</p>
        `;
      }
    } finally {
      panel.style.display = panelState.visible ? "block" : "none";
      renderPanel(shadow, panelState.lastContext);
      if (shouldAutoSend) {
        await sendSelectionToAi();
      }
    }
  }

  async function sendSelectionToAi() {
    const { shadow } = getPanelElements();
    if (!panelState.lastSelectionImage) {
      return;
    }

    panelState.aiStatus = "loading";
    panelState.aiResult = null;
    panelState.aiError = "";
    panelState.copyStatus = "";
    renderSelectionResult(shadow);

    try {
      const response = await chrome.runtime.sendMessage({
        type: MESSAGE_TYPES.AI_ANALYZE,
        payload: {
          selectedImageDataUrl: panelState.lastSelectionImage,
          taskMode: panelState.taskMode,
          page: {
            url: location.href,
            title: document.title
          },
          formSignals: panelState.lastContext?.formSignals || {},
          textCandidates: (panelState.lastContext?.textCandidates || []).slice(0, 40)
        }
      });

      if (!response?.ok) {
        throw new Error(response?.error || "Ошибка запроса к ИИ");
      }

      const parsed = parseAiQuestionAnswer(response?.result?.raw || "");
      if (!parsed) {
        throw new Error("ИИ вернул невалидный JSON");
      }

      panelState.aiStatus = "done";
      panelState.aiResult = parsed;
      panelState.aiError = "";
    } catch (error) {
      panelState.aiStatus = "error";
      panelState.aiError = String(error?.message || error);
      panelState.aiResult = null;
    } finally {
      renderSelectionResult(shadow);
    }
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (!message?.type) {
      return;
    }

    if (message.type === MESSAGE_TYPES.TOGGLE) {
      setPanelVisible(!panelState.visible);
      if (panelState.visible) {
        runAnalysis();
      }
      return;
    }

    if (message.type === MESSAGE_TYPES.ANALYZE) {
      if (!panelState.visible) {
        setPanelVisible(true);
      }
      runAnalysis();
      return;
    }

    if (message.type === MESSAGE_TYPES.START_SELECTION) {
      if (!panelState.visible) {
        setPanelVisible(true);
      }
      runAnalysis();
      void startAreaSelection();
    }
  });
})();
