// Storage provider interface. Swap the implementation (e.g. S3) by providing an object with
// the same methods: put(buffer, meta) -> {key}, open(key) -> ReadableStream, stat(key), remove(key), list().
import { config } from '../config.js';
import { LocalStorage } from './localStorage.js';

export const storage = new LocalStorage(config.UPLOAD_DIR);
