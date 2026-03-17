const MESSAGE_TYPES = {
  TOGGLE: "STUDY_ANALYZER_TOGGLE",
  ANALYZE: "STUDY_ANALYZER_ANALYZE",
  AI_ANALYZE: "STUDY_ANALYZER_AI_ANALYZE",
  CAPTURE_VISIBLE: "STUDY_ANALYZER_CAPTURE_VISIBLE",
  MODEL_STATUS: "STUDY_ANALYZER_MODEL_STATUS",
  START_SELECTION: "STUDY_ANALYZER_START_SELECTION"
};

async function sendToActiveTab(messageType) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    return;
  }

  try {
    await chrome.tabs.sendMessage(tab.id, { type: messageType });
  } catch (error) {
    // Ignore pages where content script is unavailable (e.g., Chrome internals).
    console.debug("Study analyzer: unable to send message", error);
  }
}

async function getAiSettings() {
  const defaults = {
    lmStudioBaseUrl: "http://127.0.0.1:1234/v1",
    lmStudioModel: "",
    lmStudioApiKey: ""
  };
  const stored = await chrome.storage.local.get(Object.keys(defaults));
  return {
    lmStudioBaseUrl: stored.lmStudioBaseUrl || defaults.lmStudioBaseUrl,
    lmStudioModel: stored.lmStudioModel || defaults.lmStudioModel,
    lmStudioApiKey: stored.lmStudioApiKey || defaults.lmStudioApiKey
  };
}

async function resolveModel(baseUrl, preferredModel) {
  if (preferredModel) {
    return preferredModel;
  }

  const modelsUrl = `${baseUrl}/models`;
  const response = await fetch(modelsUrl);
  if (!response.ok) {
    throw new Error(`Unable to load model list from LM Studio (${response.status})`);
  }
  const data = await response.json();
  const firstModel = data?.data?.[0]?.id;
  if (!firstModel) {
    throw new Error("No loaded models found in LM Studio");
  }
  return firstModel;
}

function isLikelyVisionModel(modelId) {
  const id = String(modelId || "").toLowerCase();
  const visionHints = ["vision", "vl", "llava", "qwen2-vl", "qwen2.5-vl", "gpt-4o", "pixtral", "minicpm-v"];
  return visionHints.some((hint) => id.includes(hint));
}

async function getModelStatus() {
  const settings = await getAiSettings();
  const baseUrl = settings.lmStudioBaseUrl.replace(/\/+$/, "");
  const model = await resolveModel(baseUrl, settings.lmStudioModel);
  return {
    model,
    baseUrl,
    visionCapable: isLikelyVisionModel(model)
  };
}

function buildPrompt(payload) {
  const controlsText = (payload.controls || [])
    .slice(0, 120)
    .map((control, index) => {
      const options = (control.options || []).join(", ");
      return `${index + 1}. kind=${control.kind}; label=${control.label || "n/a"}; name=${control.name || "n/a"}; nearby=${control.nearbyText || "n/a"}; options=[${options}]`;
    })
    .join("\n");

  const textCandidates = (payload.textCandidates || [])
    .slice(0, 120)
    .map((item, index) => `${index + 1}. ${item.text}`)
    .join("\n");

  const containerCandidates = (payload.containerCandidates || [])
    .slice(0, 60)
    .map(
      (item, index) =>
        `${index + 1}. tag=${item.tag}; classes=${item.classes || "n/a"}; controls=${item.controlCount}; text=${item.text || "n/a"}`
    )
    .join("\n");

  const imageHints = (payload.imageHints || []).slice(0, 10).join(" | ");
  const svgHints = (payload.svgHints || []).slice(0, 10).join(" | ");
  const codeCandidates = (payload.codeCandidates || [])
    .slice(0, 24)
    .map((item, index) => `${index + 1}. [${item.tag || "code"}|${item.languageHint || "n/a"}] ${item.text}`)
    .join("\n");
  const iframeContexts = (payload.iframeContexts || [])
    .slice(0, 10)
    .map((frame, index) => {
      const text = (frame.textCandidates || []).slice(0, 12).join(" | ");
      const code = (frame.codeCandidates || []).slice(0, 6).join(" | ");
      return `${index + 1}. src=${frame.src || "n/a"}; title=${frame.title || "n/a"}; accessible=${Boolean(
        frame.accessible
      )}; note=${frame.note || "n/a"}; text=${text || "none"}; code=${code || "none"}`;
    })
    .join("\n");
  const pageUrl = payload?.page?.url || "n/a";
  const pageTitle = payload?.page?.title || "n/a";
  const formSignalsJson = JSON.stringify(payload?.formSignals || {}, null, 2);

  return `
Ты помощник для разбора учебных заданий.
Нужно вернуть только 2 сущности: вопрос и ответ.
Используй controls, text candidates и container snippets.
Не возвращай markdown. Верни строго JSON в таком формате:
{
  "question": "string",
  "answer": "string"
}

Правила:
- Пиши на русском языке.
- "question" — текст задания/вопроса без лишних данных.
- "answer" — итоговый ответ по задаче.
- Сначала внутренне определи тип формы задания по controls и formSignals:
  - radio/radiogroup -> обычно один выбор;
  - checkbox -> множественный выбор;
  - text/textarea -> свободный ввод;
  - select/combobox -> выбор из списка;
  - ключевые слова "соответствие/сопоставь/match" -> задание на соответствие;
  - ключевые слова "порядок/последовательность" -> упорядочивание.
- Для соответствия и упорядочивания ответ возвращай в компактном виде, например:
  - "А-3, Б-1, В-2"
  - "2, 4, 1, 3"
- Если в вопросе есть код, приоритетно используй codeCandidates и код из iframeContexts.
- Если важный контент может быть в iframe и он недоступен (cross-origin), учитывай это как ограничение и не фантазируй.
- Если это вычислимый пример (арифметика и т.п.), вычисли результат и запиши его в "answer".
- Если есть варианты ответа, выбери наиболее подходящий вариант и запиши его текст.
- Если это поле свободного ввода без вариантов, всё равно постарайся дать конкретный ответ.
- Если не удалось определить, верни "Не обнаружен" в соответствующем поле.

Пример корректного формата:
{"question":"Решите пример: 35*6","answer":"210"}

Page:
- title: ${pageTitle}
- url: ${pageUrl}

Controls:
${controlsText || "none"}

Text candidates:
${textCandidates || "none"}

Container candidates:
${containerCandidates || "none"}

Code candidates:
${codeCandidates || "none"}

Iframe contexts:
${iframeContexts || "none"}

Form signals:
${formSignalsJson}

Image hints: ${imageHints || "none"}
SVG hints: ${svgHints || "none"}
`.trim();
}

function buildImagePrompt(payload) {
  const pageUrl = payload?.page?.url || "n/a";
  const pageTitle = payload?.page?.title || "n/a";
  const taskMode = payload?.taskMode || "auto";
  const modeLabel = taskMode === "code" ? "code" : taskMode === "forms" ? "forms" : "auto";
  const textCandidates = (payload?.textCandidates || []).slice(0, 40).map((v) => v?.text || "").filter(Boolean).join(" | ");
  const formSignals = JSON.stringify(payload?.formSignals || {}, null, 2);
  return `
Ты помощник по учебным заданиям.
Проанализируй изображение с вопросом и верни строго JSON:
{
  "question": "string",
  "answer": "string"
}

Правила:
- Пиши на русском языке.
- task_mode: ${modeLabel}
- Если task_mode=code:
  - выдели формулировку coding-вопроса;
  - определи, что требуется: вывод, исправление ошибки, выбор варианта, объяснение;
  - в "answer" дай конкретный итог (например: точный вывод/вариант/фикс), без длинной теории.
- Если task_mode=forms:
  - определи тип формы: один выбор, множественный, ввод текста, соответствие, порядок;
  - для соответствия используй формат "А-3, Б-1, В-2";
  - для порядка используй формат "2, 4, 1, 3";
  - для multiple choice перечисляй выбранные варианты через запятую.
- Если task_mode=auto:
  - сначала определи тип задачи, затем действуй по правилам выше.
- Если на изображении есть вопрос и варианты, выбери наиболее вероятный ответ.
- Если это задача на ввод (без вариантов), вычисли или сформулируй конкретный ответ.
- Если не удалось определить, используй "Не обнаружен".
- Не добавляй markdown и лишний текст.

Контекст страницы:
- title: ${pageTitle}
- url: ${pageUrl}
- text_candidates: ${textCandidates || "none"}
- form_signals: ${formSignals}
`.trim();
}

function buildRetryPrompt(payload, firstAttemptRaw) {
  const pageUrl = payload?.page?.url || "n/a";
  const pageTitle = payload?.page?.title || "n/a";
  const taskMode = payload?.taskMode || "auto";
  return `
Первая попытка анализа была неуспешной. Выполни ПОВТОРНЫЙ анализ строго и точно.
Нужно вернуть только JSON:
{
  "question": "string",
  "answer": "string"
}

Критические правила:
- Ответ только в JSON, без markdown.
- Поля question и answer обязательны и не должны быть пустыми.
- Если видны варианты ответа, выбери наиболее вероятный.
- Если задача вычислимая, вычисли конкретный ответ.
- task_mode=${taskMode}.
- Язык ответа: русский.

Контекст:
- title: ${pageTitle}
- url: ${pageUrl}

Результат первой неудачной попытки:
${firstAttemptRaw || "empty"}
`.trim();
}

function parseQuestionAnswer(rawText) {
  const raw = String(rawText || "").trim();
  if (!raw) {
    return null;
  }
  let parsed = null;
  try {
    parsed = JSON.parse(raw);
  } catch (_error) {
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        parsed = JSON.parse(raw.slice(start, end + 1));
      } catch (_error2) {
        return null;
      }
    } else {
      return null;
    }
  }
  return {
    question: String(parsed?.question || parsed?.detected_question || "").trim(),
    answer: String(parsed?.answer || parsed?.likely_answer || "").trim()
  };
}

function isUnknownValue(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) {
    return true;
  }
  const unknownTokens = new Set(["не обнаружен", "неизвестно", "unknown", "n/a", "none", "null", "undefined"]);
  return unknownTokens.has(normalized);
}

function isWeakResult(rawText) {
  const parsed = parseQuestionAnswer(rawText);
  if (!parsed) {
    return true;
  }
  return isUnknownValue(parsed.question) || isUnknownValue(parsed.answer);
}

async function requestChatCompletion(settings, model, userContent) {
  const baseUrl = settings.lmStudioBaseUrl.replace(/\/+$/, "");
  const apiUrl = `${baseUrl}/chat/completions`;

  const response = await fetch(apiUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: settings.lmStudioApiKey ? `Bearer ${settings.lmStudioApiKey}` : "Bearer lm-studio"
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content: "Ты точный помощник по учебным задачам. Всегда возвращай только валидный JSON."
        },
        {
          role: "user",
          content: userContent
        }
      ]
    })
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`LM Studio request failed (${response.status}): ${body}`);
  }

  const data = await response.json();
  return data?.choices?.[0]?.message?.content || "";
}

async function callLmStudio(payload) {
  const settings = await getAiSettings();
  const baseUrl = settings.lmStudioBaseUrl.replace(/\/+$/, "");
  const model = await resolveModel(baseUrl, settings.lmStudioModel);
  const hasImage = Boolean(payload?.selectedImageDataUrl);
  if (hasImage && !isLikelyVisionModel(model)) {
    throw new Error(
      `Текущая модель "${model}" не похожа на vision-модель. Для анализа изображений выберите модель с поддержкой картинок (например: qwen2.5-vl, llava, minicpm-v, gpt-4o-совместимая).`
    );
  }
  const prompt = hasImage ? buildImagePrompt(payload) : buildPrompt(payload);
  const userContent = hasImage
    ? [
        { type: "text", text: prompt },
        { type: "image_url", image_url: { url: payload.selectedImageDataUrl } }
      ]
    : prompt;

  const firstContent = await requestChatCompletion(settings, model, userContent);
  let finalContent = firstContent;
  let retriesUsed = 0;

  if (isWeakResult(firstContent)) {
    retriesUsed = 1;
    const retryPrompt = buildRetryPrompt(payload, firstContent);
    const retryUserContent = hasImage
      ? [
          { type: "text", text: retryPrompt },
          { type: "image_url", image_url: { url: payload.selectedImageDataUrl } }
        ]
      : retryPrompt;
    const retryContent = await requestChatCompletion(settings, model, retryUserContent);
    if (!isWeakResult(retryContent)) {
      finalContent = retryContent;
    }
  }

  return {
    raw: finalContent,
    settings: {
      ...settings,
      lmStudioModel: model
    },
    meta: {
      retriesUsed
    }
  };
}

chrome.action.onClicked.addListener(async () => {
  await sendToActiveTab(MESSAGE_TYPES.TOGGLE);
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command === "toggle-overlay") {
    await sendToActiveTab(MESSAGE_TYPES.START_SELECTION);
    return;
  }

  if (command === "run-analysis") {
    await sendToActiveTab(MESSAGE_TYPES.ANALYZE);
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === MESSAGE_TYPES.CAPTURE_VISIBLE) {
    chrome.tabs.captureVisibleTab({ format: "png" }, (dataUrl) => {
      const runtimeError = chrome.runtime.lastError;
      if (runtimeError) {
        sendResponse({ ok: false, error: runtimeError.message || "captureVisibleTab failed" });
        return;
      }
      if (!dataUrl) {
        sendResponse({ ok: false, error: "Empty screenshot data" });
        return;
      }
      sendResponse({ ok: true, dataUrl });
    });
    return true;
  }

  if (message?.type !== MESSAGE_TYPES.AI_ANALYZE) {
    if (message?.type === MESSAGE_TYPES.MODEL_STATUS) {
      getModelStatus()
        .then((status) => sendResponse({ ok: true, status }))
        .catch((error) => sendResponse({ ok: false, error: String(error?.message || error) }));
      return true;
    }
    return false;
  }

  callLmStudio(message.payload || {})
    .then((result) => sendResponse({ ok: true, result }))
    .catch((error) => sendResponse({ ok: false, error: String(error?.message || error) }));

  return true;
});
