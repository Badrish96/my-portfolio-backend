import axios from "axios";
import User from "../models/User.js";

export const signup = async (req, res) => {
  const { email, password, userType, username, name } = req.body;

  try {
    // 1. Create user in Auth0 DB
    const auth0Res = await axios.post(
      `https://${process.env.AUTH0_DOMAIN}/dbconnections/signup`,
      {
        client_id: process.env.AUTH0_CLIENT_ID,
        email: email.toLowerCase(),
        password,
        connection: process.env.AUTH0_DB_CONNECTION,
        username,
        given_name: name,
        user_metadata: { 
          userType,
          username 
        },
        name
      }
    );

    const auth0UserId = auth0Res.data._id;

    // 2. Create user in MongoDB
    const user = await User.create({
      email,
      name,
      username,
      userType,
      auth0Id: auth0UserId,
      provider: 'auth0',
      providerId: auth0UserId,
      roles: ['user']
    });

    return res.status(201).json({
      success: true,
      message: "Please check your email to verify your account",
      user,
    });
  } catch (err) {
    console.log(err?.response?.data || err);
    console.log("ERROR RESPONSE:", err.response?.data);

    return res.status(400).json({
      success: false,
      message: err.response?.data?.message || "Signup failed",
    });
  }
};

export const verifyEmail = async (req, res) => {
  const { ticket } = req.query;

  try {
    // Verify the email with Auth0
    await axios.post(`https://${process.env.AUTH0_DOMAIN}/oauth/token`, {
      grant_type: "urn:auth0:verify-email",
      client_id: process.env.AUTH0_CLIENT_ID,
      client_secret: process.env.AUTH0_CLIENT_SECRET,
      ticket,
    });

    // Redirect to frontend success page
    return res.redirect(`${process.env.FRONTEND_URL}/email-verified`);
  } catch (err) {
    console.error(err);
    return res.redirect(
      `${process.env.FRONTEND_URL}/email-verification-failed`
    );
  }
};

export const signin = async (req, res) => {
  const { email, password } = req.body;

  try {
    // Get user info first to check email verification
    const userInfoResponse = await axios.post(
      `https://${process.env.AUTH0_DOMAIN}/oauth/token`,
      {
        grant_type: "password",
        username: email,
        password,
        audience: process.env.AUTH0_AUDIENCE,
        client_id: process.env.AUTH0_CLIENT_ID,
        client_secret: process.env.AUTH0_CLIENT_SECRET,
        scope: "openid profile email",
      }
    );

    const { access_token, id_token } = userInfoResponse.data;

    // Get user profile to check email verification
    const userProfile = await axios.get(
      `https://${process.env.AUTH0_DOMAIN}/userinfo`,
      {
        headers: { Authorization: `Bearer ${access_token}` },
      }
    );

    if (!userProfile.data.email_verified) {
      return res.status(401).json({
        success: false,
        message: "Please verify your email before signing in",
      });
    }

    // Set token cookie (HttpOnly)
    res.cookie("token", access_token, {
      httpOnly: true,
      secure: false,
      sameSite: "lax",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    return res.json({
      success: true,
      token: access_token,
      id_token,
    });
  } catch (err) {
    return res.status(401).json({
      success: false,
      message: "Invalid email or password",
    });
  }
};
export const googleSignin = async (req, res) => {
  const { googleToken } = req.body;

  try {
    const auth0Res = await axios.post(
      `https://${process.env.AUTH0_DOMAIN}/oauth/token`,
      {
        grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
        subject_token: googleToken,
        subject_token_type: "http://auth0.com/oauth/token-type/google-id-token",
        client_id: process.env.AUTH0_CLIENT_ID,
        audience: process.env.AUTH0_AUDIENCE,
      }
    );

    const { access_token, id_token } = auth0Res.data;

    res.cookie("token", access_token, {
      httpOnly: true,
      sameSite: "lax",
      secure: false,
    });

    return res.json({
      success: true,
      token: access_token,
      id_token,
    });
  } catch (err) {
    console.log(err.response?.data);
    return res.status(400).json({
      success: false,
      message: "Google signin failed",
    });
  }
};
