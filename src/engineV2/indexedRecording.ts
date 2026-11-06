import type { RecordingBlock, RecordingHead, RecordingStore } from './recording';

const DB_NAME = 'memex-engine-v2-recording';
const HEAD = 'current';
type Table = 'head' | 'frames' | 'checkpoints';

export class IndexedRecording implements RecordingStore {
  private constructor(private readonly db: IDBDatabase) {
    db.onversionchange = () => db.close();
  }

  static open(name = DB_NAME) {
    return new Promise<IndexedRecording>((resolve, reject) => {
      const request = indexedDB.open(name, 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore('head');
        request.result.createObjectStore('frames');
        request.result.createObjectStore('checkpoints');
      };
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error('Another tab is blocking recording storage'));
      request.onsuccess = () => resolve(new IndexedRecording(request.result));
    });
  }

  close() { this.db.close(); }

  private read<T>(table: Table, run: (store: IDBObjectStore) => IDBRequest<T>) {
    return new Promise<T>((resolve, reject) => {
      const request = run(this.db.transaction(table, 'readonly').objectStore(table));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  head() { return this.read<RecordingHead | undefined>('head', store => store.get(HEAD)); }
  count() { return this.read('frames', store => store.count()); }
  frame(index: number) { return this.read<RecordingBlock | undefined>('frames', store => store.get(index)); }
  checkpoint(index: number) { return this.read<RecordingBlock | undefined>('checkpoints', store => store.get(index)); }

  append(expected: RecordingHead | undefined, head: RecordingHead, frame: RecordingBlock, checkpoint?: RecordingBlock) {
    return new Promise<void>((resolve, reject) => {
      const tx = this.db.transaction(['head', 'frames', 'checkpoints'], 'readwrite', { durability: 'strict' });
      let conflict: Error | undefined;
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(conflict ?? tx.error ?? new Error('Recording write aborted'));
      const heads = tx.objectStore('head');
      const read = heads.get(HEAD);
      read.onsuccess = () => {
        const current = read.result as RecordingHead | undefined;
        if (current?.index !== expected?.index || current?.hash !== expected?.hash) {
          conflict = new Error('Recording changed in another tab. Reload to resume.');
          tx.abort();
          return;
        }
        tx.objectStore('frames').add(frame, frame.index);
        if (checkpoint) {
          const checkpoints = tx.objectStore('checkpoints');
          checkpoints.add(checkpoint, checkpoint.index);
          // The immutable tape is retained. Only its superseded restart cache is replaced.
          if (expected) checkpoints.delete(expected.checkpoint.index);
        }
        heads.put(head, HEAD);
      };
    });
  }
}
