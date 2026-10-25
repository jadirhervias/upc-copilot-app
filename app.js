import {
  calculateAllocations,
  calculateCategoryIndicator,
  commitStorageChanges,
  createMovement,
  formatCents,
  formatPercentageHundredths,
  localDateKey,
  MOVEMENT_CATEGORIES,
  normalizeMovements,
  normalizeBudgetRecord,
  parseMoneyToCents,
  prepareDefaultApplication,
  removeMovement,
  sortMovementsNewestFirst,
  summarizeMovements,
  shiftMonth,
  upsertMovement,
} from "./budget.mjs";

const STORAGE_PREFIX = "mi-presupuesto:v1:";
const MONTHS = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
];
const monthSelect = document.querySelector("#month-select");
const yearSelect = document.querySelector("#year-select");
const previousMonthButton = document.querySelector("#previous-month");
const nextMonthButton = document.querySelector("#next-month");
const currentMonthButton = document.querySelector("#go-to-current-month");
const selectedMonthLabel = document.querySelector("#selected-month");
const content = document.querySelector("#budget-content");
const message = document.querySelector("#app-message");
let activeMonth = "";
let monthRecord = null;
let defaultRecord = null;
let movements = [];
let movementStorageValue = null;
let budgetStorageValues = {};
let activeForm = null;
let activeMovementForm = null;
let storageError = "";

function currentMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function monthKey(year, monthNumber) {
  return `${String(year).padStart(4, "0")}-${String(monthNumber).padStart(2, "0")}`;
}

function monthName(month) {
  const [year, number] = month.split("-").map(Number);
  const date = new Date(0);
  date.setUTCFullYear(year, number - 1, 1);
  date.setUTCHours(0, 0, 0, 0);
  const name = new Intl.DateTimeFormat("es-PE", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
  return name.charAt(0).toLocaleUpperCase("es-PE") + name.slice(1);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]);
}

function centsToInput(cents) {
  const value = BigInt(cents);
  return `${value / 100n}.${String(value % 100n).padStart(2, "0")}`;
}

function showMessage(text, kind = "error") {
  message.textContent = text;
  message.className = `app-message ${kind}`;
  message.hidden = !text;
}

function readRecord(key, description) {
  let stored;
  try {
    stored = localStorage.getItem(key);
  } catch {
    return {
      record: null,
      raw: null,
      error: `No se pudo acceder al presupuesto ${description} en el almacenamiento local.`,
    };
  }
  if (stored === null) {
    return { record: null, raw: null, error: "" };
  }
  try {
    const record = normalizeBudgetRecord(JSON.parse(stored));
    if (!record) {
      return {
        record: null,
        raw: stored,
        error: `La configuración guardada ${description} no tiene un formato válido.`,
      };
    }
    return { record, raw: stored, error: "" };
  } catch {
    return {
      record: null,
      raw: stored,
      error: `No se pudo leer la configuración guardada ${description}.`,
    };
  }
}

function loadBudgets(month) {
  const monthStorageKey = `${STORAGE_PREFIX}${month}`;
  const defaultStorageKey = `${STORAGE_PREFIX}default`;
  const monthResult = readRecord(monthStorageKey, "de este mes");
  const defaultResult = readRecord(defaultStorageKey, "predeterminada");
  budgetStorageValues = {
    [monthStorageKey]: monthResult.raw,
    [defaultStorageKey]: defaultResult.raw,
  };
  monthRecord = monthResult.record;
  defaultRecord = defaultResult.record;
  storageError = monthResult.error || defaultResult.error;
  loadMovements(month);
}

function loadMovements(month) {
  let stored;
  try {
    stored = localStorage.getItem(`${STORAGE_PREFIX}movements:${month}`);
  } catch {
    movements = [];
    movementStorageValue = null;
    storageError ||= "No se pudo acceder al historial en el almacenamiento local.";
    return;
  }
  movementStorageValue = stored;
  if (stored === null) {
    movements = [];
    return;
  }
  try {
    movements = normalizeMovements(JSON.parse(stored), month);
    if (!movements) {
      storageError ||= `El historial guardado de ${monthName(month)} no tiene un formato válido.`;
      movements = [];
    }
  } catch {
    storageError ||= `No se pudo leer el historial guardado de ${monthName(month)}.`;
    movements = [];
  }
}

function activeBudget() {
  return monthRecord ?? defaultRecord;
}

function syncMonthControls() {
  const [year, month] = activeMonth.split("-").map(Number);
  monthSelect.value = String(month - 1);
  const firstYear = Math.max(1, year - 10);
  const lastYear = Math.min(9999, year + 10);
  yearSelect.innerHTML = Array.from(
    { length: lastYear - firstYear + 1 },
    (_, index) => firstYear + index,
  )
    .map((optionYear) => `<option value="${optionYear}">${optionYear}</option>`)
    .join("");
  yearSelect.value = String(year);
  selectedMonthLabel.textContent = monthName(activeMonth);
  currentMonthButton.hidden = activeMonth === currentMonth();
  previousMonthButton.disabled = year <= 1 && month === 1;
  nextMonthButton.disabled = year >= 9999 && month === 12;
}

function selectMonth(month) {
  activeMonth = month;
  activeForm = null;
  activeMovementForm = null;
  showMessage("");
  loadBudgets(month);
  syncMonthControls();
  render();
}

function saveRecord(key, budgetCents, metadata = {}) {
  const record = { budgetCents, ...metadata };
  try {
    const value = JSON.stringify(record);
    const result = commitStorageChanges(
      localStorage,
      { [key]: budgetStorageValues[key] ?? null },
      { [key]: value },
    );
    if (result.status === "conflict") {
      showMessage(storageConflictMessage("el presupuesto"));
      return false;
    }
    budgetStorageValues[key] = value;
    storageError = "";
    showMessage("");
    return true;
  } catch {
    showMessage("No se pudo guardar el presupuesto en este dispositivo. Revisa el almacenamiento del navegador e inténtalo de nuevo.");
    return false;
  }
}

function storageConflictMessage(dataLabel) {
  return `Otra pestaña cambió ${dataLabel} desde que lo abriste. No se sobrescribieron esos datos; el formulario conserva tus valores para que puedas copiarlos y revisarlos antes de volver a cargar la versión más reciente.`;
}

function showStorageConflict(dataLabel) {
  showMessage(storageConflictMessage(dataLabel));
}

function renderBudgetForm(kind) {
  const isDefault = kind === "default";
  const title = isDefault
    ? "Editar presupuesto predeterminado"
    : monthRecord
      ? "Editar presupuesto de este mes"
      : "Personalizar este mes";
  const savedRecord = isDefault ? defaultRecord : monthRecord;
  const submitLabel = isDefault
    ? "Guardar presupuesto predeterminado"
    : "Guardar presupuesto de este mes";

  return `
    <form id="budget-form" class="budget-form edit-form">
      <h3>${title}</h3>
      <label for="budget-input">${isDefault ? "Monto mensual habitual" : `Monto para ${monthName(activeMonth)}`}</label>
      <div class="money-input">
        <span aria-hidden="true">S/</span>
        <input
          id="budget-input"
          name="budget"
          type="text"
          inputmode="decimal"
          autocomplete="off"
          value="${savedRecord ? centsToInput(savedRecord.budgetCents) : ""}"
          placeholder="0.00"
          aria-describedby="budget-hint form-error"
          required
        />
      </div>
      <p id="budget-hint" class="input-hint">Ingresa un monto positivo, con punto o coma y hasta dos decimales.</p>
      <p id="form-error" class="form-error" role="alert"></p>
      <div class="form-actions">
        <button class="button button-primary" type="submit">${submitLabel}</button>
        <button class="button button-secondary" id="cancel-budget-edit" type="button">Cancelar</button>
      </div>
    </form>`;
}

function attachBudgetForm() {
  const form = document.querySelector("#budget-form");
  if (!form) return;

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const input = document.querySelector("#budget-input");
    const error = document.querySelector("#form-error");
    try {
      const budgetCents = parseMoneyToCents(input.value);
      const isDefault = activeForm === "default";
      const key = isDefault
        ? `${STORAGE_PREFIX}default`
        : `${STORAGE_PREFIX}${activeMonth}`;
      const metadata =
        !isDefault && monthRecord?.preservedForHistory
          ? { preservedForHistory: true }
          : !isDefault && monthRecord?.preservedFromDefault
            ? { preservedFromDefault: true }
            : {};
      if (saveRecord(key, budgetCents, metadata)) {
        activeForm = null;
        loadBudgets(activeMonth);
        render();
      }
    } catch (problem) {
      error.textContent = problem.message;
      input.setAttribute("aria-invalid", "true");
    }
  });
  document.querySelector("#budget-input").addEventListener("input", (event) => {
    event.currentTarget.removeAttribute("aria-invalid");
    document.querySelector("#form-error").textContent = "";
  });
  document.querySelector("#cancel-budget-edit").addEventListener("click", () => {
    activeForm = null;
    render();
  });
}

function defaultMovementDate() {
  const today = localDateKey();
  if (today.slice(0, 7) === activeMonth) return today;
  const [year, month] = activeMonth.split("-").map(Number);
  return localDateKey(new Date(year, month, 0));
}

function formatMovementDate(date) {
  const [year, month, day] = date.split("-").map(Number);
  return new Intl.DateTimeFormat("es-PE", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(year, month - 1, day));
}

function movementById(id) {
  return movements.find((movement) => movement.id === id) ?? null;
}

function createMovementId() {
  let id;
  do {
    id =
      globalThis.crypto?.randomUUID?.() ??
      `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  } while (movementById(id));
  return id;
}

function movementCategoryOptions(type, selectedCategory) {
  return MOVEMENT_CATEGORIES
    .filter((category) => category.type === type)
    .map(
      (category) =>
        `<option value="${category.id}" ${category.id === selectedCategory ? "selected" : ""}>${category.label}</option>`,
    )
    .join("");
}

function renderMovementForm() {
  const editing = activeMovementForm !== "new";
  const movement = editing ? movementById(activeMovementForm) : null;
  if (editing && !movement) {
    activeMovementForm = null;
    return "";
  }
  const type = movement?.type ?? "gasto";
  const category = movement?.category ?? "gastos-esenciales";
  return `
    <form id="movement-form" class="movement-form">
      <h3>${editing ? "Editar movimiento" : "Registrar movimiento"}</h3>
      <div class="movement-form-grid">
        <div class="form-field movement-description-field">
          <label for="movement-description">Descripción</label>
          <input           id="movement-description" name="description" type="text" value="${escapeHtml(movement?.description ?? "")}" required />
        </div>
        <div class="form-field">
          <label for="movement-amount">Monto</label>
          <div class="money-input">
            <span aria-hidden="true">S/</span>
            <input id="movement-amount" name="amount" type="text" inputmode="decimal" value="${movement ? centsToInput(movement.amountCents) : ""}" placeholder="0.00" required />
          </div>
        </div>
        <div class="form-field">
          <label for="movement-date">Fecha</label>
          <input id="movement-date" name="date" type="date" value="${movement?.date ?? defaultMovementDate()}" required />
        </div>
        <div class="form-field">
          <label for="movement-type">Tipo</label>
          <select id="movement-type" name="type">
            <option value="gasto" ${type === "gasto" ? "selected" : ""}>Gasto</option>
            <option value="aporte" ${type === "aporte" ? "selected" : ""}>Aporte</option>
          </select>
        </div>
        <div class="form-field">
          <label for="movement-category">Categoría</label>
          <select id="movement-category" name="category">${movementCategoryOptions(type, category)}</select>
        </div>
      </div>
      <p class="input-hint">La fecha debe pertenecer a ${monthName(activeMonth)} y no puede ser futura.</p>
      <p id="movement-error" class="form-error" role="alert"></p>
      <div class="form-actions">
        <button class="button button-primary" type="submit">${editing ? "Guardar cambios" : "Guardar movimiento"}</button>
        <button class="button button-secondary" id="cancel-movement" type="button">Cancelar</button>
      </div>
    </form>`;
}

function renderMovementHistory() {
  const sortedMovements = sortMovementsNewestFirst(movements);
  return `
    <section class="movements-section" aria-labelledby="movements-title">
      <div class="section-heading">
        <div>
          <p class="eyebrow">REGISTRO DEL MES</p>
          <h2 id="movements-title">Movimientos</h2>
        </div>
        ${
          activeMovementForm === null
            ? `<button class="button button-primary" id="add-movement" type="button">Agregar movimiento</button>`
            : ""
        }
      </div>
      ${activeMovementForm !== null ? renderMovementForm() : ""}
      ${
        sortedMovements.length === 0
          ? `<p class="empty-movements">Aún no hay movimientos registrados para ${monthName(activeMonth)}.</p>`
          : `<div class="movement-list">
              ${sortedMovements
                .map((movement) => {
                  const category = MOVEMENT_CATEGORIES.find(
                    (item) => item.id === movement.category,
                  );
                  return `<article class="movement-row">
                    <div class="movement-date">${formatMovementDate(movement.date)}</div>
                    <div class="movement-description">
                      <strong>${escapeHtml(movement.description)}</strong>
                      <span>${movement.type === "gasto" ? "Gasto" : "Aporte"} · ${category.label}</span>
                    </div>
                    <strong class="movement-amount">${formatCents(movement.amountCents)}</strong>
                    <div class="movement-actions">
                      <button class="button button-secondary" type="button" data-edit-movement="${escapeHtml(movement.id)}">Editar</button>
                      <button class="button button-link" type="button" data-delete-movement="${escapeHtml(movement.id)}">Eliminar</button>
                    </div>
                  </article>`;
                })
                .join("")}
            </div>`
      }
    </section>`;
}

function persistMovements(nextMovements) {
  const movementKey = `${STORAGE_PREFIX}movements:${activeMonth}`;
  const shouldPreserveDefault = !monthRecord && Boolean(defaultRecord);
  const budgetKey = `${STORAGE_PREFIX}${activeMonth}`;
  const expectedValues = {
    [movementKey]: movementStorageValue,
    [budgetKey]: budgetStorageValues[budgetKey] ?? null,
    ...(shouldPreserveDefault
      ? {
          [`${STORAGE_PREFIX}default`]:
            budgetStorageValues[`${STORAGE_PREFIX}default`] ?? null,
        }
      : {}),
  };
  const movementValue =
    nextMovements.length === 0 ? null : JSON.stringify(nextMovements);
  const snapshotValue = shouldPreserveDefault
    ? JSON.stringify({
        budgetCents: defaultRecord.budgetCents,
        preservedForHistory: true,
      })
    : null;
  const changes = {
    ...(shouldPreserveDefault ? { [budgetKey]: snapshotValue } : {}),
    [movementKey]: movementValue,
  };
  let snapshotSaved = false;

  try {
    const result = commitStorageChanges(localStorage, expectedValues, changes);
    if (result.status === "conflict") {
      showStorageConflict("el presupuesto o el historial de movimientos");
      return false;
    }
    snapshotSaved = shouldPreserveDefault;
    movementStorageValue = movementValue;
    if (shouldPreserveDefault) {
      budgetStorageValues[budgetKey] = snapshotValue;
    }
  } catch {
    showMessage("No se pudo completar el guardado del movimiento y su presupuesto mensual. Revisa el almacenamiento del navegador antes de volver a intentarlo.");
    return false;
  }

  if (snapshotSaved) {
    monthRecord = {
      budgetCents: defaultRecord.budgetCents,
      preservedForHistory: true,
    };
    showMessage(
      `Movimiento guardado. El presupuesto quedó conservado para ${monthName(activeMonth)}.`,
      "success",
    );
  } else {
    showMessage("Movimiento guardado.", "success");
  }
  movements = nextMovements;
  activeMovementForm = null;
  return true;
}

function attachMovementHandlers() {
  document.querySelector("#add-movement")?.addEventListener("click", () => {
    activeMovementForm = "new";
    render();
  });

  const form = document.querySelector("#movement-form");
  if (form) {
    document.querySelector("#movement-type").addEventListener("change", (event) => {
      const category = document.querySelector("#movement-category");
      const options = MOVEMENT_CATEGORIES.filter(
        (item) => item.type === event.currentTarget.value,
      );
      category.innerHTML = movementCategoryOptions(
        event.currentTarget.value,
        options[0].id,
      );
    });
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const error = document.querySelector("#movement-error");
      const formData = new FormData(form);
      try {
        const movementData = createMovement({
          description: formData.get("description"),
          amount: formData.get("amount"),
          date: formData.get("date"),
          category: formData.get("category"),
          selectedMonth: activeMonth,
          today: localDateKey(),
        });
        if (formData.get("type") !== movementData.type) {
          throw new TypeError("El tipo de movimiento no corresponde a la categoría.");
        }
        const editing = activeMovementForm !== "new";
        const id = editing ? activeMovementForm : createMovementId();
        const nextMovements = upsertMovement(movements, { id, ...movementData });
        if (persistMovements(nextMovements)) render();
      } catch (problem) {
        error.textContent = problem.message;
      }
    });
    document.querySelector("#cancel-movement").addEventListener("click", () => {
      activeMovementForm = null;
      render();
    });
  }

  document.querySelectorAll("[data-edit-movement]").forEach((button) => {
    button.addEventListener("click", () => {
      activeMovementForm = button.dataset.editMovement;
      render();
    });
  });
  document.querySelectorAll("[data-delete-movement]").forEach((button) => {
    button.addEventListener("click", () => {
      const movement = movementById(button.dataset.deleteMovement);
      if (!movement) return;
      if (!window.confirm(`¿Eliminar el movimiento “${movement.description}”?`)) return;
      const nextMovements = removeMovement(movements, movement.id);
      if (persistMovements(nextMovements)) render();
    });
  });
}

function renderNoBudget() {
  const noDefault = !defaultRecord;
  content.innerHTML = `
    <section class="setup-card" aria-labelledby="setup-title">
      <div class="setup-icon" aria-hidden="true">＋</div>
      <p class="eyebrow">${noDefault ? "PRESUPUESTO HABITUAL" : "ESTE MES"}</p>
      <h2 id="setup-title">${noDefault ? "Configura tu presupuesto predeterminado" : `Personaliza ${monthName(activeMonth)}`}</h2>
      <p class="card-description">${
        noDefault
          ? "Configura un monto mensual habitual para usarlo automáticamente en los meses sin una configuración propia. También puedes asignar un monto solo a este mes."
          : `No hay un monto predeterminado ni una configuración propia para ${monthName(activeMonth)}.`
      }</p>
      ${
        activeForm
          ? renderBudgetForm(activeForm)
          : `<div class="setup-actions">
              ${noDefault ? `<button class="button button-primary" id="configure-default" type="button">Configurar presupuesto predeterminado</button>` : ""}
              <button class="button ${noDefault ? "button-secondary" : "button-primary"}" id="personalize-month" type="button">Personalizar este mes</button>
            </div>`
      }
    </section>`;

  document.querySelector("#configure-default")?.addEventListener("click", () => {
    activeForm = "default";
    render();
  });
  document.querySelector("#personalize-month")?.addEventListener("click", () => {
    activeForm = "month";
    render();
  });
  attachBudgetForm();
}

function renderConfigured() {
  const allocations = calculateAllocations(activeBudget().budgetCents);
  const budgetCents = BigInt(activeBudget().budgetCents);
  const hasMovements = movements.length > 0;
  const summary = summarizeMovements(
    movements,
    allocations,
    activeBudget().budgetCents,
  );
  const monthlyPercentageHundredths =
    (summary.totalUsedCents * 10000n + budgetCents / 2n) / budgetCents;
  const monthlyBarHundredths =
    monthlyPercentageHundredths > 10000n
      ? 10000n
      : monthlyPercentageHundredths;
  const categoryIndicators = Object.fromEntries(
    MOVEMENT_CATEGORIES.map((category) => [
      category.id,
      calculateCategoryIndicator({
        assignedCents: summary.assignedByCategory[category.id],
        recordedCents: summary.recordedByCategory[category.id],
        kind: category.type,
        hasMovements,
      }),
    ]),
  );
  const monthlyOverage =
    summary.totalUsedCents > budgetCents
      ? summary.totalUsedCents - budgetCents
      : 0n;
  const usesOwnBudget = Boolean(monthRecord);
  content.innerHTML = `
    <section class="summary-card" aria-labelledby="summary-title">
      <div class="summary-topline">
        <div>
          <p class="eyebrow">PRESUPUESTO DEL MES</p>
          <h2 id="summary-title">${monthName(activeMonth)}</h2>
          <p class="budget-origin">${
            monthRecord?.preservedForHistory || monthRecord?.preservedFromDefault
              ? "Presupuesto conservado para este mes"
              : usesOwnBudget
                ? "Monto configurado para este mes"
                : "Monto del presupuesto predeterminado"
          }</p>
        </div>
        <p class="summary-amount">${formatCents(activeBudget().budgetCents)}</p>
      </div>
      <div class="budget-actions">
        ${
          activeForm
            ? renderBudgetForm(activeForm)
            : `<button class="button button-secondary" id="edit-default" type="button">Editar presupuesto predeterminado</button>
              ${
                usesOwnBudget
                  ? `<button class="button button-secondary" id="edit-month" type="button">Editar este mes</button>
                     ${defaultRecord ? `<button class="button button-link" id="use-default" type="button">Usar predeterminado</button>` : ""}`
                  : `<button class="button button-primary" id="personalize-month" type="button">Personalizar este mes</button>`
              }`
        }
      </div>
    </section>

    ${
      monthRecord?.preservedForHistory || monthRecord?.preservedFromDefault
        ? `<p class="snapshot-note">El presupuesto quedó conservado para este mes. Los cambios futuros al predeterminado no modificarán este monto.</p>`
        : ""
    }

    <section class="monthly-summary" aria-labelledby="monthly-summary-title">
      <div class="section-heading">
        <div>
          <p class="eyebrow">RESUMEN DEL MES</p>
          <h2 id="monthly-summary-title">Totales registrados</h2>
        </div>
      </div>
      <div class="summary-totals">
        <article><span>Presupuesto</span><strong>${formatCents(budgetCents)}</strong></article>
        <article><span>Total de gastos</span><strong>${formatCents(summary.expensesCents)}</strong></article>
        <article><span>Aportes a ahorro y reserva</span><strong>${formatCents(summary.savingsContributionsCents)}</strong></article>
        <article><span>Aportes a inversión</span><strong>${formatCents(summary.investmentContributionsCents)}</strong></article>
        <article class="summary-highlight"><span>Total utilizado</span><strong>${formatCents(summary.totalUsedCents)}</strong></article>
        <article class="summary-highlight available-total"><span>Saldo disponible</span><strong>${formatCents(summary.availableCents)}</strong></article>
      </div>
      ${
        hasMovements
          ? `<div class="monthly-progress">
              <div class="progress-copy">
                <span>Uso del presupuesto</span>
                <strong>${formatPercentageHundredths(monthlyPercentageHundredths)}</strong>
              </div>
              <div class="progress-track monthly-track" role="progressbar"
                aria-label="Uso del presupuesto mensual"
                aria-valuemin="0" aria-valuemax="100"
                aria-valuenow="${Number(monthlyBarHundredths) / 100}"
                aria-valuetext="${formatPercentageHundredths(monthlyPercentageHundredths)}">
                <span class="progress-fill ${monthlyOverage > 0n ? "over-limit" : ""}"
                  style="width: ${Number(monthlyBarHundredths) / 100}%"></span>
              </div>
            </div>`
          : `<p class="no-movements-note">Aún sin movimientos. Aquí se mostrarán los indicadores cuando registres el primero.</p>`
      }
      ${
        monthlyOverage > 0n
          ? `<p class="summary-warning" role="status">El total utilizado supera el presupuesto por <strong>${formatCents(monthlyOverage)}</strong>.</p>`
          : ""
      }
    </section>

    <section class="allocations-section" aria-labelledby="allocations-title">
      <div class="section-heading">
        <div>
          <p class="eyebrow">SEGUIMIENTO POR CATEGORÍA</p>
          <h2 id="allocations-title">Asignaciones e indicadores</h2>
        </div>
        <p class="allocation-total">Total <strong>${formatCents(activeBudget().budgetCents)}</strong></p>
      </div>
      <div class="category-indicators">
        ${MOVEMENT_CATEGORIES.map(
          ({ id, label, type }) => {
            const indicator = categoryIndicators[id];
            const statusLabels = {
              unassigned: "Sin monto asignado",
              "no-movements": "Aún sin movimientos",
              "within-limit": "Dentro del límite",
              "near-limit": "Cerca del límite",
              "no-balance": "Sin saldo disponible",
              "over-limit": "Límite superado",
              "no-contributions": "Aún sin aportes",
              "goal-in-progress": "Meta en progreso",
              "goal-met": "Meta cumplida",
              "above-plan": "Aporte superior al plan",
            };
            const percentage =
              indicator.percentageHundredths === null
                ? ""
                : `<span class="category-percentage">${formatPercentageHundredths(indicator.percentageHundredths)} del monto asignado</span>`;
            const details =
              type === "gasto"
                ? `<div class="category-figures">
                    <p><span>Monto utilizado</span><strong>${formatCents(indicator.recordedCents)}</strong></p>
                    <p><span>Saldo</span><strong>${formatCents(indicator.remainingCents)}</strong></p>
                  </div>
                  ${
                    indicator.excessCents > 0n
                      ? `<p class="category-excess">Exceso: <strong>${formatCents(indicator.excessCents)}</strong></p>`
                      : ""
                  }`
                : `<div class="category-figures">
                    <p><span>Monto aportado</span><strong>${formatCents(indicator.recordedCents)}</strong></p>
                    <p><span>Meta asignada</span><strong>${formatCents(indicator.assignedCents)}</strong></p>
                  </div>
                  ${
                    indicator.status === "goal-in-progress" ||
                    indicator.status === "no-contributions"
                      ? `<p class="goal-detail">Falta para la meta: <strong>${formatCents(indicator.shortfallCents)}</strong></p>`
                      : indicator.status === "above-plan"
                        ? `<p class="goal-detail">Supera la meta por <strong>${formatCents(indicator.excessCents)}</strong>.</p>`
                        : ""
                  }`;
            const bar =
              indicator.percentageHundredths === null
                ? ""
                : `<div class="progress-track category-track ${type === "aporte" ? "contribution-track" : ""}"
                    role="progressbar" aria-label="${label}"
                    aria-valuemin="0" aria-valuemax="100"
                    aria-valuenow="${Number(indicator.barHundredths) / 100}"
                    aria-valuetext="${formatPercentageHundredths(indicator.percentageHundredths)}">
                    <span class="progress-fill status-${indicator.status}"
                      style="width: ${Number(indicator.barHundredths) / 100}%"></span>
                  </div>`;
            return `<article class="category-indicator category-${id}">
              <div class="category-indicator-heading">
                <h3>${label}</h3>
                <span class="status-label status-${indicator.status}">${statusLabels[indicator.status]}</span>
              </div>
              <p class="assigned-amount">Asignado: <strong>${formatCents(indicator.assignedCents)}</strong></p>
              ${percentage}
              ${bar}
              ${details}
            </article>`;
          },
        ).join("")}
      </div>
    </section>`;
  content.insertAdjacentHTML("beforeend", renderMovementHistory());

  document.querySelector("#edit-default")?.addEventListener("click", () => {
    activeForm = "default";
    render();
  });
  document.querySelector("#personalize-month")?.addEventListener("click", () => {
    activeForm = "month";
    render();
  });
  document.querySelector("#edit-month")?.addEventListener("click", () => {
    activeForm = "month";
    render();
  });
  document.querySelector("#use-default")?.addEventListener("click", () => {
    const action = prepareDefaultApplication({
      defaultRecord,
      monthRecord,
      movements,
      month: activeMonth,
    });
    if (action.status === "unavailable") {
      showMessage("Configura un presupuesto predeterminado antes de usarlo.");
      return;
    }
    try {
      const monthStorageKey = `${STORAGE_PREFIX}${activeMonth}`;
      const movementStorageKey = `${STORAGE_PREFIX}movements:${activeMonth}`;
      const result = commitStorageChanges(
        localStorage,
        {
          [monthStorageKey]: budgetStorageValues[monthStorageKey] ?? null,
          [`${STORAGE_PREFIX}default`]:
            budgetStorageValues[`${STORAGE_PREFIX}default`] ?? null,
          [movementStorageKey]: movementStorageValue,
        },
        action.changes,
      );
      if (result.status === "conflict") {
        showStorageConflict("el presupuesto de este mes");
        return;
      }
      budgetStorageValues[monthStorageKey] =
        action.changes[monthStorageKey];
      activeForm = null;
      if (action.status === "preserved") {
        showMessage(
          `El presupuesto actual quedó conservado para ${monthName(activeMonth)}; los movimientos se mantuvieron sin cambios.`,
          "success",
        );
      } else {
        showMessage("Ahora se usará el presupuesto predeterminado.", "success");
      }
      loadBudgets(activeMonth);
      render();
    } catch {
      showMessage("No se pudo actualizar el presupuesto de este mes. Inténtalo de nuevo.");
    }
  });
  attachBudgetForm();
  attachMovementHandlers();
}

function render() {
  if (storageError) {
    content.innerHTML = `
      <section class="setup-card error-card">
        <p class="eyebrow">CONFIGURACIÓN NO DISPONIBLE</p>
        <h2>No se pudo cargar el presupuesto</h2>
        <p class="card-description">${storageError}</p>
      </section>`;
    return;
  }
  if (!activeBudget()) {
    renderNoBudget();
  } else {
    renderConfigured();
  }
}

function buildMonthSelectors() {
  monthSelect.innerHTML = MONTHS.map(
    (month, index) => `<option value="${index}">${month[0].toLocaleUpperCase("es-PE")}${month.slice(1)}</option>`,
  ).join("");
  syncMonthControls();
}

activeMonth = currentMonth();
loadBudgets(activeMonth);
buildMonthSelectors();
render();

monthSelect.addEventListener("change", () => {
  const monthNumber = Number(monthSelect.value) + 1;
  const year = Number(yearSelect.value);
  selectMonth(monthKey(year, monthNumber));
});

yearSelect.addEventListener("change", () => {
  const year = Number(yearSelect.value);
  const monthNumber = Number(monthSelect.value) + 1;
  selectMonth(monthKey(year, monthNumber));
});

previousMonthButton.addEventListener("click", () => {
  selectMonth(shiftMonth(activeMonth, -1));
});

nextMonthButton.addEventListener("click", () => {
  selectMonth(shiftMonth(activeMonth, 1));
});

currentMonthButton.addEventListener("click", () => {
  selectMonth(currentMonth());
});

window.addEventListener("storage", (event) => {
  const currentKeys = new Set([
    `${STORAGE_PREFIX}default`,
    `${STORAGE_PREFIX}${activeMonth}`,
    `${STORAGE_PREFIX}movements:${activeMonth}`,
  ]);
  if (event.key === null || currentKeys.has(event.key)) {
    showStorageConflict("la configuración abierta");
  }
});
