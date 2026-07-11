/** Campos monetarios que Firestore guarda en cada documento de `pagos`. */
export const PAGO_FIRESTORE_MONEY_FIELDS = [
  'mora',
  'consumo',
  'cuotaMantenimiento',
  'otros',
  'ajustes',
  'total',
  'pago',
  'diferencia',
  'saldoAnterior',
] as const;

export type PagoFirestoreMoneyField = (typeof PAGO_FIRESTORE_MONEY_FIELDS)[number];

export type PagoMoneyFields = {
  mora: number;
  consumo: number;
  cuotaMantenimiento: number;
  otros: number;
  ajustes: number;
  total: number;
  pago: number;
  diferencia: number;
  saldoAnterior?: number;
};

function moneyToCents(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100 + (value >= 0 ? Number.EPSILON : -Number.EPSILON));
}

function centsToMoney(cents: number): number {
  return cents / 100;
}

/** Redondea montos a 2 decimales usando centavos (enteros) para evitar errores de float. */
export function roundMoney(value: number): number {
  return centsToMoney(moneyToCents(value));
}

export function parseMoneyField(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return roundMoney(value);
}

export function formatMoneyInput(value: number): string {
  return roundMoney(value).toFixed(2);
}

/** Consumo de agua más saldo anterior del período previo (crédito negativo, deuda positiva). */
export function mergeConsumoWithSaldoAnterior(
  consumo: number,
  saldoAnterior?: number
): number {
  if (saldoAnterior == null) return roundMoney(consumo);
  return roundMoney(consumo + saldoAnterior);
}

/** Suma en centavos; el total coincide con mora + consumo + mantenimiento + otros + ajustes. */
export function computePagoTotalFromParts(input: {
  mora: number;
  consumo: number;
  cuotaMantenimiento: number;
  otros: number;
  ajustes: number;
}): number {
  const cents =
    moneyToCents(input.mora) +
    moneyToCents(input.consumo) +
    moneyToCents(input.cuotaMantenimiento) +
    moneyToCents(input.otros) +
    moneyToCents(input.ajustes);
  return centsToMoney(cents);
}

export function toPagoMoneyFields(data: {
  mora: number;
  consumo: number;
  cuotaMantenimiento: number;
  otros: number;
  ajustes: number;
  pago: number;
  saldoAnterior?: number;
  /** Al registrar un pago nuevo, el consumo de agua se combina con el saldo anterior. */
  mergeSaldoIntoConsumo?: boolean;
}): PagoMoneyFields {
  const mora = roundMoney(data.mora);
  const consumoBase = roundMoney(data.consumo);
  const cuotaMantenimiento = roundMoney(data.cuotaMantenimiento);
  const otros = roundMoney(data.otros);
  const ajustes = roundMoney(data.ajustes);
  const saldoAnterior = data.saldoAnterior != null ? roundMoney(data.saldoAnterior) : undefined;
  const shouldMergeSaldo = data.mergeSaldoIntoConsumo ?? Boolean(saldoAnterior);
  const consumo =
    shouldMergeSaldo && saldoAnterior != null
      ? mergeConsumoWithSaldoAnterior(consumoBase, saldoAnterior)
      : consumoBase;
  const total = computePagoTotalFromParts({
    mora,
    consumo,
    cuotaMantenimiento,
    otros,
    ajustes,
  });
  const pago = roundMoney(data.pago);
  const diferencia = roundMoney(total - pago);

  const fields: PagoMoneyFields = {
    mora,
    consumo,
    cuotaMantenimiento,
    otros,
    ajustes,
    total,
    pago,
    diferencia,
  };
  if (saldoAnterior != null) {
    fields.saldoAnterior = saldoAnterior;
  }
  return fields;
}

/** Solo los campos monetarios que se escriben en Firestore (sin undefined). */
export function toFirestorePagoMoney(fields: PagoMoneyFields): Record<string, number> {
  const doc: Record<string, number> = {
    mora: fields.mora,
    consumo: fields.consumo,
    cuotaMantenimiento: fields.cuotaMantenimiento,
    otros: fields.otros,
    ajustes: fields.ajustes,
    total: fields.total,
    pago: fields.pago,
    diferencia: fields.diferencia,
  };
  if (fields.saldoAnterior != null) {
    doc.saldoAnterior = fields.saldoAnterior;
  }
  return doc;
}

/** Verifica que total y diferencia coincidan con los componentes (misma lógica que Firestore). */
export function validatePagoMoneyFields(fields: PagoMoneyFields): boolean {
  const expectedTotal = computePagoTotalFromParts({
    mora: fields.mora,
    consumo: fields.consumo,
    cuotaMantenimiento: fields.cuotaMantenimiento,
    otros: fields.otros,
    ajustes: fields.ajustes,
  });
  const expectedDiferencia = roundMoney(fields.total - fields.pago);
  return fields.total === expectedTotal && fields.diferencia === expectedDiferencia;
}
