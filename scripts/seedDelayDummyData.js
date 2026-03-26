import dotenvFlow from "dotenv-flow";
import mongoose from "mongoose";
import Purchase from "../models/purchase.model.js";

dotenvFlow.config();

const DEMO_PREFIX = "DEMO_DELAY_";

const makeRows = () => {
  const uniqueGroups = [
    {
      uniqueId: `${DEMO_PREFIX}1001`,
      submittedBy: "PSE - Arindam",
      site: "Burdwan Plant",
      section: "Mechanical",
      indentNumber: "IND-DEMO-1001",
      items: [
        {
          itemNumber: "1",
          itemDescription: "Bearing Assembly",
          uom: "Nos",
          totalQuantity: 10,
          timeDelayGetQuotation: "4 days",
          timeDelayTechApproval: "2 days",
          timeDelayCommercialNegotiation: "3 days",
          timeDelayPoGeneration: "0 days",
        },
        {
          itemNumber: "2",
          itemDescription: "Coupling Set",
          uom: "Set",
          totalQuantity: 5,
          timeDelayGetQuotation: "5 days",
          timeDelayTechApproval: "0 days",
          timeDelayCommercialNegotiation: "4 days",
          timeDelayPoGeneration: "3 days",
        },
      ],
    },
    {
      uniqueId: `${DEMO_PREFIX}1002`,
      submittedBy: "PSE - Ananya",
      site: "Durgapur Unit",
      section: "Electrical",
      indentNumber: "IND-DEMO-1002",
      items: [
        {
          itemNumber: "1",
          itemDescription: "Power Contactors",
          uom: "Nos",
          totalQuantity: 18,
          timeDelayGetQuotation: "0 days",
          timeDelayTechApproval: "6 days",
          timeDelayCommercialNegotiation: "5 days",
          timeDelayPoGeneration: "4 days",
        },
        {
          itemNumber: "2",
          itemDescription: "Control Relay",
          uom: "Nos",
          totalQuantity: 20,
          timeDelayGetQuotation: "2 days",
          timeDelayTechApproval: "7 days",
          timeDelayCommercialNegotiation: "1 days",
          timeDelayPoGeneration: "0 days",
        },
      ],
    },
    {
      uniqueId: `${DEMO_PREFIX}1003`,
      submittedBy: "PSE - Ravi",
      site: "Asansol Branch",
      section: "Instrumentation",
      indentNumber: "IND-DEMO-1003",
      items: [
        {
          itemNumber: "1",
          itemDescription: "Pressure Gauge",
          uom: "Nos",
          totalQuantity: 12,
          timeDelayGetQuotation: "3 days",
          timeDelayTechApproval: "0 days",
          timeDelayCommercialNegotiation: "2 days",
          timeDelayPoGeneration: "8 days",
        },
        {
          itemNumber: "2",
          itemDescription: "Temperature Sensor",
          uom: "Nos",
          totalQuantity: 16,
          timeDelayGetQuotation: "0 days",
          timeDelayTechApproval: "4 days",
          timeDelayCommercialNegotiation: "6 days",
          timeDelayPoGeneration: "5 days",
        },
      ],
    },
  ];

  return uniqueGroups.flatMap((group) =>
    group.items.map((item) => ({
      site: group.site,
      section: group.section,
      uniqueId: group.uniqueId,
      indentNumber: group.indentNumber,
      itemNumber: item.itemNumber,
      itemDescription: item.itemDescription,
      uom: item.uom,
      totalQuantity: item.totalQuantity,
      submittedBy: group.submittedBy,

      quotationStatus: "Done",
      technicalApprovalStatus: "Done",
      finalizeTermsStatus: "Done",
      getApproval: "Done",
      poGenerationStatus: "Done",

      timeDelayGetQuotation: item.timeDelayGetQuotation,
      timeDelayTechApproval: item.timeDelayTechApproval,
      timeDelayCommercialNegotiation: item.timeDelayCommercialNegotiation,
      timeDelayPoGeneration: item.timeDelayPoGeneration,
    })),
  );
};

const summarize = (rows) => {
  const byUnique = new Map();

  rows.forEach((row) => {
    if (!byUnique.has(row.uniqueId)) {
      byUnique.set(row.uniqueId, {
        uniqueId: row.uniqueId,
        submittedBy: row.submittedBy,
        items: 0,
      });
    }
    byUnique.get(row.uniqueId).items += 1;
  });

  return Array.from(byUnique.values());
};

const seed = async () => {
  if (!process.env.MONGO_URI) {
    throw new Error("MONGO_URI is missing. Please check BackEnd-PMS/.env");
  }

  await mongoose.connect(process.env.MONGO_URI);

  const rows = makeRows();

  const deleteRes = await Purchase.deleteMany({
    uniqueId: { $regex: `^${DEMO_PREFIX}` },
  });

  const inserted = await Purchase.insertMany(rows, { ordered: true });

  console.log(`Removed old demo rows: ${deleteRes.deletedCount}`);
  console.log(`Inserted demo rows: ${inserted.length}`);

  const summary = summarize(inserted);
  console.log("Inserted unique IDs summary:");
  summary.forEach((s) => {
    console.log(`- ${s.uniqueId} | ${s.submittedBy} | items: ${s.items}`);
  });
};

seed()
  .then(async () => {
    await mongoose.disconnect();
    process.exit(0);
  })
  .catch(async (error) => {
    console.error("Failed to seed demo delay data:", error.message);
    try {
      await mongoose.disconnect();
    } catch {
      // no-op
    }
    process.exit(1);
  });
