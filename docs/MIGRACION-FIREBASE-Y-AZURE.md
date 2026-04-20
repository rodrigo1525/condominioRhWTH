# Guía de migración: Firebase y Azure

Este documento describe los **pasos y comandos** a seguir si en algún momento decides **migrar** tu proyecto a un **nuevo proyecto de Firebase** y/o a un **nuevo recurso de Azure** (Document Intelligence para OCR).

---

## Índice

1. [Resumen rápido](#1-resumen-rápido)
2. [Migración de Firebase](#2-migración-de-firebase)
3. [Migración de Azure (OCR)](#3-migración-de-azure-ocr)
4. [Actualizar la aplicación](#4-actualizar-la-aplicación)
5. [Comandos en orden](#5-comandos-en-orden)
6. [Checklist final](#6-checklist-final)

---

## 1. Resumen rápido

| Qué migras   | Dónde cambia                                                                 | Comandos clave                                      |
|-------------|-------------------------------------------------------------------------------|-----------------------------------------------------|
| **Firebase** | Nuevo proyecto en consola, `.env`, `functions/.env`, Firebase Console (vars) | `firebase use`, `firebase deploy`                   |
| **Azure**   | Nuevo recurso en Azure Portal, vars en Functions                             | Solo configuración; luego `firebase deploy --only functions` |

Si solo cambias **Azure** (mismo Firebase), basta con crear el nuevo recurso, copiar endpoint y clave, y actualizar las variables de entorno de las Cloud Functions.  
Si cambias **Firebase**, hay que crear el proyecto, habilitar servicios, opcionalmente exportar/importar datos, y actualizar todas las referencias al proyecto.

---

## 2. Migración de Firebase

### 2.1 Crear el nuevo proyecto en Firebase

1. Entra en [Firebase Console](https://console.firebase.google.com).
2. **Agregar proyecto** (o **Crear proyecto**).
3. Nombre del proyecto (ej. `condominio-rmwth-nuevo`).
4. Si quieres, desactiva Google Analytics para simplificar.
5. Crear proyecto.

### 2.2 Habilitar servicios en el nuevo proyecto

En el **nuevo** proyecto:

| Servicio        | Dónde activarlo |
|-----------------|------------------|
| **Authentication** | Compilación → Authentication → Empezar (correo/contraseña si lo usas). |
| **Firestore**   | Compilación → Firestore → Crear base de datos (modo producción; región según prefieras). |
| **Storage**     | Compilación → Storage → Empezar (misma región que Firestore si te lo pide). |
| **Functions**   | Se habilita al desplegar; plan Blaze si usas funciones. |

### 2.3 Vincular la CLI al nuevo proyecto

En la **raíz del proyecto** (donde está `firebase.json`):

```bash
# Ver proyecto actual
firebase projects:list

# Usar el nuevo proyecto por defecto
firebase use <NUEVO_PROJECT_ID>

# Opcional: crear/editar .firebaserc para tener alias
firebase use nuevo-prod --alias prod
firebase use nuevo-prod
```

El `NUEVO_PROJECT_ID` lo ves en la consola de Firebase (configuración del proyecto) o en `firebase projects:list`.

### 2.4 Obtener la configuración del nuevo proyecto (para la app)

1. Firebase Console → **Configuración del proyecto** (engranaje) → **Tus apps**.
2. Si no hay app web, **Agregar app** → **Web** (</>).
3. Copia los valores: `apiKey`, `authDomain`, `projectId`, `storageBucket`, `messagingSenderId`, `appId`, `measurementId`.

Guárdalos; los usarás en el `.env` de la raíz (ver [4. Actualizar la aplicación](#4-actualizar-la-aplicación)).

### 2.5 (Opcional) Exportar datos del proyecto antiguo

Si quieres **migrar datos** de Firestore y/o usuarios de Auth:

**Firestore (exportar a Cloud Storage):**

En el proyecto **antiguo** (cambia con `firebase use <PROJECT_ID_VIEJO>`):

```bash
# Requiere Google Cloud SDK (gcloud) y permisos en el proyecto
gcloud firestore export gs://<BUCKET_DEL_PROYECTO_VIEJO>/firestore-export --project=<PROJECT_ID_VIEJO>
```

Luego importar en el **nuevo** proyecto:

```bash
gcloud firestore import gs://<BUCKET_DEL_PROYECTO_NUEVO>/firestore-export --project=<PROJECT_ID_NUEVO>
```

**Auth (usuarios):**  
Firebase no ofrece un “export/import” con un clic. Opciones:

- **Script con Admin SDK:** exportar usuarios con `auth.listUsers()` y en el nuevo proyecto crear con `auth.createUser()`.  
- O volver a registrar usuarios manualmente / con flujo de registro.

### 2.6 Desplegar reglas, índices y Functions en el nuevo proyecto

Con `firebase use` apuntando al **nuevo** proyecto:

```bash
# Reglas de Firestore
firebase deploy --only firestore:rules

# Índices de Firestore (pueden tardar minutos en crearse)
firebase deploy --only firestore:indexes

# Reglas de Storage
firebase deploy --only storage

# Cloud Functions (requiere plan Blaze)
firebase deploy --only functions
```

Si es la primera vez en el proyecto nuevo, puede pedirte que actives la API de Cloud Functions y que aceptes el plan de facturación.

---

## 3. Migración de Azure (OCR)

Las Cloud Functions usan **Azure Document Intelligence (Form Recognizer)** para el OCR. Si cambias de recurso o de suscripción:

### 3.1 Crear el nuevo recurso en Azure

1. [Azure Portal](https://portal.azure.com) → **Crear un recurso**.
2. Buscar **Document Intelligence** o **Form Recognizer**.
3. Crear:
   - Suscripción y grupo de recursos (nuevos o existentes).
   - Región (ej. East US, West Europe).
   - Nombre (ej. `condominio-ocr-prod`).
   - Plan: F0 (gratuito) para pruebas o el que corresponda.

### 3.2 Obtener endpoint y clave

1. Recurso → **Claves y endpoint** (Keys and Endpoint).
2. Copiar:
   - **Endpoint** (ej. `https://condominio-ocr-prod.cognitiveservices.azure.com/`).
   - **Key 1** (o Key 2).

### 3.3 Dónde configurar las nuevas credenciales

| Lugar | Variables |
|-------|-----------|
| **Firebase Console** (producción) | Functions → Configuración → Variables de entorno: `AZURE_OCR_ENDPOINT`, `AZURE_OCR_KEY`. |
| **Local (emulador)** | `functions/.env`: `AZURE_OCR_ENDPOINT`, `AZURE_OCR_KEY`. |
| **App (opcional)** | Si la app usara Azure directo (en este proyecto el OCR va por Functions), sería en `.env` raíz; en tu caso no es necesario para OCR. |

Después de cambiar las variables en Firebase Console, **redesplegar** las functions:

```bash
firebase deploy --only functions
```

---

## 4. Actualizar la aplicación

### 4.1 Variables de entorno (raíz del proyecto)

Archivo **`.env`** en la raíz (Expo / app). Sustituir por los valores del **nuevo** proyecto Firebase:

```env
# --- Firebase (nuevo proyecto) ---
EXPO_PUBLIC_FIREBASE_API_KEY=...
EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN=<NUEVO_PROJECT_ID>.firebaseapp.com
EXPO_PUBLIC_FIREBASE_PROJECT_ID=<NUEVO_PROJECT_ID>
EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET=<NUEVO_PROJECT_ID>.firebasestorage.app
EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=...
EXPO_PUBLIC_FIREBASE_APP_ID=...
EXPO_PUBLIC_FIREBASE_MEASUREMENT_ID=...
```

Si usas región distinta para Functions:

```env
EXPO_PUBLIC_FIREBASE_FUNCTIONS_REGION=us-central1
```

### 4.2 Variables de Functions (local)

En **`functions/.env`** (para emulador y para que el código tenga referencia local):

```env
AZURE_OCR_ENDPOINT=https://tu-nuevo-recurso.cognitiveservices.azure.com/
AZURE_OCR_KEY=tu-key-1
```

No subas este archivo a Git (debe estar en `.gitignore`).

### 4.3 Firebase Console – Variables de entorno de Functions

Para **producción**, en Firebase Console → tu proyecto → **Functions** → **Configuración** (o Variables de entorno):

- `AZURE_OCR_ENDPOINT` = endpoint del nuevo recurso Azure.
- `AZURE_OCR_KEY` = Key 1 del nuevo recurso.

Guardar y volver a desplegar:

```bash
firebase deploy --only functions
```

---

## 5. Comandos en orden

### Solo migración de Firebase (nuevo proyecto)

```bash
# 1. Cambiar a nuevo proyecto
firebase use <NUEVO_PROJECT_ID>

# 2. Desplegar reglas e índices
firebase deploy --only firestore:rules
firebase deploy --only firestore:indexes
firebase deploy --only storage

# 3. Desplegar Functions (vars de Azure ya en consola o mismo recurso)
firebase deploy --only functions
```

Luego actualizar `.env` en la raíz con la config del nuevo proyecto y, si aplica, exportar/importar Firestore y usuarios (ver 2.5).

### Solo migración de Azure (mismo Firebase)

1. Crear recurso Document Intelligence en Azure y copiar endpoint y Key 1.
2. En Firebase Console → Functions → Variables de entorno: `AZURE_OCR_ENDPOINT`, `AZURE_OCR_KEY`.
3. En la raíz del proyecto:

```bash
firebase deploy --only functions
```

Opcional: actualizar `functions/.env` para el emulador.

### Migración completa (Firebase + Azure)

```bash
# 1. Firebase: usar nuevo proyecto
firebase use <NUEVO_PROJECT_ID>

# 2. Desplegar todo en el nuevo Firebase
firebase deploy --only firestore:rules
firebase deploy --only firestore:indexes
firebase deploy --only storage
firebase deploy --only functions
```

Antes del paso 2: tener ya creado el recurso Azure y configuradas en la consola de Firebase las variables `AZURE_OCR_ENDPOINT` y `AZURE_OCR_KEY` del **nuevo** recurso.  
Después: actualizar `.env` de la raíz y, si quieres, `functions/.env`.

---

## 6. Checklist final

- [ ] Nuevo proyecto Firebase creado y servicios habilitados (Auth, Firestore, Storage).
- [ ] `firebase use <NUEVO_PROJECT_ID>` ejecutado.
- [ ] Reglas e índices desplegados: `firebase deploy --only firestore:rules`, `firestore:indexes`, `storage`.
- [ ] Variables de entorno de Functions en Firebase Console (incluidas `AZURE_OCR_ENDPOINT` y `AZURE_OCR_KEY` si cambiaste Azure).
- [ ] `firebase deploy --only functions` ejecutado.
- [ ] `.env` de la raíz actualizado con la config del nuevo proyecto Firebase.
- [ ] `functions/.env` actualizado si usas emulador y cambiaste Azure.
- [ ] (Opcional) Export/import de Firestore y migración de usuarios Auth si aplica.
- [ ] Probar en la app: login, registrar lectura con foto y OCR, y que los datos se guarden en el nuevo Firestore.

Si guardas este documento en el repo (por ejemplo en `docs/MIGRACION-FIREBASE-Y-AZURE.md`), tendrás siempre a mano los pasos y comandos para una futura migración de Firebase y Azure.
