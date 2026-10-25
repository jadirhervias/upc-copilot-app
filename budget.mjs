const MAX_SAFE_CENTS = BigInt(Number.MAX_SAFE_INTEGER);
const ALLOCATION_DENOMINATOR = 100n;
const PEN_CURRENCY_FORMATTER = new Intl.NumberFormat("es-PE", {
  style: "currency",
  currency: "PEN",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
export const MOVEMENT_CATEGORIES = [
  { id: "gastos-esenciales", label: "Gastos esenciales", type: "gasto" },
  { id: "inversion", label: "Inversión", type: "aporte" },
  { id: "ahorro-reserva", label: "Ahorro y reserva", type: "aporte" },
  { id: "gastos-personales", label: "Gastos personales", type: "gasto" },
];

function isValidDate(date) {
  const match = /^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.exec(date);
  if (!match) return false;
  const [year, month, day] = match.slice(1).map(Number);
  const parsed = new Date(0);
  parsed.setUTCFullYear(year, month - 1, day);
  parsed.setUTCHours(0, 0, 0, 0);
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
}

export function localDateKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function shiftMonth(month, offset) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || !Number.isInteger(offset)) {
    throw new TypeError("Selecciona un mes válido.");
  }
  const [year, monthNumber] = month.split("-").map(Number);
  const monthIndex = year * 12 + monthNumber - 1 + offset;
  const nextYear = Math.floor(monthIndex / 12);
  const nextMonth = (monthIndex % 12) + 1;
  if (nextYear < 1 || nextYear > 9999) {
    throw new RangeError("No hay más meses disponibles en esa dirección.");
  }
  return `${String(nextYear).padStart(4, "0")}-${String(nextMonth).padStart(2, "0")}`;
}

export function parseMoneyToCents(value) {
  const input = String(value).trim();
  const match = /^(\d+)(?:[.,](\d{1,2}))?$/.exec(input);
  if (!match) {
    throw new TypeError("Ingresa un monto con máximo dos decimales.");
  }

  const whole = BigInt(match[1]);
  const fraction = BigInt((match[2] ?? "").padEnd(2, "0") || "0");
  const cents = whole * 100n + fraction;
  if (cents > MAX_SAFE_CENTS) {
    throw new RangeError("El monto es demasiado grande.");
  }
  if (cents === 0n) {
    throw new RangeError("El monto debe ser mayor que cero.");
  }
  return Number(cents);
}

export function formatCents(cents) {
  const value = BigInt(cents);
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const whole = absolute / 100n;
  const fraction = String(absolute % 100n).padStart(2, "0");
  const parts = PEN_CURRENCY_FORMATTER.formatToParts(whole).map((part) =>
    part.type === "fraction" ? { ...part, value: fraction } : part,
  );

  if (negative) {
    const minusSign = PEN_CURRENCY_FORMATTER.formatToParts(-1n).find(
      (part) => part.type === "minusSign",
    );
    if (minusSign) parts.unshift(minusSign);
  }
  return parts.map((part) => part.value).join("");
}

function roundRatio(amount, percentage) {
  return Number(
    (BigInt(amount) * BigInt(percentage) + ALLOCATION_DENOMINATOR / 2n) /
      ALLOCATION_DENOMINATOR,
  );
}

export function calculateAllocations(budgetCents) {
  if (!Number.isSafeInteger(budgetCents) || budgetCents <= 0) {
    throw new RangeError("El presupuesto debe ser un monto positivo válido.");
  }

  const essentialsCents = roundRatio(budgetCents, 50);
  const investmentCents = roundRatio(budgetCents, 25);
  const savingsReserveCents = roundRatio(budgetCents, 15);
  const personalExpensesCents =
    budgetCents - essentialsCents - investmentCents - savingsReserveCents;

  return {
    essentialsCents,
    investmentCents,
    savingsReserveCents,
    personalExpensesCents,
  };
}

export function normalizeBudgetRecord(value) {
  if (
    value === null ||
    typeof value !== "object" ||
    !Number.isSafeInteger(value.budgetCents) ||
    value.budgetCents <= 0
  ) {
    return null;
  }

  return {
    budgetCents: value.budgetCents,
    ...(value.preservedFromDefault === true ? { preservedFromDefault: true } : {}),
    ...(value.preservedForHistory === true ? { preservedForHistory: true } : {}),
  };
}

export function createMovement({
  description,
  amount,
  date,
  category,
  selectedMonth,
  today = localDateKey(),
}) {
  const cleanDescription = String(description ?? "").trim();
  if (!cleanDescription) {
    throw new TypeError("La descripción es obligatoria.");
  }
  if (!date) {
    throw new TypeError("La fecha es obligatoria.");
  }
  if (!isValidDate(date)) {
    throw new TypeError("Ingresa una fecha válida.");
  }
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(selectedMonth)) {
    throw new TypeError("Selecciona un mes válido.");
  }
  if (date.slice(0, 7) !== selectedMonth) {
    throw new RangeError("La fecha debe pertenecer al mes seleccionado.");
  }
  if (!isValidDate(today) || date > today) {
    throw new RangeError("La fecha no puede ser futura.");
  }

  const categoryDefinition = MOVEMENT_CATEGORIES.find((item) => item.id === category);
  if (!categoryDefinition) {
    throw new TypeError("Selecciona una categoría válida.");
  }

  return {
    description: cleanDescription,
    amountCents: parseMoneyToCents(amount),
    date,
    category: categoryDefinition.id,
    type: categoryDefinition.type,
  };
}

export function normalizeMovements(value, selectedMonth) {
  if (!Array.isArray(value)) return null;
  const seenIds = new Set();
  const normalized = [];

  for (const movement of value) {
    const movementId =
      movement && typeof movement.id === "string" ? movement.id.trim() : "";
    if (
      movement === null ||
      typeof movement !== "object" ||
      !movementId ||
      seenIds.has(movementId) ||
      typeof movement.description !== "string" ||
      !movement.description.trim() ||
      !Number.isSafeInteger(movement.amountCents) ||
      movement.amountCents <= 0 ||
      !isValidDate(movement.date) ||
      movement.date.slice(0, 7) !== selectedMonth
    ) {
      return null;
    }
    const categoryDefinition = MOVEMENT_CATEGORIES.find(
      (item) => item.id === movement.category,
    );
    if (!categoryDefinition || movement.type !== categoryDefinition.type) {
      return null;
    }
    seenIds.add(movementId);
    normalized.push({
      id: movementId,
      description: movement.description.trim(),
      amountCents: movement.amountCents,
      date: movement.date,
      category: movement.category,
      type: movement.type,
    });
  }
  return normalized;
}

export function upsertMovement(movements, movement) {
  const existingIndex = movements.findIndex((item) => item.id === movement.id);
  if (existingIndex === -1) return [...movements, movement];
  return movements.map((item, index) =>
    index === existingIndex ? movement : item,
  );
}

export function removeMovement(movements, movementId) {
  return movements.filter((movement) => movement.id !== movementId);
}

export function sortMovementsNewestFirst(movements) {
  return [...movements].sort((left, right) =>
    right.date.localeCompare(left.date),
  );
}

export function summarizeMovements(movements, allocations, budgetCents) {
  const recordedByCategory = Object.fromEntries(
    MOVEMENT_CATEGORIES.map(({ id }) => [id, 0n]),
  );
  for (const movement of movements) {
    recordedByCategory[movement.category] += BigInt(movement.amountCents);
  }

  const assignedByCategory = {
    "gastos-esenciales": BigInt(allocations.essentialsCents),
    inversion: BigInt(allocations.investmentCents),
    "ahorro-reserva": BigInt(allocations.savingsReserveCents),
    "gastos-personales": BigInt(allocations.personalExpensesCents),
  };
  const remainingByCategory = Object.fromEntries(
    MOVEMENT_CATEGORIES.map(({ id }) => [
      id,
      assignedByCategory[id] - recordedByCategory[id],
    ]),
  );
  const expensesCents =
    recordedByCategory["gastos-esenciales"] +
    recordedByCategory["gastos-personales"];
  const savingsContributionsCents = recordedByCategory["ahorro-reserva"];
  const investmentContributionsCents = recordedByCategory.inversion;
  const totalUsedCents =
    expensesCents + savingsContributionsCents + investmentContributionsCents;

  return {
    recordedByCategory,
    assignedByCategory,
    remainingByCategory,
    expensesCents,
    savingsContributionsCents,
    investmentContributionsCents,
    totalUsedCents,
    availableCents: BigInt(budgetCents) - totalUsedCents,
  };
}

function asCentsBigInt(value, name) {
  if (
    typeof value !== "bigint" &&
    (!Number.isSafeInteger(value) || value < 0)
  ) {
    throw new RangeError(`${name} debe ser una cantidad válida de céntimos.`);
  }
  const cents = BigInt(value);
  if (cents < 0n) {
    throw new RangeError(`${name} no puede ser negativo.`);
  }
  return cents;
}

export function calculateCategoryIndicator({
  assignedCents,
  recordedCents,
  kind,
  hasMovements = true,
}) {
  if (kind !== "gasto" && kind !== "aporte") {
    throw new TypeError("El tipo de categoría no es válido.");
  }
  const assigned = asCentsBigInt(assignedCents, "El monto asignado");
  const recorded = asCentsBigInt(recordedCents, "El monto registrado");
  const remaining = assigned - recorded;

  if (assigned === 0n) {
    return {
      status: "unassigned",
      assignedCents: assigned,
      recordedCents: recorded,
      remainingCents: remaining,
      excessCents: recorded,
      shortfallCents: 0n,
      percentageHundredths: null,
      barHundredths: 0n,
    };
  }

  const percentageHundredths =
    (recorded * 10000n + assigned / 2n) / assigned;
  const barHundredths =
    percentageHundredths > 10000n ? 10000n : percentageHundredths;

  if (kind === "gasto") {
    let status;
    if (recorded === 0n && !hasMovements) status = "no-movements";
    else if (recorded * 100n < assigned * 80n) status = "within-limit";
    else if (recorded < assigned) status = "near-limit";
    else if (recorded === assigned) status = "no-balance";
    else status = "over-limit";

    return {
      status,
      assignedCents: assigned,
      recordedCents: recorded,
      remainingCents: remaining,
      excessCents: recorded > assigned ? recorded - assigned : 0n,
      shortfallCents: 0n,
      percentageHundredths,
      barHundredths,
    };
  }

  let status;
  if (recorded === 0n) status = "no-contributions";
  else if (recorded < assigned) status = "goal-in-progress";
  else if (recorded === assigned) status = "goal-met";
  else status = "above-plan";

  return {
    status,
    assignedCents: assigned,
    recordedCents: recorded,
    remainingCents: remaining,
    excessCents: recorded > assigned ? recorded - assigned : 0n,
    shortfallCents: recorded < assigned ? assigned - recorded : 0n,
    percentageHundredths,
    barHundredths,
  };
}

export function formatPercentageHundredths(hundredths) {
  const value = BigInt(hundredths);
  const whole = value / 100n;
  const decimal = String(value % 100n).padStart(2, "0");
  return `${whole},${decimal} %`;
}

export function prepareDefaultApplication({
  defaultRecord,
  monthRecord,
  movements,
  month,
}) {
  if (!defaultRecord) return { status: "unavailable" };
  if (movements.length > 0) {
    const budgetCents = monthRecord?.budgetCents ?? defaultRecord.budgetCents;
    return {
      status: "preserved",
      changes: {
        [`mi-presupuesto:v1:${month}`]: JSON.stringify({
          budgetCents,
          preservedForHistory: true,
        }),
      },
    };
  }
  return {
    status: "applied",
    changes: { [`mi-presupuesto:v1:${month}`]: null },
  };
}

export function commitStorageChanges(storage, expectedValues, changes) {
  const conflictingKeys = Object.keys(expectedValues).filter(
    (key) => storage.getItem(key) !== expectedValues[key],
  );
  if (conflictingKeys.length > 0) {
    return { status: "conflict", conflictingKeys };
  }

  const writtenKeys = [];
  try {
    for (const [key, value] of Object.entries(changes)) {
      if (value === null) storage.removeItem(key);
      else storage.setItem(key, value);
      writtenKeys.push(key);
    }
  } catch (problem) {
    const rollbackErrors = [];
    for (const key of writtenKeys.reverse()) {
      try {
        const previousValue = expectedValues[key];
        if (previousValue === null) storage.removeItem(key);
        else storage.setItem(key, previousValue);
      } catch (rollbackProblem) {
        rollbackErrors.push(rollbackProblem);
      }
    }
    if (rollbackErrors.length > 0) {
      throw new AggregateError(
        [problem, ...rollbackErrors],
        "No se pudo guardar ni restaurar completamente el almacenamiento.",
      );
    }
    throw problem;
  }
  return { status: "saved" };
}
