const { MongoClient } = require("mongodb");
async function main() {
  const uri = process.env.MONGO_URI || "mongodb://mongo:27017/fs01_marketplace";
  const dbName = process.env.MONGO_DB_NAME || "fs01_marketplace";
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db(dbName);

  const collections = await db.listCollections().toArray();
  console.log("COLLECTIONS:", JSON.stringify(collections.map(c => c.name)));

  const productCollections = ["products", "product", "catalog_items", "items"];
  for (const collName of productCollections) {
    const count = await db.collection(collName).countDocuments();
    console.log("Collection:", collName, "count:", count);
    if (count > 0) {
      const samples = await db.collection(collName).find({}).limit(5).toArray();
      console.log("Samples:", JSON.stringify(samples));
    }
  }

  await client.close();
}
main().catch(console.error);
