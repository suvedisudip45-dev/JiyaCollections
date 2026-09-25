import api from "./client";
import CryptoJS from "crypto-js";

// AES-256-CBC encrypt password before sending (same pattern as admin/manufacturer)
const encryptPassword = (plaintext) => {
  const keyHex = import.meta.env.VITE_AES_KEY;
  if (!keyHex) {
    // Fallback: send plain if no AES key configured
    return { encryptedPassword: null, iv: null, password: plaintext };
  }
  const key = CryptoJS.enc.Hex.parse(keyHex);
  const iv = CryptoJS.lib.WordArray.random(16);
  const encrypted = CryptoJS.AES.encrypt(plaintext, key, {
    iv,
    mode: CryptoJS.mode.CBC,
    padding: CryptoJS.pad.Pkcs7,
  });
  return {
    encryptedPassword: encrypted.ciphertext.toString(CryptoJS.enc.Base64),
    iv: iv.toString(CryptoJS.enc.Hex),
    password: null,
  };
};

export const authApi = {
  login: (email, password) => {
    const { encryptedPassword, iv, password: plainPw } = encryptPassword(password);
    const body = { email: email.trim().toLowerCase() };
    if (encryptedPassword) {
      body.encryptedPassword = encryptedPassword;
      body.iv = iv;
    } else {
      body.password = plainPw;
    }
    return api.post("/api/marketing-cards/partner/login", body);
  },

  getProfile: () => api.get("/api/marketing-cards/partner/profile"),

  signup: (payload) => api.post("/api/marketing-cards/partner/signup", payload),
};
