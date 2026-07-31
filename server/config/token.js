import jwt from "jsonwebtoken"

const genToken = async (userId) => {
    try {
        const token = jwt.sign({userId} , process.env.JWT_SECRET , {expiresIn:"7d"})
return token
    } catch (error) {
        console.log("genToken Error:", error)
        throw error
    }

}

export default genToken