const fs = require('fs');
const path = require('path');
const { MongoClient } = require('mongodb');
const { BSON } = require('bson');

const BACKUP_DIR = path.join(__dirname, '../../8-7-26/geo-dashboard');
const MONGO_URI = 'mongodb://127.0.0.1:27017/geo-dashboard';
const DB_NAME = 'geo-dashboard';

async function restoreBsonFile(db, filePath, collectionName) {
  console.log(`\n----------------------------------------`);
  console.log(`Restoring ${collectionName} from ${filePath}...`);
  
  if (!fs.existsSync(filePath)) {
    console.log(`File does not exist: ${filePath}, skipping.`);
    return;
  }

  const buffer = fs.readFileSync(filePath);
  if (buffer.length === 0) {
    console.log(`File ${filePath} is empty, skipping.`);
    return;
  }

  const docs = [];
  let offset = 0;
  
  try {
    while (offset < buffer.length) {
      const size = buffer.readInt32LE(offset);
      if (size <= 0 || offset + size > buffer.length) {
        break;
      }
      const docBuffer = buffer.slice(offset, offset + size);
      const doc = BSON.deserialize(docBuffer);
      docs.push(doc);
      offset += size;
    }
  } catch (e) {
    console.error(`Error decoding BSON at offset ${offset}:`, e.message);
  }
  
  console.log(`Parsed ${docs.length} documents for ${collectionName}.`);
  
  try {
    await db.collection(collectionName).drop();
    console.log(`Dropped existing collection: ${collectionName}`);
  } catch (err) {
    // Ignore error if collection does not exist
  }
  
  if (docs.length > 0) {
    const BATCH_SIZE = 1000;
    for (let i = 0; i < docs.length; i += BATCH_SIZE) {
      const batch = docs.slice(i, i + BATCH_SIZE);
      await db.collection(collectionName).insertMany(batch);
    }
    console.log(`✅ Successfully restored ${docs.length} documents into ${collectionName}.`);
  } else {
    console.log(`No documents to restore for ${collectionName}.`);
  }
}

async function main() {
  const client = new MongoClient(MONGO_URI);
  try {
    await client.connect();
    console.log('Connected to MongoDB.');
    const db = client.db(DB_NAME);
    
    if (!fs.existsSync(BACKUP_DIR)) {
      console.error(`Backup directory does not exist: ${BACKUP_DIR}`);
      process.exit(1);
    }

    const files = fs.readdirSync(BACKUP_DIR);
    for (const file of files) {
      if (file.endsWith('.bson')) {
        const filePath = path.join(BACKUP_DIR, file);
        const collectionName = path.basename(file, '.bson');
        await restoreBsonFile(db, filePath, collectionName);
      }
    }
    console.log('\n========================================');
    console.log('Database restore completed successfully!');
    console.log('========================================');
  } catch (err) {
    console.error('Error during restore:', err);
  } finally {
    await client.close();
  }
}

main();
