import mongoose from 'mongoose';
import dotenv from 'dotenv';
import User from './src/models/User.js';

dotenv.config();

mongoose.connect(process.env.MONGODB_URI)
  .then(async () => {
    const user = await User.findOne({ email: 'aman@gmail.com' });
    console.log("Aman User:", user);
    process.exit(0);
  })
  .catch(err => {
    console.error(err);
    process.exit(1);
  });
