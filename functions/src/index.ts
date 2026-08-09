import 'dotenv/config';
import * as admin from 'firebase-admin';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import * as nodemailer from 'nodemailer';

admin.initializeApp();

const auth = admin.auth();
const db = admin.firestore();

type UserRole = 'admin' | 'user';

async function assertAdmin(uid: string): Promise<void> {
  const snap = await db.doc(`user/${uid}`).get();
  const role = snap.data()?.role as UserRole | undefined;
  if (role !== 'admin') {
    throw new HttpsError('permission-denied', 'Solo un administrador puede realizar esta acción.');
  }
}

/**
 * Crea un usuario en Auth y un documento en user/{uid} con email y role.
 * Solo puede ser llamado por un usuario con role admin.
 */
export const createUserAsAdmin = onCall(
  { region: 'us-central1' },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Debes iniciar sesión.');
    }
    await assertAdmin(request.auth.uid);

    const { email, password, role } = request.data as {
      email?: string;
      password?: string;
      role?: UserRole;
    };

    if (!email || typeof email !== 'string' || !email.trim()) {
      throw new HttpsError('invalid-argument', 'El correo es obligatorio.');
    }
    const trimmedEmail = email.trim();
    if (!password || typeof password !== 'string' || password.length < 6) {
      throw new HttpsError('invalid-argument', 'La contraseña debe tener al menos 6 caracteres.');
    }
    const validRole: UserRole = role === 'admin' ? 'admin' : 'user';

    try {
      const userRecord = await auth.createUser({
        email: trimmedEmail,
        password,
        emailVerified: false,
      });

      await db.doc(`user/${userRecord.uid}`).set({
        email: trimmedEmail,
        role: validRole,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      return {
        uid: userRecord.uid,
        email: trimmedEmail,
        role: validRole,
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('email-already-exists') || message.includes('already in use')) {
        throw new HttpsError('already-exists', 'Ya existe un usuario con ese correo.');
      }
      throw new HttpsError('internal', message || 'Error al crear el usuario.');
    }
  }
);

/**
 * Genera un link de restablecimiento de contraseña para el correo indicado.
 * Solo puede ser llamado por un administrador. Útil como respaldo si el correo no llega.
 */
export const generateResetLinkAsAdmin = onCall(
  { region: 'us-central1' },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Debes iniciar sesión.');
    }
    await assertAdmin(request.auth.uid);

    const { email } = request.data as { email?: string };
    if (!email || typeof email !== 'string' || !email.trim()) {
      throw new HttpsError('invalid-argument', 'El correo es obligatorio.');
    }
    const trimmedEmail = email.trim();

    try {
      const projectId = process.env.GCLOUD_PROJECT ?? process.env.GCP_PROJECT ?? '';
      const continueUrl = projectId
        ? `https://${projectId}.firebaseapp.com`
        : 'https://example.com';
      const link = await auth.generatePasswordResetLink(trimmedEmail, {
        url: continueUrl,
        handleCodeInApp: false,
      });
      return { link };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('user-not-found') || message.includes('no user')) {
        throw new HttpsError('not-found', 'No hay ningún usuario con ese correo.');
      }
      throw new HttpsError('internal', message || 'Error al generar el link.');
    }
  }
);

// --- OCR (Azure Document Intelligence / Form Recognizer Read) ---
const AZURE_OCR_ENDPOINT = process.env.AZURE_OCR_ENDPOINT ?? '';
const AZURE_OCR_KEY = process.env.AZURE_OCR_KEY ?? '';

interface AzureReadOperation {
  status: 'notStarted' | 'running' | 'succeeded' | 'failed';
  analyzeResult?: {
    content: string;
    pages?: Array<{ lines?: Array<{ content: string }> }>;
  };
}

/**
 * Llama a Azure Form Recognizer Read API: POST con URL, luego polling hasta resultado.
 * Configura AZURE_OCR_ENDPOINT y AZURE_OCR_KEY en el entorno de la función
 * (Firebase Console > Functions > config, o .env en /functions).
 */
export const ocrReadFromUrl = onCall(
  { region: 'us-central1' },
  async (request): Promise<{ text: string; rawContent?: string }> => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Debes iniciar sesión.');
    }
    await assertAdmin(request.auth.uid);

    const { imageUrl } = request.data as { imageUrl?: string };
    if (!imageUrl || typeof imageUrl !== 'string' || !imageUrl.trim()) {
      throw new HttpsError('invalid-argument', 'La URL de la imagen es obligatoria.');
    }

    if (!AZURE_OCR_ENDPOINT || !AZURE_OCR_KEY) {
      throw new HttpsError(
        'failed-precondition',
        'OCR no configurado. Define AZURE_OCR_ENDPOINT y AZURE_OCR_KEY en la configuración de la función.'
      );
    }

    const baseUrl = AZURE_OCR_ENDPOINT.replace(/\/$/, '');
    const analyzeUrl = `${baseUrl}/formrecognizer/documentModels/prebuilt-read:analyze?api-version=2023-07-31`;

    // 1) POST para iniciar análisis
    const initRes = await fetch(analyzeUrl, {
      method: 'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': AZURE_OCR_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ urlSource: imageUrl.trim() }),
    });

    if (!initRes.ok) {
      const errText = await initRes.text();
      throw new HttpsError(
        'internal',
        `Azure OCR error (${initRes.status}): ${errText.slice(0, 200)}`
      );
    }

    const operationLocation = initRes.headers.get('Operation-Location');
    if (!operationLocation) {
      throw new HttpsError('internal', 'Azure no devolvió Operation-Location.');
    }

    // 2) Polling hasta succeeded o failed
    const maxAttempts = 30;
    const pollIntervalMs = 1500;
    for (let i = 0; i < maxAttempts; i++) {
      await new Promise((r) => setTimeout(r, pollIntervalMs));
      const pollRes = await fetch(operationLocation, {
        headers: { 'Ocp-Apim-Subscription-Key': AZURE_OCR_KEY },
      });
      if (!pollRes.ok) {
        throw new HttpsError('internal', `Azure poll error: ${pollRes.status}`);
      }
      const op = (await pollRes.json()) as AzureReadOperation;
      if (op.status === 'succeeded' && op.analyzeResult) {
        const content = op.analyzeResult.content ?? '';
        // Opcional: extraer solo números para medidor (simplificado: devolver todo el texto)
        return { text: content.trim(), rawContent: content };
      }
      if (op.status === 'failed') {
        throw new HttpsError('internal', 'El análisis OCR falló.');
      }
    }
    throw new HttpsError('deadline-exceeded', 'OCR tardó demasiado. Intenta de nuevo.');
  }
);

// --- Envío de lectura por correo (foto del contador + tabla de datos) ---
const SMTP_HOST = process.env.SMTP_HOST ?? '';
const SMTP_PORT = parseInt(process.env.SMTP_PORT ?? '587', 10);
const SMTP_USER = process.env.SMTP_USER ?? '';
const SMTP_PASS = process.env.SMTP_PASS ?? '';
const SMTP_FROM = process.env.SMTP_FROM ?? process.env.SMTP_USER ?? '';

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function getAuthenticatedUserEmail(
  uid: string,
  tokenEmail?: string
): Promise<string | null> {
  if (tokenEmail && typeof tokenEmail === 'string' && tokenEmail.trim()) {
    return tokenEmail.trim();
  }
  try {
    const userRecord = await auth.getUser(uid);
    if (userRecord.email?.trim()) {
      return userRecord.email.trim();
    }
  } catch {
    // Fallback to Firestore profile below.
  }
  const snap = await db.doc(`user/${uid}`).get();
  const email = snap.data()?.email;
  if (typeof email === 'string' && email.trim()) {
    return email.trim();
  }
  return null;
}

/**
 * Envía por correo la foto del contador y una tabla con: Casa No., Mes, Lectura mes anterior,
 * Lectura mes registrado, Consumo. Solo administradores.
 */
export const sendReadingByEmail = onCall(
  { region: 'us-central1' },
  async (request): Promise<{ success: boolean; message: string }> => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Debes iniciar sesión.');
    }
    await assertAdmin(request.auth.uid);

    const { toEmail, photoUrl, casaNo, mes, lecturaMesAnterior, lecturaMesRegistrado, consumo } =
      request.data as {
        toEmail?: string;
        photoUrl?: string;
        casaNo?: string;
        mes?: string;
        lecturaMesAnterior?: string | number;
        lecturaMesRegistrado?: string | number;
        consumo?: string | number | null;
      };

    if (!toEmail || typeof toEmail !== 'string' || !toEmail.trim()) {
      throw new HttpsError('invalid-argument', 'El correo de destino es obligatorio.');
    }
    const trimmedTo = toEmail.trim();
    if (!photoUrl || typeof photoUrl !== 'string' || !photoUrl.trim()) {
      throw new HttpsError('invalid-argument', 'La URL de la foto es obligatoria.');
    }
    if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
      throw new HttpsError(
        'failed-precondition',
        'Correo no configurado. Define SMTP_HOST, SMTP_USER y SMTP_PASS en la configuración de la función.'
      );
    }

    const prevStr = lecturaMesAnterior != null ? String(lecturaMesAnterior) : '—';
    const currStr = lecturaMesRegistrado != null ? String(lecturaMesRegistrado) : '—';
    const consStr = consumo != null && consumo !== '' ? String(consumo) : '—';
    const mesStr = mes != null && String(mes).trim() !== '' ? String(mes).trim() : '—';
    const casaStr = String(casaNo ?? '—');
    const tableHtml = `
      <table border="1" cellpadding="10" cellspacing="0" style="border-collapse: collapse; width: 100%; max-width: 600px;">
        <thead>
          <tr>
            <th>CASA NO.</th>
            <th>MES</th>
            <th>LECTURA MES ANTERIOR</th>
            <th>LECTURA MES REGISTRADO</th>
            <th>CONSUMO</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>${escapeHtml(casaStr)}</td>
            <td>${escapeHtml(mesStr)}</td>
            <td>${escapeHtml(prevStr)}</td>
            <td>${escapeHtml(currStr)}</td>
            <td>${escapeHtml(consStr)}</td>
          </tr>
        </tbody>
      </table>`;
    const html = `
      <div style="font-family: sans-serif;">
        <h2>Lectura de contador eléctrico</h2>
        <p>Se adjunta la fotografía del contador y el resumen de la lectura.</p>
        <p><img src="${escapeHtml(photoUrl.trim())}" alt="Contador eléctrico" style="max-width: 100%; height: auto;" /></p>
        <p style="margin-top: 24px;"><strong>Resumen:</strong></p>
        ${tableHtml}
      </div>`;

    const transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_PORT === 465,
      auth: { user: SMTP_USER, pass: SMTP_PASS },
    });
    const from = SMTP_FROM ? `Condominio <${SMTP_FROM}>` : SMTP_USER;

    const subjectParts = ['Lectura de contador eléctrico'];
    if (mesStr !== '—') subjectParts.push(mesStr);
    if (casaStr !== '—') subjectParts.push(casaStr);
    const subject = subjectParts.join(' - ');

    const adminEmail = await getAuthenticatedUserEmail(
      request.auth.uid,
      request.auth.token.email
    );
    const bccAdmin =
      adminEmail != null && adminEmail.toLowerCase() !== trimmedTo.toLowerCase()
        ? adminEmail
        : undefined;

    try {
      await transporter.sendMail({
        from,
        to: trimmedTo,
        ...(bccAdmin ? { bcc: bccAdmin } : {}),
        subject,
        html,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      throw new HttpsError('internal', `Error al enviar correo: ${message}`);
    }

    const successMessage = bccAdmin
      ? 'Correo enviado al propietario. Copia enviada al administrador.'
      : 'Correo enviado correctamente.';

    return { success: true, message: successMessage };
  }
);

interface HistoricoEmailRow {
  casaNo: string;
  saldoAnterior?: string | number | null;
  cuotaAtraso?: string | number | null;
  otro?: string | number | null;
  ajusteJD?: string | number | null;
  cuotaMantenimiento?: string | number | null;
  lecturaAnterior?: string | number;
  lecturaRegistrada?: string | number;
  consumoAguaM3?: string | number | null;
  cuotaAPagarPorConsumoAgua?: string | number | null;
  saldoTotalAPagar?: string | number | null;
  observaciones?: string | number | null;
}

function roundReport(value: number): number {
  return Math.round(value * 100) / 100;
}

function cellValue(value: string | number | null | undefined, fallback = ''): string {
  if (value == null || value === '') return fallback;
  if (typeof value === 'number') return roundReport(value).toFixed(2);
  return String(value);
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

interface LetterheadInfo {
  nombreCondominio: string;
  direccion: string;
  imagen?: string;
}

async function loadLetterheadFromVariables(): Promise<LetterheadInfo> {
  const snap = await db.doc('variables/config').get();
  const data = snap.data() ?? {};
  const nombre =
    typeof data.nombreCondominio === 'string' && data.nombreCondominio.trim()
      ? data.nombreCondominio.trim()
      : 'CONDOMINIO';
  const direccion =
    typeof data.direccion === 'string' && data.direccion.trim()
      ? data.direccion.trim()
      : '—';
  const imagen =
    typeof data.imagen === 'string' && data.imagen.trim() ? data.imagen.trim() : '';
  return { nombreCondominio: nombre, direccion, imagen };
}

/** Encabezado del estado de cuenta (nombre/dirección/imagen desde variables). */
function buildReporteLetterheadHtml(
  period: string | undefined,
  letterhead: LetterheadInfo
): string {
  let mesAnio = '—';
  let cuotasLine = 'CUOTAS ADEUDADAS POR SERVICIOS RECIBIDOS AL 30 DE JUNIO 2026';

  if (period && /^\d{4}-\d{2}$/.test(period)) {
    const year = parseInt(period.slice(0, 4), 10);
    const month = parseInt(period.slice(5, 7), 10);
    if (Number.isFinite(year) && month >= 1 && month <= 12) {
      const mesName = MESES_ES_UPPER[month - 1];
      mesAnio = `${mesName} ${year}`;
      const lastDay = new Date(year, month, 0).getDate();
      cuotasLine = `CUOTAS ADEUDADAS POR SERVICIOS RECIBIDOS AL ${lastDay} DE ${mesName} ${year}`;
    }
  }

  const lineStyle =
    'margin: 0 0 4px 0; text-align: center; color: #000000; font-family: sans-serif;';
  const imagen = (letterhead.imagen ?? '').trim();
  const textBlock = `
        <p style="${lineStyle} font-size: 16px; font-weight: bold;">${escapeHtml(letterhead.nombreCondominio)}</p>
        <p style="${lineStyle} font-size: 13px;">${escapeHtml(letterhead.direccion)}</p>
        <p style="${lineStyle} font-size: 14px; font-weight: bold;">ESTADO DE CUENTA ${escapeHtml(mesAnio)}</p>
        <p style="${lineStyle} font-size: 12px; margin-bottom: 0;">${escapeHtml(cuotasLine)}</p>`;

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

function sumReportColumn(
  rows: HistoricoEmailRow[],
  getter: (row: HistoricoEmailRow) => string | number | null | undefined
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

function buildReporteTableHtml(
  rows: HistoricoEmailRow[],
  period: string | undefined,
  letterhead: LetterheadInfo
): string {
  const bodyRows = rows
    .map((row) => {
      const casaStr = cellValue(row.casaNo, '—');
      const saldoStr = cellValue(row.saldoAnterior, '—');
      const atrasoStr = cellValue(row.cuotaAtraso, '');
      const otroStr = cellValue(row.otro, '');
      const ajusteStr = cellValue(row.ajusteJD, '');
      const cuotaMantStr = cellValue(row.cuotaMantenimiento, '0.00');
      const prevStr = cellValue(row.lecturaAnterior, '—');
      const currStr = cellValue(row.lecturaRegistrada, '—');
      const consStr = cellValue(row.consumoAguaM3, '—');
      const cuotaAguaStr = cellValue(row.cuotaAPagarPorConsumoAgua, '0.00');
      const totalStr = cellValue(row.saldoTotalAPagar, '0.00');
      const observacionesStr = cellValue(row.observaciones, '');
      return `
          <tr>
            <td style="border: 1px solid #000000;">${escapeHtml(casaStr)}</td>
            <td style="border: 1px solid #000000;">${escapeHtml(saldoStr)}</td>
            <td style="border: 1px solid #000000;">${escapeHtml(atrasoStr)}</td>
            <td style="border: 1px solid #000000;">${escapeHtml(otroStr)}</td>
            <td style="border: 1px solid #000000;">${escapeHtml(ajusteStr)}</td>
            <td style="border: 1px solid #000000;">${escapeHtml(cuotaMantStr)}</td>
            <td style="border: 1px solid #000000;">${escapeHtml(prevStr)}</td>
            <td style="border: 1px solid #000000;">${escapeHtml(currStr)}</td>
            <td style="border: 1px solid #000000;">${escapeHtml(consStr)}</td>
            <td style="border: 1px solid #000000;">${escapeHtml(cuotaAguaStr)}</td>
            <td style="border: 1px solid #000000;">${escapeHtml(totalStr)}</td>
            <td style="border: 1px solid #000000;">${escapeHtml(observacionesStr)}</td>
          </tr>`;
    })
    .join('');

  const totalsRow = `
          <tr style="background: #e8eef9; font-weight: bold;">
            <td style="border: 1px solid #000000;">${escapeHtml('TOTAL')}</td>
            <td style="border: 1px solid #000000;">${escapeHtml(sumReportColumn(rows, (r) => r.saldoAnterior))}</td>
            <td style="border: 1px solid #000000;">${escapeHtml(sumReportColumn(rows, (r) => r.cuotaAtraso))}</td>
            <td style="border: 1px solid #000000;">${escapeHtml(sumReportColumn(rows, (r) => r.otro))}</td>
            <td style="border: 1px solid #000000;">${escapeHtml(sumReportColumn(rows, (r) => r.ajusteJD))}</td>
            <td style="border: 1px solid #000000;">${escapeHtml(sumReportColumn(rows, (r) => r.cuotaMantenimiento))}</td>
            <td style="border: 1px solid #000000;">${escapeHtml(sumReportColumn(rows, (r) => r.lecturaAnterior))}</td>
            <td style="border: 1px solid #000000;">${escapeHtml(sumReportColumn(rows, (r) => r.lecturaRegistrada))}</td>
            <td style="border: 1px solid #000000;">${escapeHtml(sumReportColumn(rows, (r) => r.consumoAguaM3))}</td>
            <td style="border: 1px solid #000000;">${escapeHtml(sumReportColumn(rows, (r) => r.cuotaAPagarPorConsumoAgua))}</td>
            <td style="border: 1px solid #000000;">${escapeHtml(sumReportColumn(rows, (r) => r.saldoTotalAPagar))}</td>
            <td style="border: 1px solid #000000;"></td>
          </tr>`;

  return `
      ${buildReporteLetterheadHtml(period, letterhead)}
      <table cellpadding="10" cellspacing="0" style="border-collapse: collapse; width: 100%; max-width: 1200px; border: 1px solid #000000;">
        <thead>
          <tr style="background: #ffffff;">
            <th rowspan="2" style="color: #000000; background: #ffffff; border: 2px solid #000000; text-align: center; vertical-align: middle;">CASA NO.</th>
            <th rowspan="2" style="color: #000000; background: #ffffff; border: 2px solid #000000; text-align: center; vertical-align: middle;">SALDO ANTERIOR</th>
            <th rowspan="2" style="color: #000000; background: #ffffff; border: 2px solid #000000; text-align: center; vertical-align: middle;">CUOTA POR ATRASO EN FECHA DE PAGO</th>
            <th rowspan="2" style="color: #000000; background: #ffffff; border: 2px solid #000000; text-align: center; vertical-align: middle;">OTRO</th>
            <th rowspan="2" style="color: #000000; background: #ffffff; border: 2px solid #000000; text-align: center; vertical-align: middle;">AJUSTE JD</th>
            <th rowspan="2" style="color: #000000; background: #ffffff; border: 2px solid #000000; text-align: center; vertical-align: middle;">CUOTA DE MANTENIMIENTO</th>
            <th colspan="4" style="color: #000000; background: #ffffff; border: 2px solid #000000; text-align: center; vertical-align: middle;">AGUA</th>
            <th rowspan="2" style="color: #000000; background: #ffffff; border: 2px solid #000000; text-align: center; vertical-align: middle;">SALDO TOTAL A PAGAR</th>
            <th rowspan="2" style="color: #000000; background: #ffffff; border: 2px solid #000000; text-align: center; vertical-align: middle;">OBSERVACIONES</th>
          </tr>
          <tr style="background: #ffffff;">
            <th style="color: #000000; background: #ffffff; border: 2px solid #000000; text-align: center; vertical-align: middle;">LECTURA ANTERIOR</th>
            <th style="color: #000000; background: #ffffff; border: 2px solid #000000; text-align: center; vertical-align: middle;">LECTURA REGISTRADA</th>
            <th style="color: #000000; background: #ffffff; border: 2px solid #000000; text-align: center; vertical-align: middle;">CONSUMO DE AGUA M3</th>
            <th style="color: #000000; background: #ffffff; border: 2px solid #000000; text-align: center; vertical-align: middle;">CUOTA A PAGAR POR CONSUMO DE AGUA</th>
          </tr>
        </thead>
        <tbody>${bodyRows}${totalsRow}
        </tbody>
      </table>`;
}

function buildHistoricoTableHtml(
  rows: HistoricoEmailRow[],
  period: string | undefined,
  letterhead: LetterheadInfo
): string {
  return buildReporteTableHtml(rows, period, letterhead);
}

/**
 * Envía un único correo con el histórico del período: tabla con todas las casas.
 * Solo administradores. Destinatario: correo del administrador autenticado.
 */
export const sendHistoricoByEmail = onCall(
  { region: 'us-central1' },
  async (request): Promise<{ success: boolean; message: string }> => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Debes iniciar sesión.');
    }
    await assertAdmin(request.auth.uid);

    const { mes, period, rows, html: htmlFromClient } = request.data as {
      mes?: string;
      period?: string;
      rows?: HistoricoEmailRow[];
      reportType?: 'preliminar' | 'final';
      html?: string;
    };

    if (!rows || !Array.isArray(rows) || rows.length === 0) {
      throw new HttpsError('invalid-argument', 'No hay lecturas para incluir en el histórico.');
    }
    if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
      throw new HttpsError(
        'failed-precondition',
        'Correo no configurado. Define SMTP_HOST, SMTP_USER y SMTP_PASS en la configuración de la función.'
      );
    }

    const adminEmail = await getAuthenticatedUserEmail(
      request.auth.uid,
      request.auth.token.email
    );
    if (!adminEmail) {
      throw new HttpsError(
        'failed-precondition',
        'No se encontró un correo para el administrador autenticado.'
      );
    }

    const mesStr = mes != null && String(mes).trim() !== '' ? String(mes).trim() : '—';
    // Preferir el HTML generado en la app; fallback al generador del servidor.
    let html =
      typeof htmlFromClient === 'string' && htmlFromClient.trim().length > 0
        ? htmlFromClient.trim()
        : '';
    if (!html) {
      const periodStr =
        period != null && /^\d{4}-\d{2}$/.test(String(period).trim())
          ? String(period).trim()
          : undefined;
      const letterhead = await loadLetterheadFromVariables();
      const tableHtml = buildHistoricoTableHtml(rows, periodStr, letterhead);
      html = `
      <div style="font-family: sans-serif;">
        ${tableHtml}
      </div>`;
    }

    const transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_PORT === 465,
      auth: { user: SMTP_USER, pass: SMTP_PASS },
    });
    const from = SMTP_FROM ? `Condominio <${SMTP_FROM}>` : SMTP_USER;
    const subject = `Histórico de lecturas - ${mesStr}`;

    try {
      await transporter.sendMail({
        from,
        to: adminEmail,
        subject,
        html,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      throw new HttpsError('internal', `Error al enviar correo: ${message}`);
    }

    return {
      success: true,
      message: `Correo enviado a ${adminEmail} con ${rows.length} lectura(s).`,
    };
  }
);
