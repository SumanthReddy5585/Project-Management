// Storage provider interface. Swap the implementation (e.g. S3) by providing an object with
// the same methods: put(buffer, meta) -> {key, sha256}, open(key) -> ReadableStream, stat(key), remove(key), list().
import { config } from '../config.js';
import { LocalStorage } from './localStorage.js';
import { DbStorage } from './dbStorage.js';

export const storage = config.STORAGE_DRIVER === 'db' ? new DbStorage() : new LocalStorage(config.UPLOAD_DIR);
