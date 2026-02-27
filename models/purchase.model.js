import mongoose from "mongoose";

// Function to generate DD-MM-YYYY formatted date
const getFormattedDate = () => {
  const now = new Date();
  const day = String(now.getDate()).padStart(2, "0");
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const year = now.getFullYear();
  return `${year}-${month}-${day}`;
};

const PurchaseSchema = new mongoose.Schema(
  {
    date: { type: String, default: getFormattedDate }, // <-- Only DD-MM-YYYY

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
    remarksIndentVerification: { type: String, default: "" },

    // ===============================
    // ✅ NEW FIELDS: INDENT VERIFICATION (ADDITIONAL)
    // ===============================
    applicationArea: { type: String, default: "" },
    oldMaterialStatus: { type: String, default: "" },
    orderApprovedBy: { type: String, default: "" },

    // ===============================
    // ✅ INDENT VERIFICATION PDF UPLOAD (Drive link only)
    // ===============================
    indentVerificationPdfDriveFileId: { type: String, default: "" },
    indentVerificationPdfWebViewLink: { type: String, default: "" },
    indentVerificationPdfUploadedAt: { type: Date, default: null },

    // ✅ optional audit fields (like PO)
    indentVerificationPdfUploadedBy: { type: String, default: "" },
    indentVerificationPdfUploadedRole: { type: String, default: "" },

    // ✅ PDF HISTORY (like PO/store history)
    indentVerificationPdfHistory: {
      type: [
        {
          driveFileId: { type: String, default: "" },
          webViewLink: { type: String, default: "" },
          uploadedAt: { type: Date, default: Date.now },
          uploadedBy: { type: String, default: "" },
          uploadedRole: { type: String, default: "" },
        },
      ],
      default: [],
    },

    plannedGetQuotation: { type: String, default: "" },
    actualGetQuotation: { type: String, default: "" },
    quotationStatus: { type: String, default: "Pending" },
    timeDelayGetQuotation: { type: String, default: "" },
    doerStatus: { type: String, default: "Pending" },
    remarksGetQuotation: { type: String, default: "" },

    comparisonStatementPdf: { type: String, default: "" },
    comparisonPdfDriveFileId: { type: String, default: "" },
    comparisonStatementStatus: { type: String, default: "" },

    plannedTechApproval: { type: String, default: "" },
    actualTechApproval: { type: String, default: "" },
    technicalApprovalStatus: { type: String, default: "Pending" },
    timeDelayTechApproval: { type: String, default: "" },
    approverName: { type: String, default: "" },
    remarksTechApproval: { type: String, default: "" },

    plannedCommercialNegotiation: { type: String, default: "" },
    actualCommercialNegotiation: { type: String, default: "" },
    finalizeTermsStatus: { type: String, default: "Pending" },
    timeDelayCommercialNegotiation: { type: String, default: "" },
    getApproval: { type: String, default: "Pending" },
    remarksCommercialNegotiation: { type: String, default: "" },
    approverName2: { type: String, default: "" },

    plannedPoGeneration: { type: String, default: "" },
    actualPoGeneration: { type: String, default: "" },
    poGenerationStatus: { type: String, default: "Pending" },
    timeDelayPoGeneration: { type: String, default: "" },
    poNumber: { type: String, default: "" },
    poDate: { type: String, default: "" },
    vendorName: { type: String, default: "" },
    leadDays: { type: Number, default: 0 },
    amount: { type: Number, default: 0 },
    paymentCondition: { type: String, default: "" },
    papwDays: { type: Number, default: 0 },
    remarksPoGeneration: { type: String, default: "" },

    plannedPCFollowUp1: { type: String, default: "" },
    actualPCFollowUp1: { type: String, default: "" },
    statusPCFollowUp1: { type: String, default: "" },
    timeDelayPCFollowUp1: { type: String, default: "" },
    remarksPCFollowUp1: { type: String, default: "" },

    plannedPCFollowUp2: { type: String, default: "" },
    actualPCFollowUp2: { type: String, default: "" },
    statusPCFollowUp2: { type: String, default: "" },
    timeDelayPCFollowUp2: { type: String, default: "" },
    remarksPCFollowUp2: { type: String, default: "" },

    plannedPCFollowUp3: { type: String, default: "" },
    actualPCFollowUp3: { type: String, default: "" },
    statusPCFollowUp3: { type: String, default: "" },
    timeDelayPCFollowUp3: { type: String, default: "" },
    remarksPCFollowUp3: { type: String, default: "" },

    transactionNoPaymentPWP: { type: String, default: "" },
    plannedPaymentPWP: { type: String, default: "" },
    actualPaymentPWP: { type: String, default: "" },
    statusPaymentPWP: { type: String, default: "" },
    timeDelayPaymentPWP: { type: String, default: "" },
    remarksPaymentPWP: { type: String, default: "" },

    transactionNoPaymentBBD: { type: String, default: "" },
    plannedPaymentBBD: { type: String, default: "" },
    actualPaymentBBD: { type: String, default: "" },
    statusPaymentBBD: { type: String, default: "" },
    timeDelayPaymentBBD: { type: String, default: "" },
    remarksPaymentBBD: { type: String, default: "" },

    transactionNoPaymentFAR: { type: String, default: "" },
    plannedPaymentFAR: { type: String, default: "" },
    actualPaymentFAR: { type: String, default: "" },
    statusPaymentFAR: { type: String, default: "" },
    timeDelayPaymentFAR: { type: String, default: "" },
    remarksPaymentFAR: { type: String, default: "" },

    transactionNoPaymentPAPW: { type: String, default: "" },
    plannedPaymentPAPW: { type: String, default: "" },
    actualPaymentPAPW: { type: String, default: "" },
    statusPaymentPAPW: { type: String, default: "" },
    timeDelayPaymentPAPW: { type: String, default: "" },
    remarksPaymentPAPW: { type: String, default: "" },

    grnToStore: { type: String, default: "Pending" },

    // ✅ MATERIAL RECEIVED (PSE + STORE VALIDATION)
    plannedMaterialReceived: { type: String, default: "" },
    actualMaterialReceived: { type: String, default: "" },
    timeDelayMaterialReceived: { type: String, default: "" },
    materialReceivedDate: { type: String, default: "" },

    // ✅ STORE SECTION FIELDS
    storeStatus: { type: String, default: "" },
    storeReceivedDate: { type: String, default: "" },
    storeReceivedQuantity: { type: Number, default: 0 },
    storeBalanceQuantity: { type: Number, default: 0 },
    storeInvoiceNumber: { type: String, default: "" },
    storeInvoiceDate: { type: String, default: "" },

    // ✅ INVOICE MASTER LINKING
    storeInvoiceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "StoreInvoice",
      default: null,
    },
    storeInvoiceIdHistory: {
      type: [
        {
          invoiceId: { type: mongoose.Schema.Types.ObjectId, ref: "StoreInvoice" },
          linkedAt: { type: Date, default: Date.now },
          linkedBy: { type: String, default: "" },
        },
      ],
      default: [],
    },

    // invoice upload fields
    invoicePdfDriveFileId: { type: String, default: "" },
    invoicePdfWebViewLink: { type: String, default: "" },
    invoicePdfUploadedAt: { type: Date },

    // Manual closure for Store section
    storeManualClosed: { type: Boolean, default: false },
    storeManualClosedAt: { type: Date, default: null },
    storeManualClosedBy: { type: String, default: "" },
    storeManualCloseReason: { type: String, default: "" },

    storeInvoiceHistory: {
      type: [
        {
          invoiceNumber: { type: String, default: "" },
          invoiceDate: { type: String, default: "" },
          changedAt: { type: Date, default: Date.now },
          receivedQuantitySnapshot: { type: Number, default: 0 },
          receivedDateSnapshot: { type: String, default: "" },
          balanceQuantitySnapshot: { type: Number, default: 0 },
        },
      ],
      default: [],
    },

    storePrice: { type: Number, default: 0 },
    storeBoxNumber: { type: Number, default: 0 },
    storeModeOfDispatch: { type: String, default: "" },
    storeDispatchDocumentNumber: { type: String, default: "" },
    storeDispatchBoxNumber: { type: Number, default: 0 },
    storeDispatchDate: { type: String, default: "" },
    storeRemarks: { type: String, default: "" },

    storeInvoicePdfHistory: {
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

    // ✅ PO PDF (LATEST)
    poPdfDriveFileId: { type: String, default: "" },
    poPdfWebViewLink: { type: String, default: "" },
    poPdfUploadedAt: { type: Date },

    poPdfUploadedBy: { type: String, default: "" },
    poPdfUploadedRole: { type: String, default: "" },

    poPdfHistory: {
      type: [
        {
          driveFileId: { type: String, default: "" },
          webViewLink: { type: String, default: "" },
          uploadedAt: { type: Date, default: Date.now },
          uploadedBy: { type: String, default: "" },
          uploadedRole: { type: String, default: "" },
        },
      ],
      default: [],
    },

    poHistory: {
      type: [
        {
          poNumber: { type: String, default: "" },
          poDate: { type: String, default: "" },
          vendorName: { type: String, default: "" },
          leadDays: { type: Number, default: 0 },
          amount: { type: Number, default: 0 },
          paymentCondition: { type: String, default: "" },
          papwDays: { type: Number, default: 0 },
          changedAt: { type: Date, default: Date.now },
          changedBy: { type: String, default: "" },
        },
      ],
      default: [],
    },
// ✅ GET QUOTATION PDF (LATEST)
getQuotationPdfDriveFileId: { type: String, default: "" },
getQuotationPdfWebViewLink: { type: String, default: "" },
getQuotationPdfUploadedAt: { type: Date, default: null },

getQuotationPdfUploadedBy: { type: String, default: "" },
getQuotationPdfUploadedRole: { type: String, default: "" },

getQuotationPdfHistory: {
  type: [
    {
      driveFileId: { type: String, default: "" },
      webViewLink: { type: String, default: "" },
      uploadedAt: { type: Date, default: Date.now },
      uploadedBy: { type: String, default: "" },
      uploadedRole: { type: String, default: "" },
    },
  ],
  default: [],
},


    // Nigeria store fields
    storeReceivedDateNigeria: { type: String, default: "" },
    storeNigeriaRemarks: { type: String, default: "" },
  },
  { timestamps: true }
);

export default mongoose.model("Purchase", PurchaseSchema);
