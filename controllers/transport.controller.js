import Transport from "../models/transport.model.js";


export const bulkCreateTransport = async (req, res) => {
  try {
    const { data } = req.body;

    if (!Array.isArray(data) || data.length === 0) {
      return res.status(400).json({
        success: false,
        message: "No transport data provided",
      });
    }

    const savedRecords = await Transport.insertMany(data);

    return res.status(201).json({
      success: true,
      message: "Transport records saved successfully",
      data: savedRecords,
    });
  } catch (error) {
    console.error("❌ Error saving transport records:", error);
    return res.status(500).json({
      success: false,
      message: "Server error while saving transport data",
      error: error.message,
    });
  }
};

export const getAllTransportRecords = async (req, res) => {
  try {
    const records = await Transport.find().sort({ createdAt: 1 });

    return res.status(200).json({
      success: true,
      data: records,
    });
  } catch (error) {
    console.error("❌ Error fetching transport records:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch transport records",
    });
  }
};

export const bulkUpdateTransport = async (req, res) => {
  try {
    const { data } = req.body;

    if (!Array.isArray(data) || data.length === 0) {
      return res.status(400).json({
        success: false,
        message: "No data provided for update",
      });
    }

    const bulkOps = data.map(item => ({
      updateOne: {
        filter: { _id: item._id },
        update: { $set: item }
      }
    }));

    await Transport.bulkWrite(bulkOps);

    return res.status(200).json({
      success: true,
      message: "Transport records updated successfully",
    });
  } catch (error) {
    console.error("❌ Bulk update error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to update transport records",
    });
  }
};