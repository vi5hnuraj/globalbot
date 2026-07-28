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
    
    const user = await User.findOne({ email: "aman@gmail.com" });
    console.log("Aman's User Record:", JSON.stringify(user, null, 2));

    process.exit(0);
  } catch (error) {
    console.error("Error:", error);
    process.exit(1);
  }
};

run();
