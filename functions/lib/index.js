"use strict";
var _a, _b, _c, _d, _e, _f, _g, _h;
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendReadingByEmail = exports.ocrReadFromUrl = exports.generateResetLinkAsAdmin = exports.createUserAsAdmin = void 0;
require("dotenv/config");
const admin = require("firebase-admin");
const https_1 = require("firebase-functions/v2/https");
const nodemailer = require("nodemailer");
admin.initializeApp();
const auth = admin.auth();
const db = admin.firestore();
async function assertAdmin(uid) {
    var _a;
    const snap = await db.doc(`user/${uid}`).get();
    const role = (_a = snap.data()) === null || _a === void 0 ? void 0 : _a.role;
    if (role !== 'admin') {
        throw new https_1.HttpsError('permission-denied', 'Solo un administrador puede realizar esta acción.');
    }
}
/**
 * Crea un usuario en Auth y un documento en user/{uid} con email y role.
 * Solo puede ser llamado por un usuario con role admin.
 */
exports.createUserAsAdmin = (0, https_1.onCall)({ region: 'us-central1' }, async (request) => {
    if (!request.auth) {
        throw new https_1.HttpsError('unauthenticated', 'Debes iniciar sesión.');
    }
    await assertAdmin(request.auth.uid);
    const { email, password, role } = request.data;
    if (!email || typeof email !== 'string' || !email.trim()) {
        throw new https_1.HttpsError('invalid-argument', 'El correo es obligatorio.');
    }
    const trimmedEmail = email.trim();
    if (!password || typeof password !== 'string' || password.length < 6) {
        throw new https_1.HttpsError('invalid-argument', 'La contraseña debe tener al menos 6 caracteres.');
    }
    const validRole = role === 'admin' ? 'admin' : 'user';
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
    }
    catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (message.includes('email-already-exists') || message.includes('already in use')) {
            throw new https_1.HttpsError('already-exists', 'Ya existe un usuario con ese correo.');
        }
        throw new https_1.HttpsError('internal', message || 'Error al crear el usuario.');
    }
});
/**
 * Genera un link de restablecimiento de contraseña para el correo indicado.
 * Solo puede ser llamado por un administrador. Útil como respaldo si el correo no llega.
 */
exports.generateResetLinkAsAdmin = (0, https_1.onCall)({ region: 'us-central1' }, async (request) => {
    var _a, _b;
    if (!request.auth) {
        throw new https_1.HttpsError('unauthenticated', 'Debes iniciar sesión.');
    }
    await assertAdmin(request.auth.uid);
    const { email } = request.data;
    if (!email || typeof email !== 'string' || !email.trim()) {
        throw new https_1.HttpsError('invalid-argument', 'El correo es obligatorio.');
    }
    const trimmedEmail = email.trim();
    try {
        const projectId = (_b = (_a = process.env.GCLOUD_PROJECT) !== null && _a !== void 0 ? _a : process.env.GCP_PROJECT) !== null && _b !== void 0 ? _b : '';
        const continueUrl = projectId
            ? `https://${projectId}.firebaseapp.com`
            : 'https://example.com';
        const link = await auth.generatePasswordResetLink(trimmedEmail, {
            url: continueUrl,
            handleCodeInApp: false,
        });
        return { link };
    }
    catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (message.includes('user-not-found') || message.includes('no user')) {
            throw new https_1.HttpsError('not-found', 'No hay ningún usuario con ese correo.');
        }
        throw new https_1.HttpsError('internal', message || 'Error al generar el link.');
    }
});
// --- OCR (Azure Document Intelligence / Form Recognizer Read) ---
const AZURE_OCR_ENDPOINT = (_a = process.env.AZURE_OCR_ENDPOINT) !== null && _a !== void 0 ? _a : '';
const AZURE_OCR_KEY = (_b = process.env.AZURE_OCR_KEY) !== null && _b !== void 0 ? _b : '';
/**
 * Llama a Azure Form Recognizer Read API: POST con URL, luego polling hasta resultado.
 * Configura AZURE_OCR_ENDPOINT y AZURE_OCR_KEY en el entorno de la función
 * (Firebase Console > Functions > config, o .env en /functions).
 */
exports.ocrReadFromUrl = (0, https_1.onCall)({ region: 'us-central1' }, async (request) => {
    var _a;
    if (!request.auth) {
        throw new https_1.HttpsError('unauthenticated', 'Debes iniciar sesión.');
    }
    await assertAdmin(request.auth.uid);
    const { imageUrl } = request.data;
    if (!imageUrl || typeof imageUrl !== 'string' || !imageUrl.trim()) {
        throw new https_1.HttpsError('invalid-argument', 'La URL de la imagen es obligatoria.');
    }
    if (!AZURE_OCR_ENDPOINT || !AZURE_OCR_KEY) {
        throw new https_1.HttpsError('failed-precondition', 'OCR no configurado. Define AZURE_OCR_ENDPOINT y AZURE_OCR_KEY en la configuración de la función.');
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
        throw new https_1.HttpsError('internal', `Azure OCR error (${initRes.status}): ${errText.slice(0, 200)}`);
    }
    const operationLocation = initRes.headers.get('Operation-Location');
    if (!operationLocation) {
        throw new https_1.HttpsError('internal', 'Azure no devolvió Operation-Location.');
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
            throw new https_1.HttpsError('internal', `Azure poll error: ${pollRes.status}`);
        }
        const op = (await pollRes.json());
        if (op.status === 'succeeded' && op.analyzeResult) {
            const content = (_a = op.analyzeResult.content) !== null && _a !== void 0 ? _a : '';
            // Opcional: extraer solo números para medidor (simplificado: devolver todo el texto)
            return { text: content.trim(), rawContent: content };
        }
        if (op.status === 'failed') {
            throw new https_1.HttpsError('internal', 'El análisis OCR falló.');
        }
    }
    throw new https_1.HttpsError('deadline-exceeded', 'OCR tardó demasiado. Intenta de nuevo.');
});
// --- Envío de lectura por correo (foto del contador + tabla de datos) ---
const SMTP_HOST = (_c = process.env.SMTP_HOST) !== null && _c !== void 0 ? _c : '';
const SMTP_PORT = parseInt((_d = process.env.SMTP_PORT) !== null && _d !== void 0 ? _d : '587', 10);
const SMTP_USER = (_e = process.env.SMTP_USER) !== null && _e !== void 0 ? _e : '';
const SMTP_PASS = (_f = process.env.SMTP_PASS) !== null && _f !== void 0 ? _f : '';
const SMTP_FROM = (_h = (_g = process.env.SMTP_FROM) !== null && _g !== void 0 ? _g : process.env.SMTP_USER) !== null && _h !== void 0 ? _h : '';
/**
 * Envía por correo la foto del contador y una tabla con: Casa No., Lectura mes anterior,
 * Lectura mes registrado, Consumo. Solo administradores.
 */
exports.sendReadingByEmail = (0, https_1.onCall)({ region: 'us-central1' }, async (request) => {
    if (!request.auth) {
        throw new https_1.HttpsError('unauthenticated', 'Debes iniciar sesión.');
    }
    await assertAdmin(request.auth.uid);
    const { toEmail, photoUrl, casaNo, lecturaMesAnterior, lecturaMesRegistrado, consumo, } = request.data;
    if (!toEmail || typeof toEmail !== 'string' || !toEmail.trim()) {
        throw new https_1.HttpsError('invalid-argument', 'El correo de destino es obligatorio.');
    }
    const trimmedTo = toEmail.trim();
    if (!photoUrl || typeof photoUrl !== 'string' || !photoUrl.trim()) {
        throw new https_1.HttpsError('invalid-argument', 'La URL de la foto es obligatoria.');
    }
    if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
        throw new https_1.HttpsError('failed-precondition', 'Correo no configurado. Define SMTP_HOST, SMTP_USER y SMTP_PASS en la configuración de la función.');
    }
    const prevStr = lecturaMesAnterior != null ? String(lecturaMesAnterior) : '—';
    const currStr = lecturaMesRegistrado != null ? String(lecturaMesRegistrado) : '—';
    const consStr = consumo != null && consumo !== '' ? String(consumo) : '—';
    const tableHtml = `
      <table border="1" cellpadding="10" cellspacing="0" style="border-collapse: collapse; width: 100%; max-width: 500px;">
        <thead>
          <tr style="background: #2563eb; color: #fff;">
            <th>CASA NO.</th>
            <th>LECTURA MES ANTERIOR</th>
            <th>LECTURA MES REGISTRADO</th>
            <th>CONSUMO</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>${escapeHtml(String(casaNo !== null && casaNo !== void 0 ? casaNo : '—'))}</td>
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
    await transporter.sendMail({
        from,
        to: trimmedTo,
        subject: 'Lectura de contador eléctrico',
        html,
    });
    return { success: true, message: 'Correo enviado correctamente.' };
});
function escapeHtml(text) {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}
//# sourceMappingURL=index.js.map