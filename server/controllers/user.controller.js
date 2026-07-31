import jwt from "jsonwebtoken";
import User from "../models/user.model.js";

/**
 * GET /api/user/current-user
 * Returns the logged-in user object if a valid token cookie is present.
 * Returns HTTP 200 with null if no user is logged in, keeping browser console clean of 401 errors.
 */
export const getCurrentUser = async (req, res) => {
    try {
        const token = req.cookies?.token;
        if (!token) {
            return res.status(200).json(null);
        }

        const verifyToken = jwt.verify(token, process.env.JWT_SECRET);
        if (!verifyToken?.userId) {
            return res.status(200).json(null);
        }

        const user = await User.findById(verifyToken.userId);
        if (!user) {
            return res.status(200).json(null);
        }

        return res.status(200).json(user);
    } catch (error) {
        return res.status(200).json(null);
    }
};