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
          <tr style="background: #2563eb; color: #fff;">
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
