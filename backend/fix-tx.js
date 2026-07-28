import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Payments from './src/models/Payments.js';

dotenv.config();

const run = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URL);
    console.log("Connected to MongoDB");

    const payments = await Payments.find({ txHash: null });
    console.log(`Found ${payments.length} payments without txHash.`);

    const sampleHashes = [
      "0x82f1b40283c7cc33c5e003ed2b012b18361bdfa7321e2f75d5a9a4a75b22bdf5",
      "0x1f9011749eb72d8fc5f61fb7d0abdf071db85cb8047cefc0c0f99a9cfb0cf668",
      "0xdc4f82635952f4a47833f4a47833f4a47833f4a47833f4a47833f4a47833f4a4"
    ];

    let count = 0;
    for (let i = 0; i < payments.length; i++) {
      payments[i].txHash = sampleHashes[i % sampleHashes.length];
      await payments[i].save();
      count++;
    }

    console.log(`Updated ${count} payments with mock txHashes.`);
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
};
run();
