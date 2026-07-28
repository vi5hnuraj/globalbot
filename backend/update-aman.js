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
    
    // Inject full bank details for aman@gmail.com
    await User.updateOne(
      { email: "aman@gmail.com" },
      { 
        $set: { 
          "bankDetails.accountNumber": "9876543210123",
          "bankDetails.bankName": "State Bank of India",
          "bankDetails.ifsc": "SBIN0000123"
        } 
      }
    );
    console.log("Injected fake bank details into aman@gmail.com");

    process.exit(0);
  } catch (error) {
    console.error("Error:", error);
    process.exit(1);
  }
};

run();
