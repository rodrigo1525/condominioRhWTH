import { parseMoneyField } from '@/lib/money-utils';

export function getPreviousPeriod(period: string): string {
  const [yStr, mStr] = period.split('-');
  let year = parseInt(yStr, 10);
  let month = parseInt(mStr, 10);
  month -= 1;
  if (month < 1) {
    month = 12;
    year -= 1;
  }
  return `${year}-${String(month).padStart(2, '0')}`;
}

/** Diferencia pendiente del pago del período inmediatamente anterior (p. ej. dic al consultar ene). */
export function getSaldoAnteriorFromPagos(
  pagosDiferenciaByPeriod: Map<string, number>,
  readingPeriod: string
): { amount: number; exists: boolean; periodoAnterior: string } {
  const periodoAnterior = getPreviousPeriod(readingPeriod);
  const diferencia = pagosDiferenciaByPeriod.get(periodoAnterior);
  if (diferencia == null || diferencia === 0) {
    return { amount: 0, exists: false, periodoAnterior };
  }
  return { amount: diferencia, exists: true, periodoAnterior };
}

export function buildPagosDiferenciaByPeriod(
  pagos: Array<{ period?: string; fechaPago?: string; diferencia?: number }>
): Map<string, number> {
  const raw = new Map<string, { fecha: string; diferencia: number }>();

  pagos.forEach((pago) => {
    const period =
      typeof pago.period === 'string' && pago.period
        ? pago.period
        : typeof pago.fechaPago === 'string' && pago.fechaPago.length >= 7
          ? pago.fechaPago.slice(0, 7)
          : '';
    if (!period) return;

    const fecha = pago.fechaPago ?? '';
    const diferencia = parseMoneyField(pago.diferencia);
    const existing = raw.get(period);
    if (!existing || fecha >= existing.fecha) {
      raw.set(period, { fecha, diferencia });
    }
  });

  const result = new Map<string, number>();
  raw.forEach((value, period) => result.set(period, value.diferencia));
  return result;
}
