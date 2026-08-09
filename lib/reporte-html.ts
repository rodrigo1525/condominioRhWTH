/**
 * HTML del reporte de lecturas — mismo diseño/estilo que el correo
 * (functions/src/index.ts → buildReporteTableHtml).
 */

export type ReporteHtmlRow = {
  casaNo: string;
  saldoAnterior: string;
  cuotaAtraso: string;
  otro: string;
  ajusteJD: string;
  cuotaMantenimiento: string;
  lecturaAnterior: string;
  lecturaRegistrada: string;
  consumoAguaM3: string;
  cuotaAPagarPorConsumoAgua: string;
  saldoTotalAPagar: string;
  observaciones: string;
};

export type ReporteLetterhead = {
  nombreCondominio: string;
  direccion: string;
  /** URL pública (Storage) de la imagen del encabezado; opcional. */
  imagen?: string | null;
};

const MESES_ES_UPPER = [
  'ENERO',
  'FEBRERO',
  'MARZO',
  'ABRIL',
  'MAYO',
  'JUNIO',
  'JULIO',
  'AGOSTO',
  'SEPTIEMBRE',
  'OCTUBRE',
  'NOVIEMBRE',
  'DICIEMBRE',
] as const;

const TH =
  'color: #000000; background: #ffffff; border: 2px solid #000000; text-align: center; vertical-align: middle;';
const TD = 'border: 1px solid #000000;';

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function cellValue(value: string | number | null | undefined, fallback = ''): string {
  if (value == null || value === '') return fallback;
  if (typeof value === 'number') return (Math.round(value * 100) / 100).toFixed(2);
  return String(value);
}

function roundReport(value: number): number {
  return Math.round(value * 100) / 100;
}

function parseReportNumeric(value: string | number | null | undefined): number | null {
  if (value == null || value === '') return null;
  if (typeof value === 'number') return roundReport(value);
  const trimmed = String(value).trim();
  if (!trimmed || trimmed === '—') return null;
  const parenMatch = trimmed.match(/^\(([\d.,]+)\)$/);
  if (parenMatch) {
    const num = parseFloat(parenMatch[1].replace(',', '.'));
    return Number.isFinite(num) ? -roundReport(num) : null;
  }
  const num = parseFloat(trimmed.replace(',', '.'));
  return Number.isFinite(num) ? roundReport(num) : null;
}

function formatReportTotal(value: number): string {
  if (value < 0) return `(${roundReport(Math.abs(value)).toFixed(2)})`;
  return roundReport(value).toFixed(2);
}

function sumReportColumn(
  rows: ReporteHtmlRow[],
  getter: (row: ReporteHtmlRow) => string
): string {
  let sum = 0;
  let hasAny = false;
  for (const row of rows) {
    const parsed = parseReportNumeric(getter(row));
    if (parsed != null) {
      sum += parsed;
      hasAny = true;
    }
  }
  return hasAny ? formatReportTotal(sum) : '';
}

function buildLetterheadHtml(period: string, letterhead: ReporteLetterhead): string {
  let mesAnio = '—';
  let cuotasLine = 'CUOTAS ADEUDADAS POR SERVICIOS RECIBIDOS';

  if (/^\d{4}-\d{2}$/.test(period)) {
    const year = parseInt(period.slice(0, 4), 10);
    const month = parseInt(period.slice(5, 7), 10);
    if (Number.isFinite(year) && month >= 1 && month <= 12) {
      const mesName = MESES_ES_UPPER[month - 1];
      mesAnio = `${mesName} ${year}`;
      const lastDay = new Date(year, month, 0).getDate();
      cuotasLine = `CUOTAS ADEUDADAS POR SERVICIOS RECIBIDOS AL ${lastDay} DE ${mesName} ${year}`;
    }
  }

  const nombre = (letterhead.nombreCondominio ?? '').trim() || 'CONDOMINIO';
  const direccion = (letterhead.direccion ?? '').trim() || '—';
  const imagen = (letterhead.imagen ?? '').trim();
  const lineStyle =
    'margin: 0 0 4px 0; text-align: center; color: #000000; font-family: sans-serif;';
  const textBlock = `
        <p style="${lineStyle} font-size: 16px; font-weight: bold;">${escapeHtml(nombre)}</p>
        <p style="${lineStyle} font-size: 13px;">${escapeHtml(direccion)}</p>
        <p style="${lineStyle} font-size: 14px; font-weight: bold;">ESTADO DE CUENTA ${escapeHtml(mesAnio)}</p>
        <p style="${lineStyle} font-size: 12px; margin-bottom: 0;">${escapeHtml(cuotasLine)}</p>`;

  // Misma línea: imagen a la izquierda, encabezado centrado (columna derecha
  // del mismo ancho que la izquierda para no desplazar el centro).
  if (imagen) {
    return `
      <table cellpadding="0" cellspacing="0" style="width: 100%; max-width: 1200px; margin: 0 0 16px 0; border-collapse: collapse;">
        <tr>
          <td style="width: 120px; vertical-align: middle; text-align: left;">
            <img src="${escapeHtml(imagen)}" alt="" style="display: block; max-height: 80px; max-width: 110px; width: auto; height: auto;" />
          </td>
          <td style="vertical-align: middle; text-align: center;">
            ${textBlock}
          </td>
          <td style="width: 120px; vertical-align: middle;"></td>
        </tr>
      </table>`;
  }

  return `
      <div style="margin: 0 0 16px 0; text-align: center;">
        ${textBlock}
      </div>`;
}

/** Documento HTML completo del reporte (misma estructura que el email). */
export function buildReporteDocumentHtml(
  rows: ReporteHtmlRow[],
  period: string,
  letterhead: ReporteLetterhead
): string {
  const bodyRows = rows
    .map((row) => {
      return `
          <tr>
            <td style="${TD}">${escapeHtml(cellValue(row.casaNo, '—'))}</td>
            <td style="${TD}">${escapeHtml(cellValue(row.saldoAnterior, '—'))}</td>
            <td style="${TD}">${escapeHtml(cellValue(row.cuotaAtraso, ''))}</td>
            <td style="${TD}">${escapeHtml(cellValue(row.otro, ''))}</td>
            <td style="${TD}">${escapeHtml(cellValue(row.ajusteJD, ''))}</td>
            <td style="${TD}">${escapeHtml(cellValue(row.cuotaMantenimiento, '0.00'))}</td>
            <td style="${TD}">${escapeHtml(cellValue(row.lecturaAnterior, '—'))}</td>
            <td style="${TD}">${escapeHtml(cellValue(row.lecturaRegistrada, '—'))}</td>
            <td style="${TD}">${escapeHtml(cellValue(row.consumoAguaM3, '—'))}</td>
            <td style="${TD}">${escapeHtml(cellValue(row.cuotaAPagarPorConsumoAgua, '0.00'))}</td>
            <td style="${TD}">${escapeHtml(cellValue(row.saldoTotalAPagar, '0.00'))}</td>
            <td style="${TD}">${escapeHtml(cellValue(row.observaciones, ''))}</td>
          </tr>`;
    })
    .join('');

  const totalsRow = `
          <tr style="background: #e8eef9; font-weight: bold;">
            <td style="${TD}">${escapeHtml('TOTAL')}</td>
            <td style="${TD}">${escapeHtml(sumReportColumn(rows, (r) => r.saldoAnterior))}</td>
            <td style="${TD}">${escapeHtml(sumReportColumn(rows, (r) => r.cuotaAtraso))}</td>
            <td style="${TD}">${escapeHtml(sumReportColumn(rows, (r) => r.otro))}</td>
            <td style="${TD}">${escapeHtml(sumReportColumn(rows, (r) => r.ajusteJD))}</td>
            <td style="${TD}">${escapeHtml(sumReportColumn(rows, (r) => r.cuotaMantenimiento))}</td>
            <td style="${TD}">${escapeHtml(sumReportColumn(rows, (r) => r.lecturaAnterior))}</td>
            <td style="${TD}">${escapeHtml(sumReportColumn(rows, (r) => r.lecturaRegistrada))}</td>
            <td style="${TD}">${escapeHtml(sumReportColumn(rows, (r) => r.consumoAguaM3))}</td>
            <td style="${TD}">${escapeHtml(sumReportColumn(rows, (r) => r.cuotaAPagarPorConsumoAgua))}</td>
            <td style="${TD}">${escapeHtml(sumReportColumn(rows, (r) => r.saldoTotalAPagar))}</td>
            <td style="${TD}"></td>
          </tr>`;

  const tableHtml = `
      ${buildLetterheadHtml(period, letterhead)}
      <table cellpadding="10" cellspacing="0" style="border-collapse: collapse; width: 100%; max-width: 1200px; border: 1px solid #000000;">
        <thead>
          <tr style="background: #ffffff;">
            <th rowspan="2" style="${TH}">CASA NO.</th>
            <th rowspan="2" style="${TH}">SALDO ANTERIOR</th>
            <th rowspan="2" style="${TH}">CUOTA POR ATRASO EN FECHA DE PAGO</th>
            <th rowspan="2" style="${TH}">OTRO</th>
            <th rowspan="2" style="${TH}">AJUSTE JD</th>
            <th rowspan="2" style="${TH}">CUOTA DE MANTENIMIENTO</th>
            <th colspan="4" style="${TH}">AGUA</th>
            <th rowspan="2" style="${TH}">SALDO TOTAL A PAGAR</th>
            <th rowspan="2" style="${TH}">OBSERVACIONES</th>
          </tr>
          <tr style="background: #ffffff;">
            <th style="${TH}">LECTURA ANTERIOR</th>
            <th style="${TH}">LECTURA REGISTRADA</th>
            <th style="${TH}">CONSUMO DE AGUA M3</th>
            <th style="${TH}">CUOTA A PAGAR POR CONSUMO DE AGUA</th>
          </tr>
        </thead>
        <tbody>${bodyRows}${totalsRow}
        </tbody>
      </table>`;

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1" />
  <style>
    html, body {
      margin: 0;
      padding: 12px;
      background: #ffffff;
      color: #000000;
      font-family: sans-serif;
    }
  </style>
</head>
<body>
  <div style="font-family: sans-serif;">
    ${tableHtml}
  </div>
</body>
</html>`;
}
