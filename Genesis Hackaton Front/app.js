"use strict";

const main = document.querySelector("#main");
const announcement = document.querySelector("#announcement");
const STEP_LIMIT = 100;
const PAGE_SIZE = 5;
const TITLES = {
  workspace: "Рабочее место аудитора",
  trajectory: "Траектория эпизода",
  result: "Результат эпизода",
  case: "О кейсе"
};
const STATUS_LABELS = { active: "В работе", submitted: "Выводы отправлены", truncated: "Лимит исчерпан" };

let route = "workspace";
let state = newEpisode();

function newEpisode() {
  return {
    table: "ledger", pages: {}, detail: null, calculation: null,
    findings: [], submitted: null, log: [], status: "active"
  };
}

function escapeHTML(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character]);
}

function json(value) {
  return escapeHTML(JSON.stringify(value, null, 2));
}

function announce(message) {
  announcement.textContent = message;
}

function heading(title, description, actions = "") {
  return `<div class="page-heading"><div>
    <h1 id="page-title" tabindex="-1">${title}</h1><p>${description}</p>
    </div><div class="heading-actions">${actions}</div></div>`;
}

function disabled(condition) {
  return condition ? "disabled" : "";
}

function formatCell(row, key) {
  const value = row[key];
  if (value === null) return '<span class="muted">null</span>';
  if (key.endsWith("_minor")) {
    const digits = DEMO.currency_digits[row.currency];
    const amount = new Intl.NumberFormat("ru-RU", {
      minimumFractionDigits: digits, maximumFractionDigits: digits
    }).format(value / 10 ** digits);
    return `<span class="money">${escapeHTML(amount)} ${escapeHTML(row.currency)}</span>`;
  }
  if (key === "timestamp" || key === "issued_at") {
    const iso = escapeHTML(value);
    return `<time class="timestamp" datetime="${iso}" title="${iso}">
      ${iso.slice(0, 10)}<span>${iso.slice(11, 16)} ${iso.slice(19)}</span></time>`;
  }
  if (key.endsWith("_id")) return `<span class="record-id">${escapeHTML(value)}</span>`;
  if (Array.isArray(value)) return escapeHTML(value.join(", "));
  return escapeHTML(value);
}

function workspace() {
  const remaining = STEP_LIMIT - state.log.length;
  const active = state.status === "active";
  const status = STATUS_LABELS[state.status];
  return `
    ${heading(TITLES.workspace, "Расследуйте расхождения и оформите выводы с доказательствами.",
      '<button id="reset" class="button secondary" data-action="reset">Начать заново</button>')}
    <section class="episode" aria-label="Текущий эпизод">
      <div><span class="label">Эпизод</span><strong class="mono">${DEMO.episode_id}</strong></div>
      <div><span class="label">Период</span><strong>1–31 октября 2026</strong></div>
      <div><span class="label">Базовая валюта</span><strong>${DEMO.base_currency}</strong></div>
      <div><span class="label" id="budget-label">Остаток шагов</span>
        <strong class="mono">${remaining} / ${STEP_LIMIT}</strong>
        <progress aria-labelledby="budget-label" max="${STEP_LIMIT}" value="${remaining}"></progress>
      </div>
      <div><span class="label">Состояние</span><strong>${status}</strong></div>
    </section>
    ${active ? "" : `<div class="notice">${status}. <a href="#result">Открыть результат</a></div>`}
    <div class="workspace-grid">
      <div class="stack">
        ${records(active)}
        ${recordDetail(active)}
        ${toolsPanel(active)}
      </div>
      <div class="stack">
        ${findingPanel(active)}
        <section class="panel context">
          <h2>Условия эпизода</h2>
          <p>${DEMO.task}</p>
          <details><summary>Политика и форматы</summary>
            <dl class="policy">
              <dt>Дата курса</dt><dd>${DEMO.policy.fx_date}</dd>
              <dt>Границы периода</dt><dd>${DEMO.policy.accounting_period}</dd>
              <dt>Округление</dt><dd>${DEMO.policy.rounding}</dd>
              <dt>Часовой пояс</dt><dd class="mono">${DEMO.timezone}</dd>
              <dt>Формат данных</dt><dd class="mono">${DEMO.schema_version}</dd>
              <dt>Объём эпизода</dt><dd>
                ${DEMO.tables.ledger.rows.length} проводок ·
                ${DEMO.tables.invoices.rows.length + DEMO.tables.payments.rows.length} документа ·
                ${DEMO.tables.fx.rows.length} курса FX
              </dd>
            </dl>
          </details>
        </section>
      </div>
    </div>
    <dialog id="finding-dialog" aria-labelledby="finding-title">${findingForm()}</dialog>
    <dialog id="submit-dialog" aria-labelledby="submit-title">
      <h2 id="submit-title">Завершить эпизод?</h2>
      <p>${state.findings.length ? `Выводов к отправке — ${state.findings.length}.` : "Будет отправлен пустой список выводов."}
        Отправка занимает один шаг и завершает эпизод.</p>
      <div class="dialog-actions">
        <button class="button secondary" data-action="close-dialog" autofocus>Вернуться</button>
        <button class="button primary" data-action="confirm-submit">Подтвердить отправку</button>
      </div>
    </dialog>
    <dialog id="reset-dialog" aria-labelledby="reset-title">
      <h2 id="reset-title">Начать эпизод заново?</h2>
      <p>Текущий черновик и журнал действий будут очищены.</p>
      <div class="dialog-actions">
        <button class="button secondary" data-action="close-dialog" autofocus>Вернуться</button>
        <button class="button primary" data-action="confirm-reset">Сбросить эпизод</button>
      </div>
    </dialog>`;
}

function records(active) {
  const table = DEMO.tables[state.table];
  const page = state.pages[state.table];
  const columns = table.columns.map(([, label]) => `<th scope="col">${label}</th>`).join("");
  const rows = page?.rows.map((row) => `<tr>
    ${table.columns.map(([key]) => `<td>${formatCell(row, key)}</td>`).join("")}
    ${table.id ? `<td class="record-action"><button id="record-${escapeHTML(row[table.id])}" class="link-button" data-action="open-record" data-id="${escapeHTML(row[table.id])}"
       aria-label="Открыть запись ${escapeHTML(row[table.id])}" ${disabled(!active)}>Открыть</button></td>` : ""}
    </tr>`).join("");

  return `<section class="panel" aria-labelledby="records-title">
    <div class="panel-head"><h2 id="records-title">Записи компании</h2><span class="caption">Только чтение</span></div>
    <div class="table-switch" role="group" aria-label="Источники данных">
      ${Object.entries(DEMO.tables).map(([key, item]) =>
        `<button id="source-${key}" data-action="source" data-source="${key}" aria-pressed="${key === state.table}">${item.label}</button>`).join("")}
    </div>
    ${page ? `
      <p class="table-hint" id="table-hint">Прокрутите таблицу вбок, чтобы увидеть все столбцы.</p>
      <div id="record-table" class="table-scroll" tabindex="0" role="region" aria-label="${table.label}" aria-describedby="table-hint">
        <table aria-label="${table.label}">
          <thead><tr>${columns}${table.id ? '<th scope="col" class="record-action"><span class="sr-only">Действие</span></th>' : ""}</tr></thead>
          <tbody>${rows || `<tr><td colspan="${table.columns.length + Number(Boolean(table.id))}">Записей нет</td></tr>`}</tbody>
        </table>
      </div>
      <div class="pagination">
        <span>${page.rows.length ? `Строки ${page.offset + 1}–${page.offset + page.rows.length} из ${page.count}` : "Пустая выборка"}</span>
        <div>
          <button id="previous-page" class="button secondary small" data-action="list" data-offset="${Math.max(0, page.offset - PAGE_SIZE)}" ${disabled(!active || page.offset === 0)}>Назад</button>
          <button id="next-page" class="button secondary small" data-action="list" data-offset="${page.next_cursor ?? ""}" ${disabled(!active || page.next_cursor === null)}>Далее</button>
        </div>
      </div>` : `<div class="empty">
        <h3>Записи ещё не запрошены</h3>
        <p>Первый запрос из раздела «${table.label}» использует один шаг.</p>
        <button id="request-records" class="button secondary" data-action="list" data-offset="0" ${disabled(!active)}>Запросить записи</button>
      </div>`}
  </section>`;
}

function recordDetail(active) {
  if (!state.detail) return "";
  const { id, record, kind } = state.detail;
  const docId = kind === "record" ? record.doc_id : null;
  return `<section class="panel detail" aria-labelledby="detail-title">
    <div class="panel-head">
      <h2 id="detail-title" tabindex="-1">${kind === "record" ? "Запись" : "Документ"} <code>${escapeHTML(id)}</code></h2>
      <button class="link-button" data-action="close-detail">Закрыть</button>
    </div>
    <pre>${json(record)}</pre>
    ${docId ? `<button class="button secondary" data-action="open-document" data-id="${escapeHTML(docId)}" ${disabled(!active)}>Открыть документ ${escapeHTML(docId)}</button>` : ""}
  </section>`;
}

function toolsPanel(active) {
  return `<section class="panel context">
    <h2>Инструменты</h2>
    <details ${state.calculation ? "open" : ""}>
      <summary>Калькулятор</summary>
      <p>Введите два десятичных числа и выберите операцию. Запрос использует один шаг.</p>
      <form id="calculator">
        <div class="calculator-fields">
          <label>Первое число<input name="left" inputmode="decimal" maxlength="19" required value="${escapeHTML(state.calculation?.left ?? "")}"></label>
          <label>Операция<select name="operator">
            ${Object.entries({ "+": "+", "-": "−", "*": "×", "/": "÷" }).map(([value, label]) =>
              `<option value="${value}" ${state.calculation?.operator === value ? "selected" : ""}>${label}</option>`).join("")}
          </select></label>
          <label>Второе число<input name="right" inputmode="decimal" maxlength="19" required value="${escapeHTML(state.calculation?.right ?? "")}"></label>
        </div>
        <div class="inline-actions"><button class="button secondary" ${disabled(!active)}>Вычислить</button>
          ${state.calculation ? `<output id="calculation-result" tabindex="-1">${escapeHTML(state.calculation.result)}</output>` : ""}
        </div>
      </form>
    </details>
  </section>`;
}

function findingPanel(active) {
  return `<section class="panel findings" aria-labelledby="findings-title">
    <div class="panel-head"><h2 id="findings-title">Черновик выводов</h2><span class="count mono">${state.findings.length} / 30</span></div>
    ${state.findings.length ? `<ol class="finding-list">
      ${state.findings.map((finding, index) => `<li>
        <strong>${DEMO.findingTypes[finding.type]}</strong>
        <span class="mono">${escapeHTML(finding.affected_ids.join(", "))}</span>
        <span>${finding.evidence_ids.length} ID в доказательствах</span>
        <button class="link-button" data-action="remove-finding" data-index="${index}" aria-label="Удалить вывод ${index + 1}" ${disabled(!active)}>Удалить</button>
      </li>`).join("")}
    </ol>` : `<div class="empty compact"><h3>Выводов пока нет</h3><p>Укажите тип расхождения и приложите ID доказательств.</p></div>`}
    <div class="finding-actions">
      <button id="add-finding" class="button secondary" data-action="open-finding" ${disabled(!active || state.findings.length >= 30)}>Добавить вывод</button>
      <button class="button primary" data-action="open-submit" ${disabled(!active)}>Отправить выводы</button>
    </div>
  </section>`;
}

function findingForm() {
  return `<form id="finding-form">
    <h2 id="finding-title">Добавить вывод</h2>
    <label>Тип расхождения<select name="type" required autofocus>
      <option value="">Выберите тип</option>
      ${Object.entries(DEMO.findingTypes).map(([key, label]) => `<option value="${key}">${label}</option>`).join("")}
    </select></label>
    <label>ID затронутых записей<input name="affected" placeholder="L-001, L-002" required></label>
    <div class="form-pair">
      <label>Сумма в минимальных единицах<input name="amount" inputmode="numeric" pattern="-?[0-9]+" placeholder="100000" required></label>
      <label>Валюта<select name="currency"><option>KZT</option><option>USD</option></select></label>
    </div>
    <label>ID доказательств<input name="evidence" placeholder="L-001, DOC-I001" required></label>
    <p class="hint">Разделяйте ID запятыми. Не более 10 ID доказательств.</p>
    <label>Краткое обоснование<textarea name="explanation" rows="3" maxlength="1000" required></textarea></label>
    <p class="hint">До 1 000 символов.</p>
    <p id="finding-error" class="error" role="alert" hidden></p>
    <div class="dialog-actions">
      <button type="button" class="button secondary" data-action="close-dialog">Отмена</button>
      <button class="button primary" type="submit">Сохранить вывод</button>
    </div>
  </form>`;
}

function trajectory() {
  const labels = { list_records: "Список записей", get_record: "Запись", get_document: "Документ", calculator: "Расчёт", submit: "Отправка выводов" };
  return `${heading(TITLES.trajectory, "Последовательность запросов и наблюдений открытого демо.",
    `<button class="button secondary" data-action="export-log" ${disabled(!state.log.length)}>Скачать JSONL</button>`)}
    <section class="panel context">
      <h2>Действия <span class="count mono">${state.log.length}</span></h2>
      ${state.log.length ? `<ol class="timeline">${state.log.map((entry) => `<li><details>
        <summary><span class="mono">Шаг ${entry.step}</span> · ${labels[entry.action.type]}
          ${entry.observation.error ? '<span class="error">· Ошибка запроса</span>' : ""}</summary>
        <pre>${json(entry)}</pre>
      </details></li>`).join("")}</ol>` :
        '<div class="empty compact"><h3>Журнал пуст</h3><p>Запросите записи в рабочем месте аудитора.</p><a class="button secondary" href="#workspace">Перейти к аудиту</a></div>'}
    </section>`;
}

function result() {
  const submitted = state.status === "submitted";
  const truncated = state.status === "truncated";
  const message = submitted ? "Выводы зафиксированы в демо."
    : truncated ? "Лимит исчерпан. Итоговый ответ пуст." : "Итог появится после завершения эпизода.";
  return `${heading(TITLES.result, message, '<a class="button secondary" href="#trajectory">Открыть траекторию</a>')}
    <section class="panel context">
      <div class="panel-head flush"><h2>Сводка эпизода</h2><span class="pill">${STATUS_LABELS[state.status]}</span></div>
      <div class="result-grid">
        <div><span class="label">Шаги</span><strong class="mono">${state.log.length} / ${STEP_LIMIT}</strong></div>
        <div><span class="label">Принято выводов</span><strong class="mono">${submitted ? state.submitted.findings.length : "—"}</strong></div>
        <div><span class="label">Precision / Recall / F1</span><strong class="mono">— / — / —</strong></div>
        <div><span class="label">Награда</span><strong class="mono">—</strong></div>
        <div><span class="label">Время прогона</span><strong class="mono">—</strong></div>
      </div>
      <p class="muted">Метрики и награду предоставит оценщик после подключения среды.</p>
      ${submitted ? '<button class="button secondary" data-action="export-findings">Скачать findings.json</button>' : ""}
    </section>`;
}

function casePage() {
  return `${heading(TITLES.case, "Genesis Hackathon · FinTech",
      '<a class="button primary" href="#workspace">Открыть демо</a>')}
    <div class="stack">
      <section class="panel context">
        <h2>Задача</h2>
        <p>Создать воспроизводимую RL-среду, где агент исследует синтетические финансовые документы и отправляет выводы с доказательствами. Эпизод охватывает одну компанию и один отчётный период.</p>
        <h3>Типы расхождений</h3>
        <ul>${Object.values(DEMO.findingTypes).map((type) => `<li>${type}</li>`).join("")}</ul>
      </section>
      <section class="panel context">
        <h2>Как проходит проверка</h2>
        <p>Оценщик сопоставляет выводы с эталоном и рассчитывает метрики после завершения проверки. Демонстрационный интерфейс использует один открытый синтетический эпизод.</p>
      </section>
    </div>`;
}

const views = { workspace, trajectory, result, case: casePage };

function render(focusId) {
  main.innerHTML = views[route]();
  document.title = `${TITLES[route]} · Genesis FinTech`;
  document.querySelectorAll("nav a").forEach((link) => {
    if (link.hash === `#${route}`) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });
  if (focusId) document.getElementById(focusId)?.focus();
}

function readRoute(focus) {
  const hash = location.hash.slice(1);
  if (hash === "main") return;
  route = Object.hasOwn(views, hash) ? hash : "workspace";
  render(focus ? "page-title" : undefined);
}

function step(action, observation, submitted = false) {
  if (state.status !== "active") return;
  const number = state.log.length + 1;
  const truncated = !submitted && number === STEP_LIMIT;
  if (submitted) state.status = "submitted";
  if (truncated) state.status = "truncated";
  state.log.push({
    episode_id: DEMO.episode_id, step: number, action,
    observation: { ...observation, remaining_steps: STEP_LIMIT - number },
    reward: submitted || truncated ? null : 0,
    terminated: submitted, truncated
  });
}

function listRecords(offset, previousControl) {
  const table = DEMO.tables[state.table];
  const next = offset + PAGE_SIZE;
  const page = {
    rows: table.rows.slice(offset, next), count: table.rows.length, offset,
    next_cursor: next < table.rows.length ? next : null
  };
  state.pages[state.table] = page;
  state.detail = null;
  step({ type: "list_records", table: state.table, cursor: offset, limit: PAGE_SIZE }, page);
  let focusId = "record-table";
  if (previousControl === "next-page") focusId = page.next_cursor === null ? "previous-page" : "next-page";
  if (previousControl === "previous-page") focusId = offset === 0 ? "next-page" : "previous-page";
  render(state.status === "active" ? focusId : "page-title");
  announce(`Строк получено — ${page.rows.length}. Осталось шагов — ${STEP_LIMIT - state.log.length}.`);
}

function openRecord(kind, id) {
  const table = DEMO.tables[state.table];
  const action = kind === "document"
    ? { type: "get_document", doc_id: id }
    : { type: "get_record", table: state.table, id };
  const record = kind === "document"
    ? [...DEMO.tables.invoices.rows, ...DEMO.tables.payments.rows].find((row) => row.doc_id === id)
    : table.rows.find((row) => row[table.id] === id);
  const triggerId = kind === "record" ? id : state.detail?.triggerId;
  state.detail = record ? { id, record, kind, triggerId } : null;
  step(action, record ? { record } : { error: "Запись не найдена" });
  render(record ? "detail-title" : "page-title");
  if (!record) announce("Запись не найдена.");
}

function download(name, type, value) {
  const url = URL.createObjectURL(new Blob([value], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function actionClick(event) {
  const button = event.target.closest("button[data-action]");
  if (!button || button.disabled) return;
  const { action, source, offset, id, index } = button.dataset;
  switch (action) {
    case "source":
      state.table = source;
      state.detail = null;
      render(button.id);
      break;
    case "list":
      listRecords(Number(offset), button.id);
      break;
    case "open-record":
      openRecord("record", id);
      break;
    case "open-document":
      openRecord("document", id);
      break;
    case "close-detail": {
      const triggerId = state.detail?.triggerId;
      state.detail = null;
      render(state.status === "active" && triggerId ? "record-" + triggerId : "record-table");
      break;
    }
    case "open-finding":
      document.querySelector("#finding-dialog").showModal();
      break;
    case "open-submit":
      document.querySelector("#submit-dialog").showModal();
      break;
    case "close-dialog":
      button.closest("dialog").close();
      break;
    case "remove-finding":
      state.findings.splice(Number(index), 1);
      render("add-finding");
      announce("Вывод удалён из черновика.");
      break;
    case "confirm-submit":
      if (state.status !== "active") return;
      state.submitted = { episode_id: DEMO.episode_id, findings: state.findings.slice() };
      step({ type: "submit", ...state.submitted }, { message: "Выводы зафиксированы в демо" }, true);
      location.hash = "result";
      break;
    case "reset":
      document.querySelector("#reset-dialog").showModal();
      break;
    case "confirm-reset":
      state = newEpisode();
      render("reset");
      announce("Эпизод начат заново.");
      break;
    case "export-log":
      download("trajectories.jsonl", "application/x-ndjson", state.log.map((entry) => JSON.stringify(entry)).join("\n") + "\n");
      break;
    case "export-findings":
      download("findings.json", "application/json", JSON.stringify(state.submitted, null, 2));
      break;
  }
}

function saveFinding(form) {
  if (state.status !== "active" || state.findings.length >= 30) return;
  const fields = new FormData(form);
  const finding = {
    type: fields.get("type"),
    affected_ids: fields.get("affected").split(",").map((id) => id.trim()).filter(Boolean),
    claimed_amount_minor: Number(fields.get("amount")),
    currency: fields.get("currency"),
    evidence_ids: fields.get("evidence").split(",").map((id) => id.trim()).filter(Boolean),
    explanation: fields.get("explanation").trim()
  };
  if (!finding.affected_ids.length || !finding.evidence_ids.length || finding.evidence_ids.length > 10 ||
    !finding.explanation || !Number.isSafeInteger(finding.claimed_amount_minor)) {
    const error = form.querySelector("#finding-error");
    error.hidden = false;
    error.textContent = "Заполните ID и обоснование, укажите целую сумму и не более 10 ID доказательств.";
    return;
  }
  state.findings.push(finding);
  render("add-finding");
  announce("Вывод сохранён в черновике.");
}

const DECIMAL_SCALE = 100000000n;

function parseDecimal(input) {
  const value = input.trim().replace(",", ".");
  if (!/^-?\d{1,9}(\.\d{1,8})?$/.test(value)) {
    throw new Error("Введите до 9 цифр до разделителя и до 8 после него.");
  }
  const negative = value.startsWith("-");
  const [whole, fraction = ""] = value.replace("-", "").split(".");
  return (BigInt(whole) * DECIMAL_SCALE + BigInt(fraction.padEnd(8, "0"))) * (negative ? -1n : 1n);
}

function roundedDivide(numerator, denominator) {
  if (denominator === 0n) throw new Error("Деление на ноль.");
  const negative = (numerator < 0n) !== (denominator < 0n);
  const top = numerator < 0n ? -numerator : numerator;
  const bottom = denominator < 0n ? -denominator : denominator;
  return ((top + bottom / 2n) / bottom) * (negative ? -1n : 1n);
}

function calculate(form) {
  if (state.status !== "active") return;
  const fields = new FormData(form);
  const left = fields.get("left");
  const right = fields.get("right");
  const operator = fields.get("operator");
  const action = { type: "calculator", expression: `${left} ${operator} ${right}` };
  let result;
  try {
    const a = parseDecimal(left);
    const b = parseDecimal(right);
    const operations = {
      "+": () => a + b, "-": () => a - b,
      "*": () => roundedDivide(a * b, DECIMAL_SCALE),
      "/": () => roundedDivide(a * DECIMAL_SCALE, b)
    };
    const value = operations[operator]();
    const magnitude = value < 0n ? -value : value;
    const fraction = String(magnitude % DECIMAL_SCALE).padStart(8, "0").replace(/0+$/, "");
    result = (value < 0n ? "-" : "") + String(magnitude / DECIMAL_SCALE) + (fraction ? "." + fraction : "");
    step(action, { value: result });
  } catch (error) {
    result = error.message;
    step(action, { error: result });
  }
  state.calculation = { left, right, operator, result };
  render("calculation-result");
}

main.addEventListener("click", actionClick);
main.addEventListener("submit", (event) => {
  event.preventDefault();
  if (event.target.id === "finding-form") saveFinding(event.target);
  if (event.target.id === "calculator") calculate(event.target);
});
window.addEventListener("hashchange", () => readRoute(true));
document.querySelector(".skip-link").addEventListener("click", (event) => {
  event.preventDefault();
  main.focus();
});
readRoute(false);
