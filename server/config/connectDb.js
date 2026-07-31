import mongoose from "mongoose";
import dns from "dns";

const srvRecords = [
    { name: "ac-smn3tpy-shard-00-00.u1fi3wc.mongodb.net", port: 27017, priority: 0, weight: 0 },
    { name: "ac-smn3tpy-shard-00-01.u1fi3wc.mongodb.net", port: 27017, priority: 0, weight: 0 },
    { name: "ac-smn3tpy-shard-00-02.u1fi3wc.mongodb.net", port: 27017, priority: 0, weight: 0 },
];

const origResolveSrv = dns.resolveSrv;
const origPromisesResolveSrv = dns.promises.resolveSrv;
const origResolveTxt = dns.resolveTxt;
const origPromisesResolveTxt = dns.promises.resolveTxt;

dns.resolveSrv = function(hostname, callback) {
    if (typeof hostname === "string" && hostname.includes("cluster0.u1fi3wc.mongodb.net")) {
        return callback(null, srvRecords);
    }
    return origResolveSrv.apply(this, arguments);
};

dns.promises.resolveSrv = async function(hostname) {
    if (typeof hostname === "string" && hostname.includes("cluster0.u1fi3wc.mongodb.net")) {
        return srvRecords;
    }
    return origPromisesResolveSrv.apply(this, arguments);
};

dns.resolveTxt = function(hostname, callback) {
    if (typeof hostname === "string" && hostname.includes("cluster0.u1fi3wc.mongodb.net")) {
        return callback(null, [["authSource=admin&replicaSet=atlas-smn3tpy-shard-0"]]);
    }
    return origResolveTxt.apply(this, arguments);
};

dns.promises.resolveTxt = async function(hostname) {
    if (typeof hostname === "string" && hostname.includes("cluster0.u1fi3wc.mongodb.net")) {
        return [["authSource=admin&replicaSet=atlas-smn3tpy-shard-0"]];
    }
    return origPromisesResolveTxt.apply(this, arguments);
};

const connectDb = async () => {
    try {
        await mongoose.connect(process.env.MONGODB_URL, { serverSelectionTimeoutMS: 5000 });
        console.log("DataBase Connected (Primary)");
    } catch (error) {
        console.warn(`Primary DataBase Connection Failed: ${error.message}`);
        console.log("Attempting fallback to local MongoDB database...");
        try {
            await mongoose.connect("mongodb://127.0.0.1:27017/interviewIQ", { serverSelectionTimeoutMS: 5000 });
            console.log("DataBase Connected (Local Fallback)");
        } catch (fallbackError) {
            console.error(`DataBase Connection Error: ${fallbackError.message}`);
        }
    }
}

export default connectDb