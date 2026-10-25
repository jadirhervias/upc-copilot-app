import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateAllocations,
  calculateCategoryIndicator,
  commitStorageChanges,
  createMovement,
  formatCents,
  formatPercentageHundredths,
  localDateKey,
  normalizeMovements,
  normalizeBudgetRecord,
  MOVEMENT_CATEGORIES,
  parseMoneyToCents,
  prepareDefaultApplication,
  removeMovement,
  sortMovementsNewestFirst,
  summarizeMovements,
  shiftMonth,
  upsertMovement,
} from "../budget.mjs";

function createMemoryStorage(initialValues = {}) {
  const values = new Map(Object.entries(initialValues));
  return {
    getItem(key) {
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    removeItem(key) {
      values.delete(key);
    },
  };
}

test("acepta montos positivos con hasta dos decimales", () => {
  assert.equal(parseMoneyToCents("2500"), 250000);
  assert.equal(parseMoneyToCents("2500.5"), 250050);
  assert.equal(parseMoneyToCents("2500,50"), 250050);
  assert.equal(parseMoneyToCents("0.01"), 1);
});

test("rechaza cero, montos mal formados y más de dos decimales", () => {
  for (const value of ["0", "0.00", "-1", "1.234", "1,2.3", ""]) {
    assert.throws(() => parseMoneyToCents(value));
  }
});

test("formatea céntimos negativos, cero y positivos con moneda peruana", () => {
  const cases = [
    [-1, "-S/\u00a00.01"],
    [-50, "-S/\u00a00.50"],
    [-99, "-S/\u00a00.99"],
    [-100, "-S/\u00a01.00"],
    [-101, "-S/\u00a01.01"],
    [0, "S/\u00a00.00"],
    [1, "S/\u00a00.01"],
    [50, "S/\u00a00.50"],
    [101, "S/\u00a01.01"],
  ];
  for (const [cents, expected] of cases) {
    assert.equal(formatCents(cents), expected);
  }
});

test("distribuye S/ 5,000 según las cuatro categorías solicitadas", () => {
  assert.deepEqual(calculateAllocations(500000), {
    essentialsCents: 250000,
    investmentCents: 125000,
    savingsReserveCents: 75000,
    personalExpensesCents: 50000,
  });
});

test("las cuatro categorías suman exactamente el presupuesto", () => {
  for (let budgetCents = 1; budgetCents <= 10000; budgetCents += 1) {
    const allocation = calculateAllocations(budgetCents);
    assert.equal(
      allocation.essentialsCents +
        allocation.investmentCents +
        allocation.savingsReserveCents +
        allocation.personalExpensesCents,
      budgetCents,
    );
  }
});

test("clasifica con exactitud los límites de gasto del 80 % y el 100 %", () => {
  const indicator = (recordedCents) =>
    calculateCategoryIndicator({
      assignedCents: 10000,
      recordedCents,
      kind: "gasto",
    });

  assert.equal(indicator(7999).status, "within-limit");
  assert.equal(indicator(7999).percentageHundredths, 7999n);
  assert.equal(indicator(8000).status, "near-limit");
  assert.equal(indicator(9999).status, "near-limit");
  assert.equal(indicator(10000).status, "no-balance");
  assert.equal(indicator(10001).status, "over-limit");
  assert.equal(indicator(10001).excessCents, 1n);
  assert.equal(indicator(10001).barHundredths, 10000n);
});

test("clasifica las metas de ahorro e inversión incompletas, cumplidas y superadas", () => {
  const allocations = calculateAllocations(100000);
  const assignedByCategory = {
    "ahorro-reserva": allocations.savingsReserveCents,
    inversion: allocations.investmentCents,
  };
  for (const { id, type } of MOVEMENT_CATEGORIES.filter(
    (category) => category.type === "aporte",
  )) {
    const assignedCents = assignedByCategory[id];
    const indicator = (recordedCents) =>
      calculateCategoryIndicator({
        assignedCents,
        recordedCents,
        kind: type,
      });
    assert.equal(indicator(0).status, "no-contributions");
    assert.equal(indicator(0).shortfallCents, BigInt(assignedCents));
    assert.equal(indicator(assignedCents - 1).status, "goal-in-progress");
    assert.equal(indicator(assignedCents - 1).shortfallCents, 1n);
    assert.equal(indicator(assignedCents).status, "goal-met");
    assert.equal(indicator(assignedCents + 1).status, "above-plan");
    assert.equal(indicator(assignedCents + 1).excessCents, 1n);
    assert.equal(indicator(assignedCents + 1).remainingCents, -1n);
  }
});

test("no calcula porcentajes si la asignación es cero", () => {
  const indicator = calculateCategoryIndicator({
    assignedCents: 0,
    recordedCents: 50,
    kind: "gasto",
  });
  assert.equal(indicator.status, "unassigned");
  assert.equal(indicator.percentageHundredths, null);
  assert.equal(indicator.barHundredths, 0n);
  assert.equal(indicator.recordedCents, 50n);
  assert.equal(indicator.remainingCents, -50n);
  assert.equal(formatPercentageHundredths(7999n), "79,99 %");
});

test("sin movimientos no presenta el gasto como un estado favorable", () => {
  const indicator = calculateCategoryIndicator({
    assignedCents: 5000,
    recordedCents: 0,
    kind: "gasto",
    hasMovements: false,
  });
  assert.equal(indicator.status, "no-movements");
  assert.equal(indicator.percentageHundredths, 0n);
});

test("detecta exceso de categoría aunque el total mensual siga dentro del presupuesto", () => {
  const allocations = calculateAllocations(10000);
  const movement = {
    id: "m1",
    description: "Compra",
    amountCents: 5001,
    date: "2026-10-24",
    category: "gastos-esenciales",
    type: "gasto",
  };
  const summary = summarizeMovements([movement], allocations, 10000);
  const indicator = calculateCategoryIndicator({
    assignedCents: summary.assignedByCategory["gastos-esenciales"],
    recordedCents: summary.recordedByCategory["gastos-esenciales"],
    kind: "gasto",
  });
  assert.equal(indicator.status, "over-limit");
  assert.equal(indicator.excessCents, 1n);
  assert.ok(summary.totalUsedCents <= 10000n);
});

test("detecta el exceso total mensual sin limitar el saldo negativo", () => {
  const budgetCents = 10000;
  const summary = summarizeMovements(
    [
      {
        id: "m1",
        description: "Compra",
        amountCents: 5001,
        date: "2026-10-24",
        category: "gastos-esenciales",
        type: "gasto",
      },
      {
        id: "m2",
        description: "Compra personal",
        amountCents: 5000,
        date: "2026-10-24",
        category: "gastos-personales",
        type: "gasto",
      },
    ],
    calculateAllocations(budgetCents),
    budgetCents,
  );
  assert.equal(summary.totalUsedCents, 10001n);
  assert.equal(summary.availableCents, -1n);
});

test("mantiene la suma exacta con el mayor presupuesto seguro", () => {
  const allocation = calculateAllocations(Number.MAX_SAFE_INTEGER);
  assert.equal(
    allocation.essentialsCents +
      allocation.investmentCents +
      allocation.savingsReserveCents +
      allocation.personalExpensesCents,
    Number.MAX_SAFE_INTEGER,
  );
  assert.throws(() => parseMoneyToCents("90071992547409.92"));
});

test("la navegación mensual cruza correctamente entre diciembre y enero", () => {
  assert.equal(shiftMonth("2026-12", 1), "2027-01");
  assert.equal(shiftMonth("2027-01", -1), "2026-12");
  assert.equal(shiftMonth("2026-10", 0), "2026-10");
  assert.equal(shiftMonth("0001-12", 1), "0002-01");
  assert.throws(() => shiftMonth("2026-13", 1));
});

test("conserva el presupuesto guardado e ignora la antigua división de inversión", () => {
  const oldRecord = { budgetCents: 500000, mainPercent: 85 };
  assert.deepEqual(normalizeBudgetRecord(oldRecord), { budgetCents: 500000 });
  assert.deepEqual(normalizeBudgetRecord(normalizeBudgetRecord(oldRecord)), {
    budgetCents: 500000,
  });
  assert.deepEqual(
    normalizeBudgetRecord({ budgetCents: 200000, preservedFromDefault: true }),
    { budgetCents: 200000, preservedFromDefault: true },
  );
  assert.deepEqual(
    normalizeBudgetRecord({ budgetCents: 200000, preservedForHistory: true }),
    { budgetCents: 200000, preservedForHistory: true },
  );
  assert.deepEqual(oldRecord, { budgetCents: 500000, mainPercent: 85 });
  assert.equal(normalizeBudgetRecord({ budgetCents: 0 }), null);
  assert.equal(normalizeBudgetRecord({ budgetCents: 1.5 }), null);
});

test("no permite volver al predeterminado si no existe uno", () => {
  assert.deepEqual(
    prepareDefaultApplication({
      defaultRecord: null,
      monthRecord: { budgetCents: 200000 },
      movements: [],
      month: "2026-10",
    }),
    { status: "unavailable" },
  );
});

test("aplicar el predeterminado sin movimientos quita solo la excepción del mes", () => {
  const storage = createMemoryStorage({
    "mi-presupuesto:v1:default": JSON.stringify({ budgetCents: 300000 }),
    "mi-presupuesto:v1:2026-10": JSON.stringify({ budgetCents: 200000 }),
    "mi-presupuesto:v1:movements:2026-10": "[]",
  });
  const action = prepareDefaultApplication({
    defaultRecord: { budgetCents: 300000 },
    monthRecord: { budgetCents: 200000 },
    movements: [],
    month: "2026-10",
  });
  assert.equal(action.status, "applied");
  assert.equal(
    commitStorageChanges(
      storage,
      { "mi-presupuesto:v1:2026-10": storage.getItem("mi-presupuesto:v1:2026-10") },
      action.changes,
    ).status,
    "saved",
  );
  assert.equal(storage.getItem("mi-presupuesto:v1:2026-10"), null);
  assert.equal(storage.getItem("mi-presupuesto:v1:movements:2026-10"), "[]");
});

test("no quita la excepción si aparece un movimiento antes de aplicar el predeterminado", () => {
  const monthKey = "mi-presupuesto:v1:2026-10";
  const movementKey = "mi-presupuesto:v1:movements:2026-10";
  const storage = createMemoryStorage({
    "mi-presupuesto:v1:default": JSON.stringify({ budgetCents: 300000 }),
    [monthKey]: JSON.stringify({ budgetCents: 200000 }),
    [movementKey]: null,
  });
  const action = prepareDefaultApplication({
    defaultRecord: { budgetCents: 300000 },
    monthRecord: { budgetCents: 200000 },
    movements: [],
    month: "2026-10",
  });
  storage.setItem(
    movementKey,
    JSON.stringify([{ id: "m1", description: "Movimiento nuevo" }]),
  );
  const result = commitStorageChanges(
    storage,
    {
      [monthKey]: JSON.stringify({ budgetCents: 200000 }),
      [movementKey]: null,
      "mi-presupuesto:v1:default": JSON.stringify({ budgetCents: 300000 }),
    },
    action.changes,
  );
  assert.equal(result.status, "conflict");
  assert.equal(
    storage.getItem(monthKey),
    JSON.stringify({ budgetCents: 200000 }),
  );
  assert.equal(JSON.parse(storage.getItem(movementKey))[0].id, "m1");
});

test("aplicar predeterminado con movimientos conserva el presupuesto histórico", () => {
  const movementKey = "mi-presupuesto:v1:movements:2026-10";
  const monthKey = "mi-presupuesto:v1:2026-10";
  const movements = [{ id: "m1", amountCents: 10000 }];
  const storage = createMemoryStorage({
    "mi-presupuesto:v1:default": JSON.stringify({ budgetCents: 300000 }),
    [monthKey]: JSON.stringify({ budgetCents: 200000 }),
    [movementKey]: JSON.stringify(movements),
  });
  const action = prepareDefaultApplication({
    defaultRecord: { budgetCents: 300000 },
    monthRecord: { budgetCents: 200000 },
    movements,
    month: "2026-10",
  });
  assert.equal(action.status, "preserved");
  assert.equal(
    commitStorageChanges(
      storage,
      { [monthKey]: storage.getItem(monthKey) },
      action.changes,
    ).status,
    "saved",
  );
  assert.deepEqual(JSON.parse(storage.getItem(monthKey)), {
    budgetCents: 200000,
    preservedForHistory: true,
  });
  assert.equal(storage.getItem(movementKey), JSON.stringify(movements));
  storage.setItem(
    "mi-presupuesto:v1:default",
    JSON.stringify({ budgetCents: 400000 }),
  );
  assert.equal(JSON.parse(storage.getItem(monthKey)).budgetCents, 200000);
  assert.equal(storage.getItem(movementKey), JSON.stringify(movements));
});

test("dos sesiones con una versión obsoleta no sobrescriben movimientos compartidos", () => {
  const key = "mi-presupuesto:v1:movements:2026-10";
  const monthKey = "mi-presupuesto:v1:2026-10";
  const defaultKey = "mi-presupuesto:v1:default";
  const initial = JSON.stringify([
    { id: "m1", description: "Compra inicial", amountCents: 1000 },
  ]);
  const storage = createMemoryStorage({
    [defaultKey]: JSON.stringify({ budgetCents: 200000 }),
    [monthKey]: null,
    [key]: initial,
  });
  const openSession = (description, amountCents) => {
    const loadedValue = storage.getItem(key);
    const loadedBudgetValue = storage.getItem(monthKey);
    const loadedDefaultValue = storage.getItem(defaultKey);
    const loadedMovements = JSON.parse(loadedValue);
    const formDraft = {
      id: `new-${description.slice(-1).toLowerCase()}`,
      description,
      amountCents,
    };
    return {
      draft: formDraft,
      save() {
        const nextValue = JSON.stringify([...loadedMovements, formDraft]);
        return commitStorageChanges(
          storage,
          {
            [key]: loadedValue,
            [monthKey]: loadedBudgetValue,
            [defaultKey]: loadedDefaultValue,
          },
          {
            [monthKey]: JSON.stringify({
              budgetCents: 200000,
              preservedForHistory: true,
            }),
            [key]: nextValue,
          },
        );
      },
    };
  };
  const sessionA = openSession("Movimiento nuevo A", 1500);
  const sessionB = openSession("Movimiento nuevo B", 2000);
  assert.equal(sessionA.save().status, "saved");
  const conflict = sessionB.save();
  assert.equal(conflict.status, "conflict");
  assert.deepEqual(conflict.conflictingKeys, [key, monthKey]);
  assert.deepEqual(JSON.parse(storage.getItem(key)), [
    { id: "m1", description: "Compra inicial", amountCents: 1000 },
    { id: "new-a", description: "Movimiento nuevo A", amountCents: 1500 },
  ]);
  assert.deepEqual(JSON.parse(storage.getItem(monthKey)), {
    budgetCents: 200000,
    preservedForHistory: true,
  });
  assert.deepEqual(sessionB.draft, {
    id: "new-b",
    description: "Movimiento nuevo B",
    amountCents: 2000,
  });
});

test("valida y clasifica movimientos de gasto y aporte", () => {
  assert.deepEqual(
    createMovement({
      description: "  Mercado  ",
      amount: "100.00",
      date: "2026-10-24",
      category: "gastos-esenciales",
      selectedMonth: "2026-10",
      today: "2026-10-24",
    }),
    {
      description: "Mercado",
      amountCents: 10000,
      date: "2026-10-24",
      category: "gastos-esenciales",
      type: "gasto",
    },
  );
  assert.equal(
    createMovement({
      description: "Fondo",
      amount: "50",
      date: "2026-10-24",
      category: "ahorro-reserva",
      selectedMonth: "2026-10",
      today: "2026-10-24",
    }).type,
    "aporte",
  );
});

test("rechaza descripción, monto y fecha inválidos o fuera del mes", () => {
  const base = {
    description: "Movimiento",
    amount: "1.00",
    date: "2026-10-24",
    category: "gastos-esenciales",
    selectedMonth: "2026-10",
    today: "2026-10-24",
  };
  for (const patch of [
    { description: " " },
    { amount: "0" },
    { amount: "-1" },
    { amount: "1.001" },
    { date: "" },
    { date: "2026-02-30" },
    { date: "2026-11-01" },
    { date: "2026-10-25" },
    { category: "otra" },
  ]) {
    assert.throws(() => createMovement({ ...base, ...patch }));
  }
});

test("registra cuatro movimientos una vez y calcula S/ 250 utilizados y S/ 1,750 disponibles", () => {
  const descriptions = [
    ["Gastos esenciales", "gastos-esenciales", "100"],
    ["Ahorro", "ahorro-reserva", "50"],
    ["Inversión", "inversion", "80"],
    ["Gastos personales", "gastos-personales", "20"],
  ];
  const movements = descriptions.map(([description, category, amount], index) => ({
    id: `mov-${index}`,
    ...createMovement({
      description,
      amount,
      date: "2026-10-24",
      category,
      selectedMonth: "2026-10",
      today: "2026-10-24",
    }),
  }));
  const summary = summarizeMovements(
    movements,
    calculateAllocations(200000),
    200000,
  );
  assert.equal(summary.expensesCents, 12000n);
  assert.equal(summary.savingsContributionsCents, 5000n);
  assert.equal(summary.investmentContributionsCents, 8000n);
  assert.equal(summary.totalUsedCents, 25000n);
  assert.equal(summary.availableCents, 175000n);
});

test("editar reemplaza el movimiento sin duplicarlo y eliminar actualiza la lista", () => {
  const first = { id: "m1", amountCents: 100 };
  const second = { id: "m2", amountCents: 200 };
  const edited = { id: "m1", amountCents: 150 };
  const updated = upsertMovement([first, second], edited);
  assert.deepEqual(updated, [edited, second]);
  assert.equal(updated.length, 2);
  assert.deepEqual(removeMovement(updated, "m1"), [second]);
});

test("ordena los movimientos del día más reciente al más antiguo", () => {
  const movements = [
    { id: "viejo", date: "2026-10-01" },
    { id: "nuevo", date: "2026-10-24" },
    { id: "medio", date: "2026-10-12" },
  ];
  assert.deepEqual(
    sortMovementsNewestFirst(movements).map((movement) => movement.id),
    ["nuevo", "medio", "viejo"],
  );
  assert.equal(movements[0].id, "viejo");
});

test("el almacenamiento rechaza movimientos duplicados o de otro mes", () => {
  const movement = {
    id: "m1",
    description: "Compra",
    amountCents: 100,
    date: "2026-10-24",
    category: "gastos-esenciales",
    type: "gasto",
  };
  assert.deepEqual(normalizeMovements([movement], "2026-10"), [movement]);
  assert.equal(normalizeMovements([movement, movement], "2026-10"), null);
  assert.equal(normalizeMovements([movement], "2026-11"), null);
  assert.equal(localDateKey(new Date(2026, 9, 24)), "2026-10-24");
});

test("los totales y saldos negativos se conservan exactos en céntimos", () => {
  const movements = [
    {
      id: "m1",
      description: "Compra grande",
      amountCents: 300000,
      date: "2026-10-24",
      category: "gastos-esenciales",
      type: "gasto",
    },
  ];
  const summary = summarizeMovements(
    movements,
    calculateAllocations(200000),
    200000,
  );
  assert.equal(summary.availableCents, -100000n);
  assert.equal(summary.remainingByCategory["gastos-esenciales"], -200000n);
});
