import mongoose from "mongoose";

const connectDb = async () => {
    try {
        await mongoose.connect(process.env.MONGODB_URL);
        console.log("DataBase Connected Successfully");
    } catch (error) {
        console.error(`DataBase Connection Error: ${error.message || error}`);
    }
};

export default connectDb;