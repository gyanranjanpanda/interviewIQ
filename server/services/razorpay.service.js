import dotenv from "dotenv"
dotenv.config()
import Razorpay from "razorpay"

let client = null;

/**
 * Builds the Razorpay client on first use.
 *
 * This used to run at import time, which meant the entire server refused to
 * boot when the payment keys were absent - even though payments are only one
 * optional feature. Now a missing key only fails the payment request itself.
 */
export const getRazorpay = () => {
  if (client) return client;

  const key_id = process.env.RAZORPAY_KEY_ID;
  const key_secret = process.env.RAZORPAY_KEY_SECRET;

  if (!key_id || !key_secret) {
    throw new Error("Payments are not configured on this server.");
  }

  client = new Razorpay({ key_id, key_secret });
  return client;
};

export default getRazorpay
