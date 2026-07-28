import mongoose from 'mongoose';
import dotenv from 'dotenv';
import User from './src/models/User.js';

dotenv.config();

const run = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URL);
    const users = await User.find({}, 'email name');
    console.log("Users:", users);
    process.exit(0);
  } catch (err) {
    console.error("Save Error:", err);
    process.exit(1);
  }
};
run();
