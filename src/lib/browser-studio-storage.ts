const DATABASE_NAME = 'synlive.studio';
const DATABASE_VERSION = 1;
const SETTINGS_STORE = 'settings';

function openStudioDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(SETTINGS_STORE)) {
        database.createObjectStore(SETTINGS_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('浏览器持久化存储不可用'));
  });
}

export async function readStudioSetting(key: string): Promise<string | null> {
  const database = await openStudioDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction(SETTINGS_STORE, 'readonly');
      const request = transaction.objectStore(SETTINGS_STORE).get(key);
      request.onsuccess = () => resolve(typeof request.result === 'string' ? request.result : null);
      request.onerror = () => reject(request.error ?? new Error('浏览器持久化数据读取失败'));
    });
  } finally {
    database.close();
  }
}

export async function writeStudioSetting(key: string, value: string): Promise<void> {
  const database = await openStudioDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(SETTINGS_STORE, 'readwrite');
      transaction.objectStore(SETTINGS_STORE).put(value, key);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error('浏览器持久化数据保存失败'));
      transaction.onabort = () => reject(transaction.error ?? new Error('浏览器持久化数据保存失败'));
    });
  } finally {
    database.close();
  }
}
