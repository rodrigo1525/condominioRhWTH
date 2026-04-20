# Validación Fase 3 – Puntos 1 y 2

Comprobación de que **Storage (1)** e **índice Firestore (2)** están bien implementados y alineados con la app.

---

## Punto 1: Firebase Storage (fotos de lecturas)

### Implementación en código

| Elemento | Ubicación | Estado |
|----------|-----------|--------|
| Cliente Storage | `lib/firebase.ts` | ✅ `getStorage(app)` y `export const storage`. |
| Config bucket | `lib/firebase.ts` | ✅ `storageBucket` en `firebaseConfig`. |
| Subida en app | `app/(admin)/reading-new.tsx` | ✅ `ref(storage, filename)` → `uploadBytes` → `getDownloadURL`. |
| Ruta de subida | `reading-new.tsx` línea ~152 | ✅ `readings/${profile.uid}/${Date.now()}.jpg`. |

### Reglas de Storage

| Elemento | Ubicación | Estado |
|----------|-----------|--------|
| Archivo de reglas | `storage.rules` (raíz) | ✅ Definido. |
| Patrón | `readings/{userId}/{allPaths=**}` | ✅ Coincide con la ruta de la app (`readings/{uid}/...`). |
| Condición | `request.auth != null && request.auth.uid == userId` | ✅ Solo el usuario autenticado escribe/lee sus archivos. |

### Despliegue

- `firebase.json` incluye `"storage": { "rules": "storage.rules" }`, así que:
  - ✅ `firebase deploy --only storage` aplica las reglas del repo.

**Conclusión punto 1:** Implementación correcta. La app sube a `readings/{uid}/{timestamp}.jpg`, las reglas permiten solo a ese `uid` y el despliegue de Storage usa `storage.rules`.

---

## Punto 2: Firestore – Índice para “lectura anterior”

### Consulta en la app

En `app/(admin)/reading-new.tsx` (aprox. líneas 92–98):

```ts
const q = query(
  collection(db, 'readings'),
  where('houseId', '==', selectedHouseId),
  where('period', '<', currentPeriod),
  orderBy('period', 'desc')
);
```

- Colección: `readings`.
- Filtros: `houseId` (==) y `period` (<).
- Orden: `period` descendente.

Para esta consulta Firestore exige un **índice compuesto** que incluya los campos usados (igualdad + desigualdad/orden).

### Definición del índice

| Elemento | Ubicación | Estado |
|----------|-----------|--------|
| Archivo de índices | `firestore.indexes.json` (raíz) | ✅ Definido. |
| Colección | `"collectionGroup": "readings"` | ✅ Misma colección que la consulta. |
| Campos | `houseId` ASC, `period` DESC | ✅ Correcto: igualdad en `houseId`, orden/desigualdad en `period`. |

### Despliegue

- `firebase.json` incluye `"firestore": { "rules": "...", "indexes": "firestore.indexes.json" }`, así que:
  - ✅ `firebase deploy --only firestore:indexes` (o `firebase deploy --only firestore`) despliega el índice del repo.

**Conclusión punto 2:** La consulta y el índice coinciden. El índice compuesto `(houseId ASC, period DESC)` en la colección `readings` es el adecuado para la consulta de “lectura anterior” por casa.

---

## Ajuste realizado durante la validación

- Se actualizó **`firebase.json`** para que:
  - Firestore use `firestore.indexes.json` (`"indexes": "firestore.indexes.json"`).
  - Storage use `storage.rules` (bloque `"storage": { "rules": "storage.rules" }`).

Así, los puntos 1 y 2 quedan bien implementados en código y en configuración de despliegue.

---

## Comandos para desplegar

```bash
# Punto 1 – reglas de Storage
firebase deploy --only storage

# Punto 2 – índices de Firestore (puede tardar unos minutos la primera vez)
firebase deploy --only firestore:indexes
```

O todo Firestore (reglas + índices):

```bash
firebase deploy --only firestore
```
