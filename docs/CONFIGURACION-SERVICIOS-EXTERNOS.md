# Configuración para Fase 3: Lecturas con foto y OCR

Configuraciones en **software externos** necesarias para que funcione **Registrar lectura**: captura de foto, subida a Storage, OCR (Azure Read) y guardado en Firestore.

**Requisito:** Fases 1 y 2 ya desplegadas (Auth, Firestore, Functions de usuarios y casas). Aquí solo lo que añade la Fase 3.

---

## 1. Firebase Storage (fotos de lecturas)

La app sube cada foto en `readings/{userId}/{timestamp}.jpg`. Hay que tener Storage activo y reglas que lo permitan.

### 1.1 Activar Storage

1. [Firebase Console](https://console.firebase.google.com) → tu proyecto.
2. **Compilación** → **Storage** → **Empezar**.
3. Elige la misma región que Firestore si te lo pide.

### 1.2 Reglas de Storage

El proyecto incluye **`storage.rules`** en la raíz. Despliega:

```bash
firebase deploy --only storage
``` 

Reglas aplicadas: solo el usuario autenticado puede leer y escribir en `readings/{su-uid}/...`. Así el admin que registra la lectura puede subir la foto; luego podrás abrir la foto desde la app (lectura guardada con `photoUrl`).

Si en lugar de usar el archivo prefieres pegar reglas en la consola (Storage → Reglas), usa:

```
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    match /readings/{userId}/{allPaths=**} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
  }
}
```

---

## 2. Firestore: índice para “lectura anterior”

En **Registrar lectura**, para sugerir la “lectura anterior” por casa se hace una consulta por `houseId` y `period`. Firestore exige un **índice compuesto**.

### 2.1 Desplegar índices

En la raíz del proyecto está **`firestore.indexes.json`** con el índice de la colección `readings`. Despliega:

```bash
firebase deploy --only firestore:indexes
```

La primera vez puede tardar unos minutos en crearse. Si no despliegas, al usar “Registrar lectura” puede aparecer un error con un enlace para crear el índice desde la consola; también puedes usar ese enlace.

---

## 3. Azure: recurso para OCR (Document Intelligence / Form Recognizer)

La Cloud Function **`ocrReadFromUrl`** usa la API **Read** de Azure para extraer el texto de la foto del medidor. Todo el OCR corre en el servidor; la app no usa claves de Azure.

### 3.1 Crear el recurso

1. Entra en [Azure Portal](https://portal.azure.com).
2. **Crear un recurso** → busca **“Document Intelligence”** o **“Form Recognizer”**.
3. Crear:
   - **Suscripción** y **grupo de recursos**.
   - **Región** (ej. East US, West Europe).
   - **Nombre** (ej. `condominio-ocr`).
   - **Plan de precios**: F0 (gratuito) para pruebas.

### 3.2 Obtener endpoint y clave

1. En el recurso → **Claves y endpoint** (Keys and Endpoint).
2. Copiar:
   - **Endpoint** (ej. `https://tu-recurso.cognitiveservices.azure.com/`).
   - **Key 1** (o Key 2).

Estos dos valores se usan **solo en Firebase** (variables de entorno de las Cloud Functions), no en la app ni en el `.env` de Expo.

---

## 4. Cloud Functions: variables de entorno para OCR

La función `ocrReadFromUrl` lee **`AZURE_OCR_ENDPOINT`** y **`AZURE_OCR_KEY`** del entorno. Sin ellas, al pulsar “Subir y leer con OCR” aparecerá un error tipo “OCR no configurado”.

### 4.1 Dónde configurarlas (producción)

1. Firebase Console → tu proyecto → **Functions**.
2. Entra en **Configuración** del proyecto de Functions (o en el menú de las funciones, según la versión de la consola).
3. **Variables de entorno** (Environment variables): añadir
   - **Nombre:** `AZURE_OCR_ENDPOINT` → **Valor:** el endpoint de Azure (con o sin barra final).
   - **Nombre:** `AZURE_OCR_KEY` → **Valor:** Key 1 de Azure.
4. Guardar y **volver a desplegar** las functions para que tomen los valores:

```bash
firebase deploy --only functions
```

### 4.2 Emulador local (opcional)

Si pruebas las functions en local con el emulador, en la carpeta **`functions/`** puedes usar un archivo **`.env`** (no subirlo a Git). Copia `functions/.env.example` a `functions/.env` y rellena:

```
AZURE_OCR_ENDPOINT=https://tu-recurso.cognitiveservices.azure.com/
AZURE_OCR_KEY=tu-clave-azure
```

En producción se usan las variables de la consola de Firebase, no este `.env`.

---

## 5. Resumen Fase 3

| Software / Lugar      | Configuración para Fase 3 |
|----------------------|----------------------------|
| **Firebase Storage** | Activar Storage y desplegar reglas: `firebase deploy --only storage`. |
| **Firestore**        | Desplegar índice de `readings`: `firebase deploy --only firestore:indexes`. |
| **Azure Portal**     | Crear recurso Document Intelligence / Form Recognizer; copiar **Endpoint** y **Key 1**. |
| **Firebase Functions** | Añadir variables de entorno `AZURE_OCR_ENDPOINT` y `AZURE_OCR_KEY`; luego `firebase deploy --only functions`. |

No hace falta configurar nada de Azure en la app (Expo) ni en el `.env` de la raíz para el OCR; la app solo sube la foto a Storage y llama a la función. El `.env` de la raíz debe tener ya las variables de Firebase de las fases anteriores (incluido `EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET` para que la subida de fotos funcione).

Orden sugerido: 1) Storage, 2) Índice Firestore, 3) Recurso Azure, 4) Variables de entorno en Functions y redespliegue.

---

## 6. Cómo probar la Fase 4 (OCR)

### Requisitos previos

- Fases 1 y 2 OK (Auth, Firestore, Functions de usuarios/casas).
- Fase 3 configurada: Storage activo, índice de `readings` desplegado, recurso Azure creado.
- **Fase 4**: `AZURE_OCR_ENDPOINT` y `AZURE_OCR_KEY` en `functions/.env` (o en la consola) y **functions desplegadas**:

  ```bash
  firebase deploy --only functions
  ```

- En la app: un usuario con rol **admin** y al menos **una casa** en Firestore.

### Probar desde la app (producción)

1. Inicia la app (Expo) y **inicia sesión con un usuario admin**.
2. Ve a **Registrar lectura** (pestaña o ruta admin correspondiente).
3. Elige una **casa** en el selector.
4. Pulsa **Elegir foto** o **Tomar foto** y selecciona una imagen donde se vea un número (medidor, factura, o cualquier texto).
5. Pulsa **Subir y leer con OCR**.
   - La app sube la foto a Storage, obtiene la URL y llama a la función `ocrReadFromUrl`.
   - Si todo está bien: aparece el **texto extraído** y se sugiere un valor numérico en el campo de lectura.
   - Si falla: verás un mensaje de error (por ejemplo “OCR no configurado” si faltan las variables, o un error de Azure si la clave/endpoint son incorrectos).
6. Ajusta el valor de lectura si hace falta y pulsa **Guardar** para completar el flujo (se guarda en Firestore con `photoUrl` y `ocrRaw`).

Con esto habrás probado: Storage (subida), Cloud Function (OCR) y Firestore (guardado de la lectura).

### Probar con emulador (opcional)

Si quieres probar las functions en local sin desplegar:

1. En **`functions/.env`** tienes ya `AZURE_OCR_ENDPOINT` y `AZURE_OCR_KEY` (mismo archivo que para producción).
2. En la raíz del proyecto:

   ```bash
   firebase emulators:start --only functions
   ```

3. Configura la app para usar el emulador de functions (según tu `lib/firebase` o documentación de Expo + emuladores). Cuando la app llame a `ocrReadFromUrl`, la petición irá al emulador, que leerá las variables desde `functions/.env`.

### Errores frecuentes

| Mensaje / comportamiento | Qué revisar |
|--------------------------|-------------|
| “OCR no configurado”      | `AZURE_OCR_ENDPOINT` y `AZURE_OCR_KEY` en `functions/.env` (o consola) y `firebase deploy --only functions`. |
| Error 401/403 de Azure   | Endpoint y Key 1 correctos; recurso Document Intelligence activo en Azure. |
| Error al subir la foto   | Storage activo, reglas desplegadas (`firebase deploy --only storage`), y en el `.env` de la raíz `EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET` correcto. |
| “Elige una casa” / no hay casas | Tener al menos una casa en Firestore (Fase 2). |
| Solo admins pueden registrar lectura | El usuario debe tener `role: 'admin'` en su documento de perfil. |
