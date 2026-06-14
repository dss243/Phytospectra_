export type PendingCameraPhoto = {
  id: string;
  filename: string;
  fieldId: string;
  fieldName?: string;
  savedAt: string;
  blob: Blob;
};

const DB_NAME = "phytospectra-pending-v1";
const STORE = "photos";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE, { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function txStore(mode: IDBTransactionMode) {
  return openDb().then(
    (db) =>
      new Promise<IDBObjectStore>((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const store = tx.objectStore(STORE);
        tx.oncomplete = () => db.close();
        tx.onerror = () => reject(tx.error);
        resolve(store);
      }),
  );
}

export async function listPendingCameraPhotos(): Promise<PendingCameraPhoto[]> {
  const store = await txStore("readonly");
  return new Promise((resolve, reject) => {
    const req = store.getAll();
    req.onsuccess = () => {
      const rows = (req.result as PendingCameraPhoto[]).sort(
        (a, b) => new Date(b.savedAt).getTime() - new Date(a.savedAt).getTime(),
      );
      resolve(rows);
    };
    req.onerror = () => reject(req.error);
  });
}

export async function savePendingCameraPhoto(input: {
  filename: string;
  fieldId: string;
  fieldName?: string;
  blob: Blob;
}): Promise<PendingCameraPhoto> {
  const entry: PendingCameraPhoto = {
    id: crypto.randomUUID(),
    filename: input.filename,
    fieldId: input.fieldId,
    fieldName: input.fieldName,
    savedAt: new Date().toISOString(),
    blob: input.blob,
  };

  const store = await txStore("readwrite");
  await new Promise<void>((resolve, reject) => {
    const req = store.put(entry);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
  return entry;
}

export async function removePendingCameraPhoto(id: string): Promise<void> {
  const store = await txStore("readwrite");
  await new Promise<void>((resolve, reject) => {
    const req = store.delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}
