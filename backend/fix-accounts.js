import mongoose from "mongoose";
import User from "./src/models/User.js";
import dotenv from "dotenv";

dotenv.config({ path: "./.env" });

const uri = process.env.MONGO_URL || process.env.MONGO_URI;

const run = async () => {
  if (!uri) {
    console.error("Missing MONGO_URL or MONGO_URI environment variables.");
    process.exit(1);
  }
  try {
    await mongoose.connect(uri);
    console.log("Connected to MongoDB");

    // Update users who have bankName but no accountNumber
    const result = await User.updateMany(
      { "bankDetails.bankName": { $exists: true, $ne: "" }, "bankDetails.accountNumber": "" },
      { $set: { "bankDetails.accountNumber": "9876543210123" } }
    );
    console.log(`Updated ${result.modifiedCount} old accounts to have a default account number.`);

    process.exit(0);
  } catch (error) {
    console.error("Error:", error);
    process.exit(1);
  }
};

run();
