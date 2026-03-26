import mongoose from "mongoose";

const DelayFollowupSchema = new mongoose.Schema(
  {
    uniqueId: { type: String, required: true, trim: true },
    stageId: { type: String, required: true, trim: true },
    stageLabel: { type: String, required: true, trim: true },
    pseName: { type: String, required: true, trim: true },

    remarks: { type: String, default: "" },
    estimatedCompletionDate: { type: String, required: true, trim: true },

    isCompleted: { type: Boolean, default: false },
    completedAt: { type: Date, default: null },

    estimateHistory: {
      type: [
        {
          estimatedCompletionDate: { type: String, default: "" },
          remarks: { type: String, default: "" },
          changedAt: { type: Date, default: Date.now },
          changedBy: { type: String, default: "" },
        },
      ],
      default: [],
    },
  },
  { timestamps: true },
);

DelayFollowupSchema.index({ uniqueId: 1, stageId: 1, pseName: 1 }, { unique: true });

export default mongoose.model("DelayFollowup", DelayFollowupSchema);
