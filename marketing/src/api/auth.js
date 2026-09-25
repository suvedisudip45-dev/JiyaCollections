import api from "./client";
import CryptoJS from "crypto-js";

const encryptValue = (plaintext) => {
  const keyHex = import.meta.env.VITE_AES_KEY;
  const key = CryptoJS.enc.Hex.parse(keyHex);
  const iv = CryptoJS.enc.Hex.parse(import.meta.env.VITE_AES_IV);
  const encrypted = CryptoJS.AES.encrypt(plaintext, key, {
    iv,
    mode: CryptoJS.mode.CBC,
    padding: CryptoJS.pad.Pkcs7,
  });
  return encrypted.ciphertext.toString(CryptoJS.enc.Base64);
};

export const authApi = {
  login: (email, password) => {
    return api.post("/api/auth/login", {
      email: email.trim().toLowerCase(),
      targetPortal: encryptValue("MARKETING_PARTNER"),
      encryptedPassword: encryptValue(password),
    });
  },

  getProfile: () => api.get("/api/marketing-cards/partner/profile"),

  signup: (payload) => api.post("/api/marketing-cards/partner/signup", payload),
};
