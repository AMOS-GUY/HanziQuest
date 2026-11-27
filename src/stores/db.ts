/*eslint-disable @typescript-eslint/no-explicit-any */
import Dexie, { type EntityTable } from 'dexie';

interface OfflineScore {
    id: number;
    score: number;
    timestamp: number;
}

const db = new Dexie('HanziQuestDB') as Dexie & {
    scores: EntityTable<OfflineScore, 'id'>;
    characters: EntityTable<any, 'hanzi'>;
};

db.version(1).stores({
    scores: '++id, score, timestamp',
    characters: 'hanzi'
});

export { db };