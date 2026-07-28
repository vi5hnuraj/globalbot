import mongoose from 'mongoose';
import dotenv from 'dotenv';
import BankDetails from './src/models/BankDetails.js';

dotenv.config();

const run = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URL);
    const details = await BankDetails.find({}).populate('user', 'email');
    console.log(details.map(d => ({ user: d.user?.email, amount: d.amount, region: d.region })));
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
};

run();
