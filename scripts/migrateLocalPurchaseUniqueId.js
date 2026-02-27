import mongoose from "mongoose";
import dotenvFlow from "dotenv-flow";
import LocalPurchase from "../models/localpurchase.model.js";
import Purchase from "../models/purchase.model.js";

dotenvFlow.config();

const mongoUri = process.env.MONGO_URI;
if (!mongoUri) {
  console.error("MONGO_URI is not set. Please set it in your environment or .env files.");
  process.exit(1);
}

const matchPurchaseForLocal = async (lp) => {
  const baseFilter = {
    indentNumber: lp.indentNumber,
    itemNumber: lp.itemNumber,
    site: lp.site,
    section: lp.section,
    submittedBy: lp.submittedBy,
  };

  let matches = await Purchase.find(baseFilter).limit(5).lean();

  if (matches.length !== 1) {
    const strictFilter = {
      ...baseFilter,
      itemDescription: lp.itemDescription,
      uom: lp.uom,
      totalQuantity: lp.totalQuantity,
    };
    matches = await Purchase.find(strictFilter).limit(5).lean();
  }

  if (matches.length === 1) return matches[0];
  return { _matchCount: matches.length };
};

const run = async () => {
  await mongoose.connect(mongoUri);
  console.log("Connected to MongoDB");

  const candidates = await LocalPurchase.find({
    uniqueId: { $regex: /^INTLP2_/ },
  }).lean();

  console.log(`Found ${candidates.length} LocalPurchase rows with INTLP2_* uniqueId`);

  let updated = 0;
  let skippedNoMatch = 0;
  let skippedMultiMatch = 0;
  let skippedCollision = 0;
  let alreadyCorrect = 0;

  for (const lp of candidates) {
    const match = await matchPurchaseForLocal(lp);

    if (!match || match._matchCount === 0) {
      skippedNoMatch++;
      continue;
    }

    if (match._matchCount > 1) {
      skippedMultiMatch++;
      continue;
    }

    if (lp.uniqueId === match.uniqueId) {
      alreadyCorrect++;
      continue;
    }

    const collision = await LocalPurchase.findOne({
      uniqueId: match.uniqueId,
      _id: { $ne: lp._id },
    }).lean();

    if (collision) {
      skippedCollision++;
      continue;
    }

    await LocalPurchase.updateOne(
      { _id: lp._id },
      { $set: { uniqueId: match.uniqueId } }
    );

    updated++;
  }

  console.log("Migration complete:");
  console.log(`  Updated: ${updated}`);
  console.log(`  Already correct: ${alreadyCorrect}`);
  console.log(`  Skipped (no match): ${skippedNoMatch}`);
  console.log(`  Skipped (multiple matches): ${skippedMultiMatch}`);
  console.log(`  Skipped (uniqueId collision): ${skippedCollision}`);

  await mongoose.connection.close();
};

run().catch((err) => {
  console.error("Migration failed:", err);
  mongoose.connection.close();
  process.exit(1);
});
