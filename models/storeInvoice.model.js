import mongoose from "mongoose";

const StoreInvoiceSchema = new mongoose.Schema(
  {
    //vendorName: { type: String, default: "" },
    invoiceNumber: { type: String, default: "" },
    invoiceDate: { type: String, default: "" },   // YYYY-MM-DD
    receivedDate: { type: String, default: "" },  // YYYY-MM-DD

    // Google Drive
    driveFileId: { type: String, default: "" },
    webViewLink: { type: String, default: "" },
    uploadedAt: { type: Date, default: null },
    uploadedBy: { type: String, default: "" },

    // Which items are linked to this invoice (optional but useful)
    itemRowIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "Purchase" }],
    uniqueIds: [{ type: String, default: "" }],
  },
  { timestamps: true }
);

export default mongoose.model("StoreInvoice", StoreInvoiceSchema);
