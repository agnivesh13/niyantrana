/**
 * MongoDB connection.
 *
 * Connection failure is fatal by design. A server that boots with a dead
 * database passes its own startup and then fails every request individually,
 * which reads to a platform health check as healthy and to a user as broken.
 */
import mongoose from 'mongoose';

import config from './env.js';

export async function connectDatabase(uri = config.mongoUri) {
  mongoose.set('strictQuery', true);
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
  console.log('MongoDB connected');
  return mongoose.connection;
}

export function databaseStatus() {
  const states = ['disconnected', 'connected', 'connecting', 'disconnecting'];
  return states[mongoose.connection.readyState] ?? 'unknown';
}

export default connectDatabase;
