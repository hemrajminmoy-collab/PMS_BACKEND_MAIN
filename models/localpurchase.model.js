import mongoose from "mongoose";

// Function to generate YYYY-MM-DD formatted date
const getFormattedDate = () => {
  const now = new Date();
  const day = String(now.getDate()).padStart(2, "0");
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const year = now.getFullYear();
  return `${year}-${month}-${day}`;
};

const LocalPurchaseSchema = new mongoose.Schema(
  {
    date: { type: String, default: getFormattedDate },

    site: { type: String, required: true },
    section: { type: String, required: true },
    uniqueId: { type: String, required: true },
    indentNumber: { type: String, required: true },
    itemNumber: { type: String, required: true },
    itemDescription: { type: String, required: true },
    uom: { type: String, required: true },
    totalQuantity: { type: Number, required: true },
    submittedBy: { type: String, required: true },

    doerName: { type: String, default: "" },
    // ===============================
// ✅ NEW FIELDS: INDENT / LOCAL PURCHASE EXTRA INFO
// ===============================
applicationArea: { type: String, default: "" },
oldMaterialStatus: { type: String, default: "" },
orderApprovedBy: { type: String, default: "" },

// ===============================
// ✅ LOCAL PURCHASE IMAGE (Drive link)
// ===============================
localPurchaseImageDriveFileId: { type: String, default: "" },
localPurchaseImageWebViewLink: { type: String, default: "" },
localPurchaseImageUploadedAt: { type: Date, default: null },
localPurchaseImageUploadedBy: { type: String, default: "" },

// Optional history (safe, future-proof)
localPurchaseImageHistory: {
  type: [
    {
      driveFileId: { type: String, default: "" },
      webViewLink: { type: String, default: "" },
      uploadedAt: { type: Date, default: Date.now },
      uploadedBy: { type: String, default: "" },
    },
  ],
  default: [],
},


    // ✅ Invoice details
    invoiceDate: { type: String, default: "" },
    invoiceNumber: { type: String, default: "" }, // ✅ NEW

    // ✅ Transport details
    modeOfTransport: {
      type: String,
      default: "",
      enum: ["", "By Hand", "By Transport"], // ✅ dropdown safe values
    },
    transporterName: { type: String, default: "" }, // ✅ NEW

    // ✅ Other bulk-updatable fields
    vendorName: { type: String, default: "" },
    remarks: { type: String, default: "" },
  },
  { timestamps: true }
);

export default mongoose.model("LocalPurchase", LocalPurchaseSchema);
