import mongoose from 'mongoose';
import AdmZip from 'adm-zip';
import dbConnect from '@/lib/mongodb';

/**
 * Full-database backup (export) and restore (import) as a single ZIP.
 *
 * Operates on the native MongoDB driver (`mongoose.connection.db`) rather than
 * iterating registered Mongoose models, so every collection that actually
 * exists in the database is covered — including ones without a model in this
 * codebase — with no manual list to keep in sync.
 */

const MANIFEST_FILENAME = 'manifest.json';
const COLLECTIONS_DIR = 'collections';
const BACKUP_SCHEMA_VERSION = 1;

interface BackupManifest {
  schemaVersion: number;
  generatedAt: string;
  dbName: string;
  collections: { name: string; count: number }[];
}

// ── BSON <-> JSON round-tripping ──
//
// `JSON.stringify` mangles `ObjectId` and `Date` (and would drop `Buffer`
// data), so documents are walked recursively and BSON types are tagged
// before serializing, then untagged on the way back in.

type Tagged = { __bsonType: 'ObjectId'; value: string } | { __bsonType: 'Date'; value: string } | { __bsonType: 'Buffer'; value: string };

function isTagged(value: unknown): value is Tagged {
  return (
    !!value &&
    typeof value === 'object' &&
    '__bsonType' in (value as Record<string, unknown>) &&
    'value' in (value as Record<string, unknown>)
  );
}

function serializeValue(value: unknown): unknown {
  if (value === null || value === undefined) return value;

  if (value instanceof mongoose.Types.ObjectId || (value as { _bsontype?: string })._bsontype === 'ObjectId') {
    return { __bsonType: 'ObjectId', value: value.toString() } satisfies Tagged;
  }
  if (value instanceof Date) {
    return { __bsonType: 'Date', value: value.toISOString() } satisfies Tagged;
  }
  if (Buffer.isBuffer(value)) {
    return { __bsonType: 'Buffer', value: value.toString('base64') } satisfies Tagged;
  }
  if (Array.isArray(value)) {
    return value.map(serializeValue);
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      out[key] = serializeValue(val);
    }
    return out;
  }
  return value;
}

function deserializeValue(value: unknown): unknown {
  if (value === null || value === undefined) return value;

  if (isTagged(value)) {
    switch (value.__bsonType) {
      case 'ObjectId':
        return new mongoose.Types.ObjectId(value.value);
      case 'Date':
        return new Date(value.value);
      case 'Buffer':
        return Buffer.from(value.value, 'base64');
    }
  }
  if (Array.isArray(value)) {
    return value.map(deserializeValue);
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      out[key] = deserializeValue(val);
    }
    return out;
  }
  return value;
}

async function getNativeDb() {
  await dbConnect();
  const db = mongoose.connection.db;
  if (!db) throw new Error('No hay conexión activa a la base de datos');
  return db;
}

/** Builds a ZIP with every collection in the database, dumped as JSON. */
export async function exportDatabaseZip(): Promise<Buffer> {
  const db = await getNativeDb();
  const collectionInfos = await db.listCollections().toArray();
  const zip = new AdmZip();
  const manifestCollections: { name: string; count: number }[] = [];

  for (const info of collectionInfos) {
    if (!info.name || info.name.startsWith('system.')) continue;

    const docs = await db.collection(info.name).find({}).toArray();
    const serialized = serializeValue(docs);
    zip.addFile(`${COLLECTIONS_DIR}/${info.name}.json`, Buffer.from(JSON.stringify(serialized)));
    manifestCollections.push({ name: info.name, count: docs.length });
  }

  const manifest: BackupManifest = {
    schemaVersion: BACKUP_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    dbName: db.databaseName,
    collections: manifestCollections,
  };
  zip.addFile(MANIFEST_FILENAME, Buffer.from(JSON.stringify(manifest, null, 2)));

  return zip.toBuffer();
}

function readManifest(zip: AdmZip): BackupManifest {
  const entry = zip.getEntry(MANIFEST_FILENAME);
  if (!entry) {
    throw new Error('El ZIP no es un backup válido: falta manifest.json');
  }

  let manifest: BackupManifest;
  try {
    manifest = JSON.parse(entry.getData().toString('utf-8'));
  } catch {
    throw new Error('El ZIP no es un backup válido: manifest.json no es JSON válido');
  }

  if (
    !manifest ||
    typeof manifest.schemaVersion !== 'number' ||
    !Array.isArray(manifest.collections) ||
    !manifest.collections.every((c) => c && typeof c.name === 'string')
  ) {
    throw new Error('El ZIP no es un backup válido: manifest.json tiene un formato inesperado');
  }
  if (manifest.schemaVersion > BACKUP_SCHEMA_VERSION) {
    throw new Error('Este backup fue generado con una versión más reciente y no se puede restaurar aquí');
  }

  return manifest;
}

/**
 * Replaces the ENTIRE database with the contents of the ZIP: every collection
 * listed in the manifest is emptied and refilled from the backup. Runs inside
 * a transaction so a failure partway through leaves the database untouched
 * (requires the MongoDB deployment to be a replica set, which Atlas always is).
 */
export async function importDatabaseZip(buffer: Buffer): Promise<{ collections: number; documents: number }> {
  const db = await getNativeDb();

  let zip: AdmZip;
  try {
    zip = new AdmZip(buffer);
  } catch {
    throw new Error('El archivo subido no es un ZIP válido');
  }

  const manifest = readManifest(zip);

  const parsedCollections: { name: string; docs: Record<string, unknown>[] }[] = [];
  for (const { name } of manifest.collections) {
    const entry = zip.getEntry(`${COLLECTIONS_DIR}/${name}.json`);
    if (!entry) {
      throw new Error(`El ZIP no es un backup válido: falta ${COLLECTIONS_DIR}/${name}.json`);
    }
    let raw: unknown;
    try {
      raw = JSON.parse(entry.getData().toString('utf-8'));
    } catch {
      throw new Error(`El ZIP no es un backup válido: ${name}.json no es JSON válido`);
    }
    const docs = deserializeValue(raw) as Record<string, unknown>[];
    if (!Array.isArray(docs)) {
      throw new Error(`El ZIP no es un backup válido: ${name}.json no contiene una lista de documentos`);
    }
    parsedCollections.push({ name, docs });
  }

  const session = await mongoose.connection.startSession();
  let totalDocuments = 0;
  try {
    await session.withTransaction(async () => {
      for (const { name, docs } of parsedCollections) {
        const collection = db.collection(name);
        await collection.deleteMany({}, { session });
        if (docs.length > 0) {
          await collection.insertMany(docs, { session });
        }
        totalDocuments += docs.length;
      }
    });
  } finally {
    await session.endSession();
  }

  return { collections: parsedCollections.length, documents: totalDocuments };
}
